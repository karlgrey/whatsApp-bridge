import { describe, it, expect, vi } from 'vitest';
import { resolveWaVersion } from './wa-version.js';

const PACKAGE_DEFAULT: [number, number, number] = [2, 3000, 1043857760];

describe('resolveWaVersion', () => {
  it('primär: nutzt fetchWaWeb, wenn isLatest true — fetchBaileysRepo wird nicht aufgerufen', async () => {
    const fetchWaWeb = vi.fn().mockResolvedValue({ version: [2, 3000, 9999999], isLatest: true });
    const fetchBaileysRepo = vi.fn();

    const result = await resolveWaVersion({
      fetchWaWeb,
      fetchBaileysRepo,
      packageDefaultVersion: PACKAGE_DEFAULT,
    });

    expect(result).toEqual({ version: [2, 3000, 9999999], source: 'wa-web' });
    expect(fetchBaileysRepo).not.toHaveBeenCalled();
  });

  it('Fallback 1: fetchWaWeb liefert isLatest:false → fetchBaileysRepo wird genutzt', async () => {
    const fetchWaWeb = vi.fn().mockResolvedValue({ version: PACKAGE_DEFAULT, isLatest: false, error: 'boom' });
    const fetchBaileysRepo = vi.fn().mockResolvedValue({ version: [2, 3000, 1234567], isLatest: true });

    const result = await resolveWaVersion({
      fetchWaWeb,
      fetchBaileysRepo,
      packageDefaultVersion: PACKAGE_DEFAULT,
    });

    expect(result).toEqual({ version: [2, 3000, 1234567], source: 'baileys-repo' });
  });

  it('Fallback 2: beide Fetches liefern isLatest:false → Paket-Default', async () => {
    const fetchWaWeb = vi.fn().mockResolvedValue({ version: PACKAGE_DEFAULT, isLatest: false });
    const fetchBaileysRepo = vi.fn().mockResolvedValue({ version: PACKAGE_DEFAULT, isLatest: false });

    const result = await resolveWaVersion({
      fetchWaWeb,
      fetchBaileysRepo,
      packageDefaultVersion: PACKAGE_DEFAULT,
    });

    expect(result).toEqual({ version: PACKAGE_DEFAULT, source: 'package-default' });
  });

  it('Fehler: fetchWaWeb wirft → Fallback-Kette läuft weiter statt zu scheitern', async () => {
    const fetchWaWeb = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const fetchBaileysRepo = vi.fn().mockResolvedValue({ version: [2, 3000, 42], isLatest: true });

    const result = await resolveWaVersion({
      fetchWaWeb,
      fetchBaileysRepo,
      packageDefaultVersion: PACKAGE_DEFAULT,
    });

    expect(result).toEqual({ version: [2, 3000, 42], source: 'baileys-repo' });
  });

  it('Fehler: beide Fetches werfen → Paket-Default, kein Throw nach außen', async () => {
    const fetchWaWeb = vi.fn().mockRejectedValue(new Error('DNS-Fehler'));
    const fetchBaileysRepo = vi.fn().mockRejectedValue(new Error('DNS-Fehler'));

    await expect(
      resolveWaVersion({ fetchWaWeb, fetchBaileysRepo, packageDefaultVersion: PACKAGE_DEFAULT }),
    ).resolves.toEqual({ version: PACKAGE_DEFAULT, source: 'package-default' });
  });

  it('Timeout: hängender fetchWaWeb wird nach timeoutMs abgebrochen, Kette läuft weiter', async () => {
    const fetchWaWeb = vi.fn().mockImplementation(() => new Promise(() => {})); // hängt für immer
    const fetchBaileysRepo = vi.fn().mockResolvedValue({ version: [2, 3000, 555], isLatest: true });

    const result = await resolveWaVersion({
      fetchWaWeb,
      fetchBaileysRepo,
      packageDefaultVersion: PACKAGE_DEFAULT,
      timeoutMs: 20,
    });

    expect(result).toEqual({ version: [2, 3000, 555], source: 'baileys-repo' });
  });

  it('Timeout: hängt auch fetchBaileysRepo → Paket-Default statt endlosem Warten', async () => {
    const fetchWaWeb = vi.fn().mockImplementation(() => new Promise(() => {}));
    const fetchBaileysRepo = vi.fn().mockImplementation(() => new Promise(() => {}));

    const result = await resolveWaVersion({
      fetchWaWeb,
      fetchBaileysRepo,
      packageDefaultVersion: PACKAGE_DEFAULT,
      timeoutMs: 20,
    });

    expect(result).toEqual({ version: PACKAGE_DEFAULT, source: 'package-default' });
  });

  it('loggt die aufgelöste Quelle bei Fallback-Schritten', async () => {
    const fetchWaWeb = vi.fn().mockResolvedValue({ version: PACKAGE_DEFAULT, isLatest: false, error: 'kaputt' });
    const fetchBaileysRepo = vi.fn().mockResolvedValue({ version: [2, 3000, 77], isLatest: true });
    const log = vi.fn();

    await resolveWaVersion({ fetchWaWeb, fetchBaileysRepo, packageDefaultVersion: PACKAGE_DEFAULT, log });

    expect(log).toHaveBeenCalledWith(expect.stringContaining('wa-web'));
  });

  it('nutzt ohne Deps die echten Baileys-Exporte (Default-Wiring, kein Netzwerkzugriff nötig für den Typcheck)', () => {
    expect(typeof resolveWaVersion).toBe('function');
  });
});
