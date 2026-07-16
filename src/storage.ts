import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

/** Default-Pfad der Nachrichten-DB. */
export const DB_FILE = path.join(DATA_DIR, 'messages.db');

export interface StoredMessage {
  id: string;
  chatJid: string;
  chatName: string;
  sender: string;
  senderName: string;
  timestamp: number;
  text: string;
  mediaType: string | null;
}

/** Öffnet die SQLite-DB (legt Verzeichnis + Schema bei Bedarf an). */
export function openDb(file: string = DB_FILE): Database.Database {
  if (file !== ':memory:') {
    mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_jid TEXT NOT NULL,
      chat_name TEXT,
      sender TEXT,
      sender_name TEXT,
      timestamp INTEGER NOT NULL,
      text TEXT,
      media_type TEXT,
      media_path TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON messages (chat_jid, timestamp);
  `);
  // Migration #172: Alt-DBs (vor media_path) um die Spalte ergänzen.
  const cols = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'media_path')) {
    db.exec('ALTER TABLE messages ADD COLUMN media_path TEXT');
  }
  return db;
}

/** Fügt eine Nachricht ein; idempotent per Primary Key (INSERT OR IGNORE). */
export function insertMessage(db: Database.Database, msg: StoredMessage): void {
  db.prepare(
    `INSERT OR IGNORE INTO messages
       (id, chat_jid, chat_name, sender, sender_name, timestamp, text, media_type)
     VALUES
       (@id, @chatJid, @chatName, @sender, @senderName, @timestamp, @text, @mediaType)`,
  ).run(msg);
}

/** Trägt nach erfolgreichem Download den relativen Medienpfad nach (#172). */
export function setMediaPath(db: Database.Database, id: string, relPath: string): void {
  db.prepare('UPDATE messages SET media_path = ? WHERE id = ?').run(relPath, id);
}
