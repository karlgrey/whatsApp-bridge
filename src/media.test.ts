import { describe, it, expect } from 'vitest';
import { planMediaFile, MAX_MEDIA_BYTES } from './media.js';
import type { StoredMessage } from './storage.js';
import type { BaileysLikeMessage } from './pipeline.js';

function stored(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id: 'MSG1',
    chatJid: '4917xxx@s.whatsapp.net',
    chatName: 'Christian Henschel',
    sender: '4917xxx@s.whatsapp.net',
    senderName: 'Christian Henschel',
    timestamp: 1784181806,
    text: '',
    mediaType: 'document',
    ...overrides,
  };
}

function docMsg(overrides: object = {}): NonNullable<BaileysLikeMessage['message']> {
  return {
    documentMessage: {
      fileName: 'Vertrag Final.pdf',
      mimetype: 'application/pdf',
      fileLength: 120_000,
      ...overrides,
    },
  };
}

describe('planMediaFile', () => {
  it('Dokument: relativer Pfad aus Chat, Timestamp, ID und Original-Dateiname', () => {
    const plan = planMediaFile(stored(), docMsg());
    expect(plan).toEqual({
      relPath: 'media/Christian-Henschel/1784181806-MSG1-Vertrag-Final.pdf',
    });
  });

  it('Bild ohne Dateiname: Extension aus Mimetype', () => {
    const plan = planMediaFile(
      stored({ mediaType: 'image' }),
      { imageMessage: { mimetype: 'image/jpeg', fileLength: 50_000 } },
    );
    expect(plan).toEqual({
      relPath: 'media/Christian-Henschel/1784181806-MSG1.jpg',
    });
  });

  it('sanitisiert gefährliche Zeichen in Chatname und Dateiname (kein Path-Traversal)', () => {
    const plan = planMediaFile(
      stored({ chatName: '../evil' }),
      docMsg({ fileName: '../../etc/passwd' }),
    );
    expect(plan?.relPath).not.toContain('..');
    expect(plan?.relPath).toMatch(/^media\//);
  });

  it('verweigert Dateien über dem Größenlimit', () => {
    const plan = planMediaFile(stored(), docMsg({ fileLength: MAX_MEDIA_BYTES + 1 }));
    expect(plan).toBeNull();
  });

  it('fileLength als Long-artiges Objekt (Baileys) wird verstanden', () => {
    const plan = planMediaFile(
      stored(),
      docMsg({ fileLength: { toNumber: () => MAX_MEDIA_BYTES + 1 } }),
    );
    expect(plan).toBeNull();
  });

  it('unbekannter Mimetype ohne Dateiname → .bin', () => {
    const plan = planMediaFile(
      stored({ mediaType: 'document' }),
      { documentMessage: { mimetype: 'application/x-blob', fileLength: 10 } },
    );
    expect(plan?.relPath).toBe('media/Christian-Henschel/1784181806-MSG1.bin');
  });

  it('Nachricht ohne Medien-Knoten → null', () => {
    const plan = planMediaFile(stored({ mediaType: null }), { conversation: 'nur Text' });
    expect(plan).toBeNull();
  });
});
