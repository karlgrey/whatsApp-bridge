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
});
