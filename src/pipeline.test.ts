import { describe, it, expect } from 'vitest';
import { mapMessage, type BaileysLikeMessage } from './pipeline.js';

const whitelist = new Map([['4917xxx@s.whatsapp.net', 'Wanja']]);

function raw(overrides: Partial<BaileysLikeMessage> = {}): BaileysLikeMessage {
  return {
    key: { id: 'MSG1', remoteJid: '4917xxx@s.whatsapp.net', fromMe: false },
    messageTimestamp: 1751990400,
    pushName: 'Wanja Handy',
    message: { conversation: 'Pumpe ist da.' },
    ...overrides,
  };
}

describe('mapMessage', () => {
  it('verwirft Nachrichten aus Nicht-Whitelist-Chats', () => {
    const msg = raw({ key: { id: 'MSG1', remoteJid: '4930999@s.whatsapp.net', fromMe: false } });
    expect(mapMessage(msg, whitelist)).toBeNull();
  });

  it('mappt conversation-Text mit chatName aus der Whitelist', () => {
    const stored = mapMessage(raw(), whitelist);
    expect(stored).toEqual({
      id: 'MSG1',
      chatJid: '4917xxx@s.whatsapp.net',
      chatName: 'Wanja',
      sender: '4917xxx@s.whatsapp.net',
      senderName: 'Wanja Handy',
      timestamp: 1751990400,
      text: 'Pumpe ist da.',
      mediaType: null,
    });
  });

  it('mappt extendedTextMessage-Text', () => {
    const stored = mapMessage(
      raw({ message: { extendedTextMessage: { text: 'Antwort mit Zitat' } } }),
      whitelist,
    );
    expect(stored?.text).toBe('Antwort mit Zitat');
  });

  it('Bild ohne Text → mediaType image, text leer', () => {
    const stored = mapMessage(raw({ message: { imageMessage: {} } }), whitelist);
    expect(stored?.mediaType).toBe('image');
    expect(stored?.text).toBe('');
  });

  it('ohne Text und ohne Medium → null', () => {
    const stored = mapMessage(raw({ message: {} }), whitelist);
    expect(stored).toBeNull();
  });

  it('fromMe → senderName Micha', () => {
    const stored = mapMessage(
      raw({ key: { id: 'MSG2', remoteJid: '4917xxx@s.whatsapp.net', fromMe: true } }),
      whitelist,
    );
    expect(stored?.senderName).toBe('Micha');
  });

  it('Gruppen-Nachricht: sender = participant', () => {
    const groupWl = new Map([['1203630@g.us', 'Team Uferstraße']]);
    const stored = mapMessage(
      raw({
        key: { id: 'MSG3', remoteJid: '1203630@g.us', participant: '4917yyy@s.whatsapp.net', fromMe: false },
      }),
      groupWl,
    );
    expect(stored?.sender).toBe('4917yyy@s.whatsapp.net');
    expect(stored?.chatName).toBe('Team Uferstraße');
  });
});
