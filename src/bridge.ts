/**
 * WhatsApp-Bridge v1 — primär READ-ONLY.
 *
 * Verbindet als Linked Device (Baileys), filtert eingehende Nachrichten
 * gegen die Whitelist (config/chats.json) und persistiert Text + Metadaten
 * in data/messages.db.
 *
 * Send-Kanal (#312, seit 30.07.2026): reiner Ausführungskanal für manuell
 * abgelegte, einzeln freigegebene Nachrichten in data/outbox/*.json — KEIN
 * autonomes Senden. Ohne explizites Feature-Flag (config/send.json,
 * `loadSendConfig`, Default AUS) läuft er im Dry-Run (nur Logging, kein
 * Versand). Läuft im selben Prozess über dieselbe Baileys-Session — kein
 * zweiter Prozess, kein zusätzliches Session-Risiko. Details:
 * docs/superpowers/specs/2026-07-30-outbox-send-channel-design.md.
 *
 * WA-Web-Version (#326, seit 07.08.2026): wird beim Prozessstart einmalig
 * dynamisch über `resolveWaVersion()` aufgelöst (Fallback-Kette wa-web →
 * Baileys-Repo → Paket-Default) statt fest im installierten Baileys-Paket
 * zu hängen — Prävention gegen das wiederkehrende 405-Muster (zuletzt #325,
 * 30.07.2026, per manuellem Paket-Bump behoben). Details: src/wa-version.ts.
 *
 * Lücken-Erkennung + Nachhol-Sync (#483, seit 26.08.2026): Baileys' eigener
 * Offline-Redelivery ("handled N offline messages/notifications" beim
 * Reconnect) deckt nachweislich nicht jede Trennung ab — im Vorfall #483
 * wiederholt "handled 0" trotz nachweislich verschickter Nachricht. Echtes
 * Nachfordern verpasster Nachrichten ist mit Baileys v7 nicht zuverlässig
 * möglich (fetchMessageHistory braucht einen Anker in genau dem Chat +
 * ein erreichbares Telefon, liefert asynchron über 'messaging-history.set'
 * und ist für proaktives Pollen nicht vorgesehen). Deshalb zweigleisig:
 * (1) 'messaging-history.set' wird jetzt überhaupt verarbeitet (vorher
 * komplett ignoriert — jede Nachricht, die Baileys darüber nachliefert,
 * ging bisher spurlos verloren), (2) jedes Offline-Fenster oberhalb der
 * Schwelle wird in status.json unter "gaps" vermerkt (src/gap-detector.ts),
 * damit Standups blinde Fenster erkennen statt Vollständigkeit anzunehmen.
 */
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  proto,
  type WAMessage,
  type WAVersion,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DATA_DIR, loadWhitelist } from './config.js';
import { openDb, insertMessage, setMediaPath, type StoredMessage } from './storage.js';
import { mapMessage, learnLidMappingFromMessage, type BaileysLikeMessage } from './pipeline.js';
import { planMediaFile } from './media.js';
import { writeStatus, readStatus } from './status.js';
import { detectGap, appendGap, type ConnectionGap } from './gap-detector.js';
import { startOutboxWatcher, type OutboxWatcherHandle } from './outbox-watcher.js';
import { resolveWaVersion } from './wa-version.js';
import { loadLidMap, saveLidMap, upsertLidMapping, type LidMap } from './lid-map.js';
import { sendToPn, resolveWhitelistLids } from './jid-resolver.js';

const AUTH_DIR = path.join(DATA_DIR, 'auth');
const BACKOFF_START_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;
/** Offline-Fenster oberhalb dieser Dauer gelten als Lücke (#483). */
const GAP_THRESHOLD_MS = 2 * 60_000;
/** status.json soll nicht unbegrenzt wachsen. */
const MAX_GAP_ENTRIES = 50;

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

/** Stiller Baileys-ILogger für den Medien-Download — nur Fehler landen im Log. */
const mediaLogger = {
  level: 'error',
  child: () => mediaLogger,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: (obj: unknown, msg?: string) => log(`Baileys-Media: ${msg ?? String(obj)}`),
};

const whitelist = loadWhitelist();
log(`Whitelist: ${whitelist.size} Chat(s) — außerhalb davon wird nichts gespeichert.`);

const db = openDb();
let backoffMs = BACKOFF_START_MS;
let outboxWatcher: OutboxWatcherHandle | null = null;
// Einmal pro Prozess aufgelöst (nicht pro Reconnect) — WA-Web-Versionswechsel
// sind selten, wiederholte Netzwerk-Roundtrips bei jedem Backoff wären unnötig.
let waVersion: WAVersion | null = null;
// Beim Prozessstart aus status.json vorbelegen — Neustarts (Crash, Re-Pairing)
// sollen bereits erkannte Lücken nicht verwerfen (#483).
let gaps: ConnectionGap[] = readStatus()?.gaps ?? [];
// Zeitpunkt der letzten Trennung, solange keine neue Verbindung offen ist —
// null = aktuell keine offene Trennung erfasst (verbunden oder Prozessstart).
// Bleibt über mehrere fehlgeschlagene Reconnect-Versuche hinweg gesetzt
// (jede davon feuert 'close' erneut, ohne dass zwischendurch 'open' kam) —
// sonst würde jeder gescheiterte Versuch den Lücken-Start nach vorn schieben.
let disconnectedAt: number | null = null;
// PN↔LID-Mapping (#532): beim Start aus data/lid-map.json vorbelegen, danach
// im Prozess laufend erweitert (Whitelist-Auflösung + Lernen aus eingehenden
// Nachrichten + Sende-Weg) und bei jeder Änderung sofort persistiert.
let lidMap: LidMap = loadLidMap();
// Whitelist-weite LID-Auflösung läuft nur einmal pro Prozess (nicht bei
// jedem Reconnect) — analog zu waVersion, unnötige USync-Roundtrips vermeiden.
let whitelistLidsResolved = false;

/** Persistiert einen neuen/aktualisierten PN→LID-Eintrag, No-Op wenn unverändert. */
function learnLid(pn: string, lid: string): void {
  const { map, changed } = upsertLidMapping(lidMap, pn, lid);
  if (changed) {
    lidMap = map;
    saveLidMap(lidMap);
    log(`PN↔LID gelernt: ${pn} → ${lid}.`);
  }
}

/** writeStatus-Wrapper, der die aktuell bekannten Lücken immer mitschreibt. */
function writeBridgeStatus(state: { connected: boolean; detail?: string }): void {
  writeStatus({ ...state, gaps });
}

async function start(): Promise<void> {
  if (!waVersion) {
    const resolved = await resolveWaVersion({ log });
    waVersion = resolved.version;
    log(`WA-Web-Version aufgelöst: ${waVersion.join('.')} (Quelle: ${resolved.source})`);
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const sock = makeWASocket({ auth: state, version: waVersion });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      log('QR-Code für Pairing (WhatsApp → Einstellungen → Verknüpfte Geräte):');
      qrcode.generate(qr, { small: true });
      writeBridgeStatus({ connected: false, detail: 'warte auf QR-Pairing' });
    }

    if (connection === 'open') {
      backoffMs = BACKOFF_START_MS;
      log('Verbunden.');
      // Lücken-Erkennung (#483): disconnectedAt ist gesetzt, seit die
      // Verbindung zuletzt (ggf. über mehrere gescheiterte Reconnect-
      // Versuche hinweg) weg war — jetzt sind wir wieder offen.
      if (disconnectedAt !== null) {
        const gap = detectGap(disconnectedAt, Date.now(), GAP_THRESHOLD_MS);
        if (gap) {
          gaps = appendGap(gaps, gap, MAX_GAP_ENTRIES);
          log(
            `Lücke erkannt: ${gap.minutes} Min. ohne Verbindung (${gap.from} → ${gap.to}) — ` +
              'in dieser Zeit verschickte Nachrichten sind evtl. nicht erfasst (#483).',
          );
        }
        disconnectedAt = null;
      }
      writeBridgeStatus({ connected: true, detail: 'open' });
      // Outbox-Watcher erst starten, wenn eine gültige Session steht — er
      // nutzt sock.sendMessage direkt, das darf nie eine tote Session treffen.
      outboxWatcher?.stop();
      outboxWatcher = startOutboxWatcher({
        // PN↔LID-Auflösung (#532): erst frisch per onWhatsApp versuchen (wie
        // bisher); schlägt das fehl, aber eine LID ist bekannt, wird an die
        // LID gesendet; ist gar keine Zustellung möglich, wirft sendToPn —
        // der Watcher markiert die Datei dann "failed" statt "sent" (siehe
        // outbox-watcher.ts, unverändert).
        sendFn: async (chatJid, text) => {
          await sendToPn(chatJid, text, {
            onWhatsApp: (jid) => sock.onWhatsApp(jid),
            sendMessage: async (jid, t) => {
              await sock.sendMessage(jid, { text: t });
            },
            knownLid: lidMap[chatJid],
            onLearnedLid: (lid) => learnLid(chatJid, lid),
            log,
          });
        },
        log,
      });

      // Whitelist-weite LID-Auflösung (#532): einmal pro Prozess (nicht bei
      // jedem Reconnect), läuft im Hintergrund und blockiert 'open' nicht.
      // Ergebnis + pro Kontakt eine Log-Zeile (Verifikationsgrundlage nach
      // Deploy) — siehe jid-resolver.ts.
      if (!whitelistLidsResolved) {
        whitelistLidsResolved = true;
        log(`PN↔LID-Auflösung der Whitelist gestartet (${whitelist.size} Chat(s)).`);
        void resolveWhitelistLids(whitelist, (jid) => sock.onWhatsApp(jid), log).then(({ map }) => {
          for (const [pn, lid] of Object.entries(map)) {
            learnLid(pn, lid);
          }
          log('PN↔LID-Auflösung der Whitelist abgeschlossen.');
        });
      }
    }

    if (connection === 'close') {
      // Watcher stoppen, solange keine gültige Session existiert — verhindert
      // sendMessage-Aufrufe auf einem toten Socket während Reconnect/Backoff.
      outboxWatcher?.stop();
      outboxWatcher = null;
      // Nur beim ERSTEN 'close' einer Trennungs-Serie setzen — sonst würde
      // jeder gescheiterte Reconnect-Versuch den Lücken-Start verschleppen.
      if (disconnectedAt === null) {
        disconnectedAt = Date.now();
      }

      const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
        ?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        log('Abgemeldet (loggedOut) — NICHT reconnecten. Bitte neu pairen: npm run dev');
        writeBridgeStatus({ connected: false, detail: 'loggedOut — bitte neu pairen (npm run dev)' });
        process.exit(0);
      }
      const delay = backoffMs;
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
      log(`Verbindung getrennt (Code ${statusCode ?? 'unbekannt'}) — Reconnect in ${delay / 1000}s.`);
      writeBridgeStatus({ connected: false, detail: `getrennt (Code ${statusCode ?? 'unbekannt'}), Reconnect geplant` });
      setTimeout(() => {
        start().catch((err) => {
          log(`Reconnect fehlgeschlagen: ${String(err)}`);
          process.exit(1);
        });
      }, delay);
    }
  });

  /**
   * Verarbeitet eine Charge eingehender Nachrichten (live über
   * 'messages.upsert' oder nachgeliefert über 'messaging-history.set',
   * #483) — Whitelist-Filter + Mapping + Speichern + Medien-Download.
   * `label` landet im Log, um Nachhol-Treffer von Live-Nachrichten zu
   * unterscheiden.
   */
  function processMessages(messages: unknown[], label: string): void {
    for (const raw of messages) {
      try {
        const likeMsg = raw as unknown as BaileysLikeMessage;
        // PN↔LID-Lernen (#532): trägt remoteJid=@lid + remoteJidAlt=PN — das
        // Paar ins Mapping übernehmen, unabhängig von der Whitelist (sie
        // hilft künftigen @lid-Nachrichten OHNE remoteJidAlt, siehe
        // pipeline.ts mapMessage-Fallback).
        const learned = learnLidMappingFromMessage(likeMsg);
        if (learned) learnLid(learned.pn, learned.lid);

        const stored = mapMessage(likeMsg, whitelist, lidMap);
        if (stored) {
          insertMessage(db, stored);
          log(`Gespeichert${label}: ${stored.chatName} (${stored.mediaType ?? 'text'})`);
          if (stored.mediaType) {
            void downloadMedia(raw as WAMessage, stored).catch((err) => {
              log(`Medien-Download fehlgeschlagen (${stored.id}): ${String(err)}`);
            });
          }
        }
      } catch (err) {
        log(`Fehler beim Verarbeiten einer Nachricht${label}: ${String(err)}`);
      }
    }
  }

  sock.ev.on('messages.upsert', ({ messages }) => {
    processMessages(messages, '');
  });

  /**
   * Nachhol-Sync (#483): Baileys liefert nach Reconnects gelegentlich einen
   * History-Sync-Batch statt (oder zusätzlich zu) einzelnen 'messages.upsert'-
   * Events — vorher komplett ignoriert, jede darüber nachgelieferte Nachricht
   * ging spurlos verloren. INITIAL_BOOTSTRAP (kompletter History-Sync beim
   * Erst-Pairing) wird ausgelassen: dafür ist diese Session längst durch das
   * History-Sync-Fenster (Whitelist per Hand gebaut, siehe Wiki), und ein
   * erneutes Auftreten wäre ein voller Chat-Export, keine Reconnect-Lücke.
   */
  sock.ev.on('messaging-history.set', ({ messages, syncType }) => {
    if (syncType === proto.HistorySync.HistorySyncType.INITIAL_BOOTSTRAP) {
      log(`Nachhol-Sync übersprungen: INITIAL_BOOTSTRAP (${messages.length} Nachrichten, kein Reconnect-Fall).`);
      return;
    }
    if (messages.length === 0) return;
    log(`Nachhol-Sync empfangen: ${messages.length} Nachricht(en), syncType=${syncType ?? 'unbekannt'}.`);
    processMessages(messages, ' (Nachhol-Sync)');
  });

  /**
   * Medien-Download (#172): lädt Bild/Dokument/Audio/Video (≤ Limit) nach
   * data/media/<chat>/ und trägt den relativen Pfad in der DB nach.
   * Fehler sind non-fatal — die Nachricht selbst ist bereits gespeichert.
   */
  async function downloadMedia(raw: WAMessage, stored: StoredMessage): Promise<void> {
    const plan = planMediaFile(stored, (raw as unknown as BaileysLikeMessage).message);
    if (!plan) {
      log(`Medium übersprungen (${stored.id}): kein Download geplant (Limit/Typ).`);
      return;
    }
    const buffer = await downloadMediaMessage(raw, 'buffer', {}, {
      logger: mediaLogger,
      reuploadRequest: sock.updateMediaMessage,
    });
    const absPath = path.join(DATA_DIR, plan.relPath);
    mkdirSync(path.dirname(absPath), { recursive: true });
    writeFileSync(absPath, buffer);
    setMediaPath(db, stored.id, plan.relPath);
    log(`Medium gespeichert: ${plan.relPath} (${buffer.length} Bytes)`);
  }
}

writeBridgeStatus({ connected: false, detail: 'startet' });
start().catch((err) => {
  log(`Start fehlgeschlagen: ${String(err)}`);
  writeBridgeStatus({ connected: false, detail: `Start fehlgeschlagen: ${String(err)}` });
  process.exit(1);
});
