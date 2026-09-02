import { describe, it, expect, vi } from 'vitest';
import { resolveSendJid, sendToPn, resolveWhitelistLids } from './jid-resolver.js';

describe('resolveSendJid', () => {
  it('onWhatsApp löst die PN normal auf → sendet wie bisher an die PN-JID', async () => {
    const onWhatsApp = vi.fn().mockResolvedValue([{ jid: '4917xxx@s.whatsapp.net', exists: true }]);

    const result = await resolveSendJid('4917xxx@s.whatsapp.net', onWhatsApp, undefined);

    expect(result).toEqual({ ok: true, targetJid: '4917xxx@s.whatsapp.net', via: 'pn' });
  });

  it('onWhatsApp liefert eine LID statt der PN → sendet an die LID, meldet learnedLid', async () => {
    const onWhatsApp = vi.fn().mockResolvedValue([{ jid: '123456789@lid', exists: true }]);

    const result = await resolveSendJid('4915203177631@s.whatsapp.net', onWhatsApp, undefined);

    expect(result).toEqual({
      ok: true,
      targetJid: '123456789@lid',
      via: 'lid-onwhatsapp',
      learnedLid: '123456789@lid',
    });
  });

  it('onWhatsApp scheitert (kein Treffer), aber eine LID ist bereits bekannt → nutzt die bekannte LID', async () => {
    const onWhatsApp = vi.fn().mockResolvedValue([]);

    const result = await resolveSendJid('4915203177631@s.whatsapp.net', onWhatsApp, '123456789@lid');

    expect(result).toEqual({ ok: true, targetJid: '123456789@lid', via: 'lid-map' });
  });

  it('onWhatsApp liefert undefined (USync-Fehlschlag), LID bekannt → nutzt die bekannte LID', async () => {
    const onWhatsApp = vi.fn().mockResolvedValue(undefined);

    const result = await resolveSendJid('4915203177631@s.whatsapp.net', onWhatsApp, '123456789@lid');

    expect(result).toEqual({ ok: true, targetJid: '123456789@lid', via: 'lid-map' });
  });

  it('onWhatsApp wirft, LID bekannt → nutzt trotzdem die bekannte LID statt zu scheitern', async () => {
    const onWhatsApp = vi.fn().mockRejectedValue(new Error('USync-Timeout'));

    const result = await resolveSendJid('4915203177631@s.whatsapp.net', onWhatsApp, '123456789@lid');

    expect(result).toEqual({ ok: true, targetJid: '123456789@lid', via: 'lid-map' });
  });

  it('keine Zustellung möglich (onWhatsApp kein Treffer, keine bekannte LID) → ok:false mit Grund', async () => {
    const onWhatsApp = vi.fn().mockResolvedValue([]);

    const result = await resolveSendJid('4915203177631@s.whatsapp.net', onWhatsApp, undefined);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('4915203177631@s.whatsapp.net');
    }
  });

  it('onWhatsApp wirft UND keine bekannte LID → ok:false mit Grund, der den Fehler nennt', async () => {
    const onWhatsApp = vi.fn().mockRejectedValue(new Error('USync-Timeout'));

    const result = await resolveSendJid('4915203177631@s.whatsapp.net', onWhatsApp, undefined);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('USync-Timeout');
    }
  });

  it('exists:false-Einträge zählen nicht als Treffer', async () => {
    const onWhatsApp = vi.fn().mockResolvedValue([{ jid: '4915203177631@s.whatsapp.net', exists: false }]);

    const result = await resolveSendJid('4915203177631@s.whatsapp.net', onWhatsApp, undefined);

    expect(result.ok).toBe(false);
  });
});

describe('sendToPn', () => {
  it('Erfolg (PN auflösbar): ruft sendMessage mit der PN-JID auf', async () => {
    const onWhatsApp = vi.fn().mockResolvedValue([{ jid: '4917xxx@s.whatsapp.net', exists: true }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await sendToPn('4917xxx@s.whatsapp.net', 'Hallo', { onWhatsApp, sendMessage });

    expect(sendMessage).toHaveBeenCalledWith('4917xxx@s.whatsapp.net', 'Hallo');
  });

  it('LID-Fallback: sendet an die aufgelöste/bekannte LID, meldet die gelernte LID über onLearnedLid', async () => {
    const onWhatsApp = vi.fn().mockResolvedValue([{ jid: '123456789@lid', exists: true }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const onLearnedLid = vi.fn();

    await sendToPn('4915203177631@s.whatsapp.net', 'Hallo', {
      onWhatsApp,
      sendMessage,
      onLearnedLid,
    });

    expect(sendMessage).toHaveBeenCalledWith('123456789@lid', 'Hallo');
    expect(onLearnedLid).toHaveBeenCalledWith('123456789@lid');
  });

  it('keine Zustellung möglich → wirft (statt sendMessage aufzurufen) — Aufrufer markiert dann "failed", nie "sent"', async () => {
    const onWhatsApp = vi.fn().mockResolvedValue([]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await expect(
      sendToPn('4915203177631@s.whatsapp.net', 'Hallo', { onWhatsApp, sendMessage }),
    ).rejects.toThrow(/4915203177631@s\.whatsapp\.net/);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('onWhatsApp wirft und keine bekannte LID → sendToPn wirft ebenfalls (nie stillschweigend "sent")', async () => {
    const onWhatsApp = vi.fn().mockRejectedValue(new Error('USync-Timeout'));
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await expect(
      sendToPn('4915203177631@s.whatsapp.net', 'Hallo', { onWhatsApp, sendMessage }),
    ).rejects.toThrow(/USync-Timeout/);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sendMessage selbst wirft (z. B. Netzwerkfehler) → der Fehler propagiert unverändert', async () => {
    const onWhatsApp = vi.fn().mockResolvedValue([{ jid: '4917xxx@s.whatsapp.net', exists: true }]);
    const sendMessage = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));

    await expect(
      sendToPn('4917xxx@s.whatsapp.net', 'Hallo', { onWhatsApp, sendMessage }),
    ).rejects.toThrow('ETIMEDOUT');
  });
});

describe('resolveWhitelistLids', () => {
  it('löst alle Whitelist-PNs auf, baut ein Mapping für LID-Treffer, loggt jeden Kontakt', async () => {
    const whitelist = new Map([
      ['4915203177631@s.whatsapp.net', 'Wanja'],
      ['4917yyy@s.whatsapp.net', 'Micha Zweitgerät'],
    ]);
    const onWhatsApp = vi.fn().mockImplementation(async (jid: string) => {
      if (jid === '4915203177631@s.whatsapp.net') return [{ jid: '555000111@lid', exists: true }];
      return [{ jid, exists: true }];
    });
    const log = vi.fn();

    const { map, results } = await resolveWhitelistLids(whitelist, onWhatsApp, log);

    expect(map).toEqual({ '4915203177631@s.whatsapp.net': '555000111@lid' });
    expect(results).toEqual([
      { pn: '4915203177631@s.whatsapp.net', name: 'Wanja', status: 'lid', jid: '555000111@lid' },
      { pn: '4917yyy@s.whatsapp.net', name: 'Micha Zweitgerät', status: 'pn', jid: '4917yyy@s.whatsapp.net' },
    ]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('4915203177631'));
    expect(log.mock.calls.some(([msg]) => String(msg).includes('555000111@lid'))).toBe(true);
  });

  it('kein Treffer für eine PN → status "unresolved", kein Mapping-Eintrag, trotzdem geloggt', async () => {
    const whitelist = new Map([['4915203177631@s.whatsapp.net', 'Wanja']]);
    const onWhatsApp = vi.fn().mockResolvedValue([]);
    const log = vi.fn();

    const { map, results } = await resolveWhitelistLids(whitelist, onWhatsApp, log);

    expect(map).toEqual({});
    expect(results).toEqual([{ pn: '4915203177631@s.whatsapp.net', name: 'Wanja', status: 'unresolved' }]);
    expect(log).toHaveBeenCalled();
  });

  it('onWhatsApp wirft für eine PN → status "unresolved", andere PNs werden trotzdem verarbeitet', async () => {
    const whitelist = new Map([
      ['4915203177631@s.whatsapp.net', 'Wanja'],
      ['4917yyy@s.whatsapp.net', 'Micha Zweitgerät'],
    ]);
    const onWhatsApp = vi.fn().mockImplementation(async (jid: string) => {
      if (jid === '4915203177631@s.whatsapp.net') throw new Error('USync-Timeout');
      return [{ jid, exists: true }];
    });

    const { map, results } = await resolveWhitelistLids(whitelist, onWhatsApp);

    expect(results).toEqual([
      { pn: '4915203177631@s.whatsapp.net', name: 'Wanja', status: 'unresolved' },
      { pn: '4917yyy@s.whatsapp.net', name: 'Micha Zweitgerät', status: 'pn', jid: '4917yyy@s.whatsapp.net' },
    ]);
    expect(map).toEqual({});
  });

  it('überspringt Whitelist-Einträge, die keine Telefonnummern-JID sind (z. B. Gruppen)', async () => {
    const whitelist = new Map([['1203630@g.us', 'Team Uferstraße']]);
    const onWhatsApp = vi.fn();

    const { map, results } = await resolveWhitelistLids(whitelist, onWhatsApp);

    expect(onWhatsApp).not.toHaveBeenCalled();
    expect(map).toEqual({});
    expect(results).toEqual([]);
  });
});
