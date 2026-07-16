import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb, insertMessage, setMediaPath, type StoredMessage } from './storage.js';

const msg: StoredMessage = {
  id: 'ABC123',
  chatJid: '4917xxx@s.whatsapp.net',
  chatName: 'Wanja',
  sender: '4917xxx@s.whatsapp.net',
  senderName: 'Wanja',
  timestamp: 1751990400,
  text: 'Hallo, die Pumpe ist da.',
  mediaType: null,
};

describe('storage', () => {
  it('legt Schema an und liest Felder 1:1 zurück', () => {
    const db = openDb(':memory:');
    insertMessage(db, msg);
    const row = db
      .prepare(
        'SELECT id, chat_jid, chat_name, sender, sender_name, timestamp, text, media_type FROM messages WHERE id = ?',
      )
      .get(msg.id) as Record<string, unknown>;
    expect(row).toEqual({
      id: 'ABC123',
      chat_jid: '4917xxx@s.whatsapp.net',
      chat_name: 'Wanja',
      sender: '4917xxx@s.whatsapp.net',
      sender_name: 'Wanja',
      timestamp: 1751990400,
      text: 'Hallo, die Pumpe ist da.',
      media_type: null,
    });
  });

  it('ist idempotent: zweimal dieselbe id → genau 1 Zeile', () => {
    const db = openDb(':memory:');
    insertMessage(db, msg);
    insertMessage(db, { ...msg, text: 'anderer Text, gleiche id' });
    const count = db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number };
    expect(count.n).toBe(1);
  });
});

describe('media_path (#172)', () => {
  it('frische DB hat die Spalte media_path', () => {
    const db = openDb(':memory:');
    const cols = db
      .prepare('PRAGMA table_info(messages)')
      .all()
      .map((c) => (c as { name: string }).name);
    expect(cols).toContain('media_path');
  });

  it('migriert eine Alt-DB ohne media_path und erhält bestehende Zeilen', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'wab-test-')), 'messages.db');
    const legacy = new Database(file);
    legacy.exec(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        chat_jid TEXT NOT NULL,
        chat_name TEXT,
        sender TEXT,
        sender_name TEXT,
        timestamp INTEGER NOT NULL,
        text TEXT,
        media_type TEXT
      );
    `);
    legacy
      .prepare("INSERT INTO messages (id, chat_jid, timestamp) VALUES ('ALT1', 'x@s.whatsapp.net', 1)")
      .run();
    legacy.close();

    const migrated = openDb(file);
    const row = migrated.prepare("SELECT media_path FROM messages WHERE id = 'ALT1'").get();
    expect(row).toEqual({ media_path: null });
    migrated.close();
  });

  it('setMediaPath setzt den Pfad auf einer bestehenden Nachricht', () => {
    const db = openDb(':memory:');
    insertMessage(db, { ...msg, mediaType: 'document' });
    setMediaPath(db, msg.id, 'media/Wanja/1751990400-ABC123-Rechnung.pdf');
    const row = db.prepare('SELECT media_path FROM messages WHERE id = ?').get(msg.id);
    expect(row).toEqual({ media_path: 'media/Wanja/1751990400-ABC123-Rechnung.pdf' });
  });

  it('setMediaPath ist ein No-Op für unbekannte IDs', () => {
    const db = openDb(':memory:');
    expect(() => setMediaPath(db, 'GIBTS-NICHT', 'x')).not.toThrow();
  });
});
