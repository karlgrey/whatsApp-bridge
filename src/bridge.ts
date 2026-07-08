/**
 * WhatsApp-Bridge v1 — READ-ONLY.
 *
 * Verbindet als Linked Device (Baileys), filtert eingehende Nachrichten
 * gegen die Whitelist (config/chats.json) und persistiert Text + Metadaten
 * in data/messages.db. Es gibt bewusst KEINERLEI Sende-Code.
 */
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import path from 'node:path';
import { DATA_DIR, loadWhitelist } from './config.js';
import { openDb, insertMessage } from './storage.js';
import { mapMessage, type BaileysLikeMessage } from './pipeline.js';
import { writeStatus } from './status.js';

const AUTH_DIR = path.join(DATA_DIR, 'auth');
const BACKOFF_START_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

const whitelist = loadWhitelist();
log(`Whitelist: ${whitelist.size} Chat(s) — außerhalb davon wird nichts gespeichert.`);

const db = openDb();
let backoffMs = BACKOFF_START_MS;

async function start(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const sock = makeWASocket({ auth: state });

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
    }

    if (connection === 'close') {
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
        }
      } catch (err) {
        log(`Fehler beim Verarbeiten einer Nachricht: ${String(err)}`);
      }
    }
  });
}

writeStatus({ connected: false, detail: 'startet' });
start().catch((err) => {
  log(`Start fehlgeschlagen: ${String(err)}`);
  writeStatus({ connected: false, detail: `Start fehlgeschlagen: ${String(err)}` });
  process.exit(1);
});
