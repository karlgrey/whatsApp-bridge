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
 */
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  type WAMessage,
  type WAVersion,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DATA_DIR, loadWhitelist } from './config.js';
import { openDb, insertMessage, setMediaPath, type StoredMessage } from './storage.js';
import { mapMessage, type BaileysLikeMessage } from './pipeline.js';
import { planMediaFile } from './media.js';
import { writeStatus } from './status.js';
import { startOutboxWatcher, type OutboxWatcherHandle } from './outbox-watcher.js';
import { resolveWaVersion } from './wa-version.js';

const AUTH_DIR = path.join(DATA_DIR, 'auth');
const BACKOFF_START_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;

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
      writeStatus({ connected: false, detail: 'warte auf QR-Pairing' });
    }

    if (connection === 'open') {
      backoffMs = BACKOFF_START_MS;
      log('Verbunden.');
      writeStatus({ connected: true, detail: 'open' });
      // Outbox-Watcher erst starten, wenn eine gültige Session steht — er
      // nutzt sock.sendMessage direkt, das darf nie eine tote Session treffen.
      outboxWatcher?.stop();
      outboxWatcher = startOutboxWatcher({
        sendFn: async (chatJid, text) => {
          await sock.sendMessage(chatJid, { text });
        },
        log,
      });
    }

    if (connection === 'close') {
      // Watcher stoppen, solange keine gültige Session existiert — verhindert
      // sendMessage-Aufrufe auf einem toten Socket während Reconnect/Backoff.
      outboxWatcher?.stop();
      outboxWatcher = null;

      const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
        ?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        log('Abgemeldet (loggedOut) — NICHT reconnecten. Bitte neu pairen: npm run dev');
        writeStatus({ connected: false, detail: 'loggedOut — bitte neu pairen (npm run dev)' });
        process.exit(0);
      }
      const delay = backoffMs;
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
      log(`Verbindung getrennt (Code ${statusCode ?? 'unbekannt'}) — Reconnect in ${delay / 1000}s.`);
      writeStatus({ connected: false, detail: `getrennt (Code ${statusCode ?? 'unbekannt'}), Reconnect geplant` });
      setTimeout(() => {
        start().catch((err) => {
          log(`Reconnect fehlgeschlagen: ${String(err)}`);
          process.exit(1);
        });
      }, delay);
    }
  });

  sock.ev.on('messages.upsert', ({ messages }) => {
    for (const raw of messages) {
      try {
        const stored = mapMessage(raw as unknown as BaileysLikeMessage, whitelist);
        if (stored) {
          insertMessage(db, stored);
          log(`Gespeichert: ${stored.chatName} (${stored.mediaType ?? 'text'})`);
          if (stored.mediaType) {
            void downloadMedia(raw as WAMessage, stored).catch((err) => {
              log(`Medien-Download fehlgeschlagen (${stored.id}): ${String(err)}`);
            });
          }
        }
      } catch (err) {
        log(`Fehler beim Verarbeiten einer Nachricht: ${String(err)}`);
      }
    }
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

writeStatus({ connected: false, detail: 'startet' });
start().catch((err) => {
  log(`Start fehlgeschlagen: ${String(err)}`);
  writeStatus({ connected: false, detail: `Start fehlgeschlagen: ${String(err)}` });
  process.exit(1);
});
