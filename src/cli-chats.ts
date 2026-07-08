/**
 * Chat-Discovery: listet JID + Name verfügbarer Chats zum Befüllen der
 * Whitelist (config/chats.json). Nur Metadaten — keine Inhalte. Read-only.
 */
import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const AUTH_DIR = path.join(DATA_DIR, 'auth');
const COLLECT_MS = 15_000;

if (!existsSync(path.join(AUTH_DIR, 'creds.json'))) {
  console.error('Keine gepairte Session gefunden. Erst pairen: npm run dev');
  process.exit(1);
}

const found = new Map<string, string>(); // JID → Name

function remember(jid: string | null | undefined, name: string | null | undefined): void {
  if (!jid || jid === 'status@broadcast') return;
  const existing = found.get(jid);
  if (!existing || (name && existing === jid)) {
    found.set(jid, name || jid);
  }
}

const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
const sock = makeWASocket({ auth: state });
sock.ev.on('creds.update', saveCreds);

sock.ev.on('messaging-history.set', ({ chats, contacts }) => {
  for (const chat of chats) remember(chat.id, chat.name);
  for (const contact of contacts) remember(contact.id, contact.name ?? contact.notify);
});
sock.ev.on('chats.upsert', (chats) => {
  for (const chat of chats) remember(chat.id, chat.name);
});
sock.ev.on('contacts.upsert', (contacts) => {
  for (const contact of contacts) remember(contact.id, contact.name ?? contact.notify);
});

sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
  if (connection === 'close') {
    console.error(`Verbindung fehlgeschlagen: ${String(lastDisconnect?.error ?? 'unbekannt')}`);
    console.error('Falls abgemeldet: neu pairen mit npm run dev');
    process.exit(1);
  }
  if (connection === 'open') {
    console.error(`Verbunden — sammle Chats (${COLLECT_MS / 1000}s) …`);
    void (async () => {
      try {
        const groups = await sock.groupFetchAllParticipating();
        for (const [jid, meta] of Object.entries(groups)) remember(jid, meta.subject);
      } catch (err) {
        console.error(`Gruppen konnten nicht geladen werden: ${String(err)}`);
      }
      // Einzelchats trudeln über History-Sync-Events ein — kurz sammeln.
      setTimeout(() => {
        if (found.size === 0) {
          console.log('Keine Chats gefunden. Tipp: kurz warten und erneut ausführen — Einzelchats kommen per History-Sync direkt nach dem Pairing.');
        } else {
          const rows = [...found.entries()].sort((a, b) => a[1].localeCompare(b[1], 'de'));
          const width = Math.max(...rows.map(([jid]) => jid.length), 3);
          console.log(`${'JID'.padEnd(width)} | Name`);
          console.log(`${'-'.repeat(width)}-+------`);
          for (const [jid, name] of rows) console.log(`${jid.padEnd(width)} | ${name}`);
          console.log(`\n${rows.length} Chat(s). Gewünschte Einträge als {"jid": …, "name": …} in config/chats.json übernehmen.`);
        }
        process.exit(0);
      }, COLLECT_MS);
    })();
  }
});
