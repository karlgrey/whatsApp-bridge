import { describe, it, expect } from 'vitest';
import { writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { loadLidMap, saveLidMap, upsertLidMapping, pnForLid } from './lid-map.js';

const FILE = '/tmp/wab-lid-map-test.json';

describe('loadLidMap', () => {
  it('liefert leere Map wenn Datei fehlt', () => {
    expect(loadLidMap('/tmp/wab-lid-map-nope.json')).toEqual({});
  });

  it('lädt {pn: lid}-Paare', () => {
    writeFileSync(FILE, JSON.stringify({ '4915203177631@s.whatsapp.net': '123456789@lid' }));
    expect(loadLidMap(FILE)).toEqual({ '4915203177631@s.whatsapp.net': '123456789@lid' });
    rmSync(FILE);
  });

  it('liefert leere Map bei kaputtem JSON, kein Crash', () => {
    writeFileSync(FILE, '{ kaputt');
    expect(loadLidMap(FILE)).toEqual({});
    rmSync(FILE);
  });

  it('liefert leere Map wenn Inhalt kein Objekt ist (z. B. Array)', () => {
    writeFileSync(FILE, JSON.stringify(['nicht', 'erwartet']));
    expect(loadLidMap(FILE)).toEqual({});
    rmSync(FILE);
  });

  it('ignoriert Einträge mit nicht-String-Werten', () => {
    writeFileSync(FILE, JSON.stringify({ 'a@s.whatsapp.net': 123, 'b@s.whatsapp.net': 'b@lid' }));
    expect(loadLidMap(FILE)).toEqual({ 'b@s.whatsapp.net': 'b@lid' });
    rmSync(FILE);
  });
});

describe('saveLidMap', () => {
  it('schreibt die Map als JSON, wieder lesbar über loadLidMap', () => {
    saveLidMap({ '4915203177631@s.whatsapp.net': '123456789@lid' }, FILE);
    expect(existsSync(FILE)).toBe(true);
    expect(loadLidMap(FILE)).toEqual({ '4915203177631@s.whatsapp.net': '123456789@lid' });
    rmSync(FILE);
  });

  it('legt fehlende Verzeichnisse an', () => {
    const nested = '/tmp/wab-lid-map-dir/sub/lid-map.json';
    saveLidMap({ 'a@s.whatsapp.net': 'a@lid' }, nested);
    expect(readFileSync(nested, 'utf8')).toContain('a@lid');
    rmSync('/tmp/wab-lid-map-dir', { recursive: true, force: true });
  });
});

describe('upsertLidMapping', () => {
  it('fügt einen neuen Eintrag hinzu, changed:true', () => {
    const { map, changed } = upsertLidMapping({}, '4917xxx@s.whatsapp.net', '111@lid');
    expect(changed).toBe(true);
    expect(map).toEqual({ '4917xxx@s.whatsapp.net': '111@lid' });
  });

  it('ist idempotent — identischer Eintrag → changed:false, keine neue Map-Referenz nötig', () => {
    const base = { '4917xxx@s.whatsapp.net': '111@lid' };
    const { map, changed } = upsertLidMapping(base, '4917xxx@s.whatsapp.net', '111@lid');
    expect(changed).toBe(false);
    expect(map).toBe(base);
  });

  it('überschreibt einen abweichenden Eintrag, changed:true', () => {
    const base = { '4917xxx@s.whatsapp.net': '111@lid' };
    const { map, changed } = upsertLidMapping(base, '4917xxx@s.whatsapp.net', '222@lid');
    expect(changed).toBe(true);
    expect(map).toEqual({ '4917xxx@s.whatsapp.net': '222@lid' });
    // Original bleibt unangetastet (pure)
    expect(base).toEqual({ '4917xxx@s.whatsapp.net': '111@lid' });
  });
});

describe('pnForLid', () => {
  it('findet die PN zu einer bekannten LID', () => {
    const map = { '4917xxx@s.whatsapp.net': '111@lid', '4930yyy@s.whatsapp.net': '222@lid' };
    expect(pnForLid(map, '222@lid')).toBe('4930yyy@s.whatsapp.net');
  });

  it('liefert undefined für unbekannte LID', () => {
    expect(pnForLid({ '4917xxx@s.whatsapp.net': '111@lid' }, '999@lid')).toBeUndefined();
  });
});
