import { describe, it, expect } from 'vitest';
import { openDb, insertMessage, type StoredMessage } from './storage.js';

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
