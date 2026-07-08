/**
 * Status-CLI: zeigt Verbindungszustand (data/status.json) + letzte
 * gespeicherte Nachricht (data/messages.db). Kein Netz.
 */
import { existsSync } from 'node:fs';
import { readStatus } from './status.js';
import { openDb, DB_FILE } from './storage.js';

const status = readStatus();
if (!status) {
  console.log('Status:   unbekannt — Bridge lief noch nie (data/status.json fehlt). Start: npm run dev');
} else {
  const state = status.connected ? 'verbunden' : 'getrennt';
  const detail = status.detail ? ` (${status.detail})` : '';
  console.log(`Status:   ${state}${detail}`);
  console.log(`Stand:    ${status.updatedAt}`);
}

if (!existsSync(DB_FILE)) {
  console.log('Letzte Nachricht: noch keine (keine Datenbank).');
} else {
  const db = openDb();
  const row = db
    .prepare('SELECT chat_name, timestamp FROM messages ORDER BY timestamp DESC LIMIT 1')
    .get() as { chat_name: string; timestamp: number } | undefined;
  if (!row) {
    console.log('Letzte Nachricht: noch keine.');
  } else {
    const when = new Date(row.timestamp * 1000).toISOString();
    console.log(`Letzte Nachricht: ${when} in "${row.chat_name}"`);
  }
  db.close();
}
