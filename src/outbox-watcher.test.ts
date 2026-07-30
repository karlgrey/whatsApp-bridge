import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { processOutboxOnce, recoverOrphans } from './outbox-watcher.js';

const whitelist = new Map([['4917xxx@s.whatsapp.net', 'Wanja']]);

function makeDirs() {
  const root = mkdtempSync(path.join(tmpdir(), 'wab-outbox-'));
  return {
    outboxDir: path.join(root, 'outbox'),
    doneDir: path.join(root, 'outbox', 'done'),
    failedDir: path.join(root, 'outbox', 'failed'),
    processingDir: path.join(root, 'outbox', '.processing'),
    sentLogFile: path.join(root, 'sent.log'),
  };
}

function writeEntry(outboxDir: string, name: string, entry: unknown) {
  mkdirSync(outboxDir, { recursive: true });
  writeFileSync(path.join(outboxDir, name), typeof entry === 'string' ? entry : JSON.stringify(entry));
}

describe('processOutboxOnce', () => {
  it('sendet (enabled:true), verschiebt nach done/, loggt "sent"', async () => {
    const dirs = makeDirs();
    writeEntry(dirs.outboxDir, 'msg1.json', { chatJid: '4917xxx@s.whatsapp.net', text: 'Hallo' });
    const sendFn = vi.fn().mockResolvedValue(undefined);

    await processOutboxOnce({
      ...dirs,
      sendFn,
      loadWhitelistFn: () => whitelist,
      loadSendConfigFn: () => ({ enabled: true }),
    });

    expect(sendFn).toHaveBeenCalledWith('4917xxx@s.whatsapp.net', 'Hallo');
    expect(readdirSync(dirs.outboxDir).filter((f) => f.endsWith('.json'))).toEqual([]);
    expect(readdirSync(dirs.doneDir)).toEqual(['msg1.json']);
    const log = readFileSync(dirs.sentLogFile, 'utf8');
    expect(log).toMatch(/4917xxx@s\.whatsapp\.net \| sent/);
  });

  it('Dry-Run (enabled:false/Default): sendFn wird NICHT aufgerufen, trotzdem nach done/ verschoben', async () => {
    const dirs = makeDirs();
    writeEntry(dirs.outboxDir, 'msg1.json', { chatJid: '4917xxx@s.whatsapp.net', text: 'Hallo' });
    const sendFn = vi.fn().mockResolvedValue(undefined);

    await processOutboxOnce({
      ...dirs,
      sendFn,
      loadWhitelistFn: () => whitelist,
      loadSendConfigFn: () => ({ enabled: false }),
    });

    expect(sendFn).not.toHaveBeenCalled();
    expect(readdirSync(dirs.doneDir)).toEqual(['msg1.json']);
    const log = readFileSync(dirs.sentLogFile, 'utf8');
    expect(log).toMatch(/4917xxx@s\.whatsapp\.net \| dry-run/);
  });

  it('nicht-whitelisteter Chat: verschoben nach failed/, sendFn nicht aufgerufen, "rejected" geloggt', async () => {
    const dirs = makeDirs();
    writeEntry(dirs.outboxDir, 'msg1.json', { chatJid: '4930999@s.whatsapp.net', text: 'Hallo' });
    const sendFn = vi.fn().mockResolvedValue(undefined);

    await processOutboxOnce({
      ...dirs,
      sendFn,
      loadWhitelistFn: () => whitelist,
      loadSendConfigFn: () => ({ enabled: true }),
    });

    expect(sendFn).not.toHaveBeenCalled();
    expect(readdirSync(dirs.failedDir)).toEqual(['msg1.json']);
    const log = readFileSync(dirs.sentLogFile, 'utf8');
    expect(log).toMatch(/4930999@s\.whatsapp\.net \| rejected/);
  });

  it('ungültiges JSON: nach failed/ verschoben, "rejected" geloggt, kein Crash', async () => {
    const dirs = makeDirs();
    writeEntry(dirs.outboxDir, 'kaputt.json', '{ das ist kein json');
    const sendFn = vi.fn().mockResolvedValue(undefined);

    await processOutboxOnce({
      ...dirs,
      sendFn,
      loadWhitelistFn: () => whitelist,
      loadSendConfigFn: () => ({ enabled: true }),
    });

    expect(sendFn).not.toHaveBeenCalled();
    expect(readdirSync(dirs.failedDir)).toEqual(['kaputt.json']);
    const log = readFileSync(dirs.sentLogFile, 'utf8');
    expect(log).toMatch(/rejected/);
  });

  it('sendFn wirft: nach failed/ verschoben, "failed" geloggt mit Fehlermeldung', async () => {
    const dirs = makeDirs();
    writeEntry(dirs.outboxDir, 'msg1.json', { chatJid: '4917xxx@s.whatsapp.net', text: 'Hallo' });
    const sendFn = vi.fn().mockRejectedValue(new Error('Timeout beim Senden'));

    await processOutboxOnce({
      ...dirs,
      sendFn,
      loadWhitelistFn: () => whitelist,
      loadSendConfigFn: () => ({ enabled: true }),
    });

    expect(readdirSync(dirs.failedDir)).toEqual(['msg1.json']);
    const log = readFileSync(dirs.sentLogFile, 'utf8');
    expect(log).toMatch(/4917xxx@s\.whatsapp\.net \| failed \| .*Timeout beim Senden/);
  });

  it('mehrere Dateien: jede wird genau einmal verarbeitet, keine doppelten Sends', async () => {
    const dirs = makeDirs();
    writeEntry(dirs.outboxDir, 'a.json', { chatJid: '4917xxx@s.whatsapp.net', text: 'A' });
    writeEntry(dirs.outboxDir, 'b.json', { chatJid: '4917xxx@s.whatsapp.net', text: 'B' });
    const sendFn = vi.fn().mockResolvedValue(undefined);

    await processOutboxOnce({
      ...dirs,
      sendFn,
      loadWhitelistFn: () => whitelist,
      loadSendConfigFn: () => ({ enabled: true }),
    });

    expect(sendFn).toHaveBeenCalledTimes(2);
    expect(readdirSync(dirs.doneDir).sort()).toEqual(['a.json', 'b.json']);
  });

  it('ignoriert Dateien in done/ und failed/ bei erneutem Lauf (keine Doppelverarbeitung)', async () => {
    const dirs = makeDirs();
    writeEntry(dirs.outboxDir, 'msg1.json', { chatJid: '4917xxx@s.whatsapp.net', text: 'Hallo' });
    const sendFn = vi.fn().mockResolvedValue(undefined);

    await processOutboxOnce({
      ...dirs,
      sendFn,
      loadWhitelistFn: () => whitelist,
      loadSendConfigFn: () => ({ enabled: true }),
    });
    await processOutboxOnce({
      ...dirs,
      sendFn,
      loadWhitelistFn: () => whitelist,
      loadSendConfigFn: () => ({ enabled: true }),
    });

    expect(sendFn).toHaveBeenCalledTimes(1);
  });

  it('leeres Outbox-Verzeichnis: kein Fehler, sendFn nicht aufgerufen', async () => {
    const dirs = makeDirs();
    const sendFn = vi.fn();
    await expect(
      processOutboxOnce({ ...dirs, sendFn, loadWhitelistFn: () => whitelist, loadSendConfigFn: () => ({ enabled: true }) }),
    ).resolves.not.toThrow();
    expect(sendFn).not.toHaveBeenCalled();
  });
});

describe('recoverOrphans', () => {
  it('verschiebt liegengebliebene .processing-Dateien (Crash-Fall) nach failed/ statt sie erneut zu senden', () => {
    const dirs = makeDirs();
    mkdirSync(dirs.processingDir, { recursive: true });
    mkdirSync(dirs.failedDir, { recursive: true });
    writeFileSync(
      path.join(dirs.processingDir, 'orphan.json'),
      JSON.stringify({ chatJid: '4917xxx@s.whatsapp.net', text: 'War in Arbeit' }),
    );

    recoverOrphans(dirs);

    expect(readdirSync(dirs.processingDir)).toEqual([]);
    expect(readdirSync(dirs.failedDir)).toEqual(['orphan.json']);
    const log = readFileSync(dirs.sentLogFile, 'utf8');
    expect(log).toMatch(/rejected.*unklar/i);
  });

  it('ist ein No-Op, wenn kein .processing-Verzeichnis existiert', () => {
    const dirs = makeDirs();
    expect(() => recoverOrphans(dirs)).not.toThrow();
  });
});
