import { describe, it, expect } from 'vitest';
import { writeStatus, readStatus } from './status.js';
import { rmSync } from 'node:fs';

describe('status', () => {
  it('Roundtrip: writeStatus → readStatus', () => {
    const file = '/tmp/wab-status.json';
    writeStatus({ connected: true, detail: 'open' }, file);
    const status = readStatus(file);
    expect(status?.connected).toBe(true);
    expect(status?.detail).toBe('open');
    expect(typeof status?.updatedAt).toBe('string');
    expect(Number.isNaN(Date.parse(status!.updatedAt))).toBe(false);
    rmSync(file);
  });

  it('readStatus → null wenn Datei fehlt', () => {
    expect(readStatus('/tmp/wab-status-nope.json')).toBeNull();
  });

  it('Roundtrip mit gaps (#483)', () => {
    const file = '/tmp/wab-status-gaps.json';
    const gaps = [{ from: '2026-08-25T16:14:39.998Z', to: '2026-08-25T16:59:26.562Z', minutes: 45 }];
    writeStatus({ connected: true, detail: 'open', gaps }, file);
    const status = readStatus(file);
    expect(status?.gaps).toEqual(gaps);
    rmSync(file);
  });

  it('gaps optional — fehlt im Objekt, wenn nicht übergeben', () => {
    const file = '/tmp/wab-status-nogaps.json';
    writeStatus({ connected: true, detail: 'open' }, file);
    const status = readStatus(file);
    expect(status?.gaps).toBeUndefined();
    rmSync(file);
  });
});
