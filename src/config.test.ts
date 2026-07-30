import { describe, it, expect } from 'vitest';
import { loadWhitelist, loadSendConfig } from './config.js';
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

describe('loadSendConfig', () => {
  it('liefert enabled:false wenn Datei fehlt (fail-safe Default)', () => {
    expect(loadSendConfig('/tmp/wab-send-nope.json')).toEqual({ enabled: false });
  });

  it('liefert enabled:false bei kaputtem JSON', () => {
    writeFileSync('/tmp/wab-send-broken.json', '{ nicht: json');
    expect(loadSendConfig('/tmp/wab-send-broken.json')).toEqual({ enabled: false });
    rmSync('/tmp/wab-send-broken.json');
  });

  it('liefert enabled:false wenn das Feld fehlt oder nicht genau true ist', () => {
    writeFileSync('/tmp/wab-send-empty.json', JSON.stringify({}));
    expect(loadSendConfig('/tmp/wab-send-empty.json')).toEqual({ enabled: false });
    writeFileSync('/tmp/wab-send-truthy.json', JSON.stringify({ enabled: 'yes' }));
    expect(loadSendConfig('/tmp/wab-send-truthy.json')).toEqual({ enabled: false });
    rmSync('/tmp/wab-send-empty.json');
    rmSync('/tmp/wab-send-truthy.json');
  });

  it('liefert enabled:true wenn explizit gesetzt', () => {
    writeFileSync('/tmp/wab-send-on.json', JSON.stringify({ enabled: true }));
    expect(loadSendConfig('/tmp/wab-send-on.json')).toEqual({ enabled: true });
    rmSync('/tmp/wab-send-on.json');
  });
});
