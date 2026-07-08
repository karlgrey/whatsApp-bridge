import { describe, it, expect } from 'vitest';
import { loadWhitelist } from './config.js';
import { writeFileSync, rmSync } from 'node:fs';

describe('loadWhitelist', () => {
  it('liefert leere Map wenn Datei fehlt', () => {
    expect(loadWhitelist('/tmp/wab-nope.json').size).toBe(0);
  });
  it('lädt {jid,name}-Einträge', () => {
    writeFileSync('/tmp/wab-chats.json', JSON.stringify([{ jid: '4917xxx@s.whatsapp.net', name: 'Wanja' }]));
    const wl = loadWhitelist('/tmp/wab-chats.json');
    expect(wl.get('4917xxx@s.whatsapp.net')).toBe('Wanja');
    rmSync('/tmp/wab-chats.json');
  });
});
