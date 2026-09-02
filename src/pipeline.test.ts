import { describe, it, expect } from 'vitest';
import { mapMessage, learnLidMappingFromMessage, type BaileysLikeMessage } from './pipeline.js';

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

  it('LID-Adressierung: matcht über remoteJidAlt und speichert die Whitelist-JID', () => {
    const stored = mapMessage(
      raw({
        key: {
          id: 'MSG9',
          remoteJid: '123456789012345@lid',
          remoteJidAlt: '4917xxx@s.whatsapp.net',
          fromMe: false,
        },
      }),
      whitelist,
    );
    expect(stored?.chatJid).toBe('4917xxx@s.whatsapp.net');
    expect(stored?.chatName).toBe('Wanja');
  });

  it('LID-Adressierung: verwirft, wenn auch remoteJidAlt nicht gelistet ist', () => {
    const stored = mapMessage(
      raw({
        key: {
          id: 'MSG10',
          remoteJid: '123456789012345@lid',
          remoteJidAlt: '4930999@s.whatsapp.net',
          fromMe: false,
        },
      }),
      whitelist,
    );
    expect(stored).toBeNull();
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

  it('verwirft WhatsApp-Stories (status@broadcast) auch bei versehentlichem Whitelist-Eintrag (#412)', () => {
    const wl = new Map([['status@broadcast', 'Status']]);
    const stored = mapMessage(
      raw({ key: { id: 'MSGS', remoteJid: 'status@broadcast', fromMe: false } }),
      wl,
    );
    expect(stored).toBeNull();
  });

  it('verwirft Newsletter-/Broadcast-Kanäle (#412)', () => {
    const wl = new Map([
      ['12345@newsletter', 'Kanal'],
      ['67890@broadcast', 'Broadcast-Liste'],
    ]);
    expect(
      mapMessage(raw({ key: { id: 'MSGN', remoteJid: '12345@newsletter', fromMe: false } }), wl),
    ).toBeNull();
    expect(
      mapMessage(raw({ key: { id: 'MSGB', remoteJid: '67890@broadcast', fromMe: false } }), wl),
    ).toBeNull();
  });

  it('LID-Adressierung ohne remoteJidAlt (#532, z. B. Wanja): matcht über bekanntes PN↔LID-Mapping', () => {
    const stored = mapMessage(
      raw({
        key: {
          id: 'MSG11',
          remoteJid: '999888777@lid',
          fromMe: false,
        },
      }),
      whitelist,
      { '4917xxx@s.whatsapp.net': '999888777@lid' },
    );
    expect(stored?.chatJid).toBe('4917xxx@s.whatsapp.net');
    expect(stored?.chatName).toBe('Wanja');
  });

  it('LID-Adressierung ohne remoteJidAlt: verwirft, wenn die LID im Mapping fehlt', () => {
    const stored = mapMessage(
      raw({
        key: { id: 'MSG12', remoteJid: '999888777@lid', fromMe: false },
      }),
      whitelist,
      {},
    );
    expect(stored).toBeNull();
  });

  it('LID-Adressierung ohne remoteJidAlt: verwirft, wenn die gemappte PN nicht auf der Whitelist steht', () => {
    const stored = mapMessage(
      raw({ key: { id: 'MSG13', remoteJid: '999888777@lid', fromMe: false } }),
      whitelist,
      { '4930999@s.whatsapp.net': '999888777@lid' },
    );
    expect(stored).toBeNull();
  });

  it('ohne lidMap-Argument (Default {}) funktioniert weiterhin wie zuvor', () => {
    const stored = mapMessage(raw(), whitelist);
    expect(stored?.chatJid).toBe('4917xxx@s.whatsapp.net');
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

describe('learnLidMappingFromMessage', () => {
  it('extrahiert {pn, lid}, wenn remoteJid=@lid UND remoteJidAlt eine Telefonnummern-JID ist', () => {
    const pair = learnLidMappingFromMessage(
      raw({
        key: {
          id: 'MSG20',
          remoteJid: '999888777@lid',
          remoteJidAlt: '4917xxx@s.whatsapp.net',
          fromMe: false,
        },
      }),
    );
    expect(pair).toEqual({ pn: '4917xxx@s.whatsapp.net', lid: '999888777@lid' });
  });

  it('liefert null ohne remoteJidAlt', () => {
    const pair = learnLidMappingFromMessage(
      raw({ key: { id: 'MSG21', remoteJid: '999888777@lid', fromMe: false } }),
    );
    expect(pair).toBeNull();
  });

  it('liefert null, wenn remoteJid keine LID ist (normale PN-Adressierung)', () => {
    const pair = learnLidMappingFromMessage(raw());
    expect(pair).toBeNull();
  });

  it('liefert null, wenn remoteJidAlt keine Telefonnummern-JID ist (z. B. Gruppe)', () => {
    const pair = learnLidMappingFromMessage(
      raw({
        key: {
          id: 'MSG22',
          remoteJid: '999888777@lid',
          remoteJidAlt: '1203630@g.us',
          fromMe: false,
        },
      }),
    );
    expect(pair).toBeNull();
  });
});
