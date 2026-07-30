import { describe, it, expect } from 'vitest';
import { decideOutboxAction, formatSentLogLine } from './outbox.js';

const whitelist = new Map([['4917xxx@s.whatsapp.net', 'Wanja']]);

describe('decideOutboxAction', () => {
  it('sendet, wenn whitelisted + Feature-Flag an', () => {
    const decision = decideOutboxAction(
      { chatJid: '4917xxx@s.whatsapp.net', text: 'Pumpe ist da.' },
      whitelist,
      { enabled: true },
    );
    expect(decision).toEqual({
      action: 'send',
      entry: { chatJid: '4917xxx@s.whatsapp.net', text: 'Pumpe ist da.' },
    });
  });

  it('Dry-Run, wenn whitelisted aber Feature-Flag aus (Default)', () => {
    const decision = decideOutboxAction(
      { chatJid: '4917xxx@s.whatsapp.net', text: 'Pumpe ist da.' },
      whitelist,
      { enabled: false },
    );
    expect(decision).toEqual({
      action: 'dry-run',
      entry: { chatJid: '4917xxx@s.whatsapp.net', text: 'Pumpe ist da.' },
    });
  });

  it('verweigert Chats außerhalb der Whitelist, auch bei enabled:true', () => {
    const decision = decideOutboxAction(
      { chatJid: '4930999@s.whatsapp.net', text: 'Hallo' },
      whitelist,
      { enabled: true },
    );
    expect(decision.action).toBe('reject');
    if (decision.action === 'reject') {
      expect(decision.reason).toMatch(/Whitelist/);
      expect(decision.entry.chatJid).toBe('4930999@s.whatsapp.net');
    }
  });

  it('verweigert fehlendes/leeres chatJid', () => {
    const decision = decideOutboxAction({ text: 'Hallo' }, whitelist, { enabled: true });
    expect(decision.action).toBe('reject');
  });

  it('verweigert fehlenden/leeren text', () => {
    const decision = decideOutboxAction(
      { chatJid: '4917xxx@s.whatsapp.net', text: '' },
      whitelist,
      { enabled: true },
    );
    expect(decision.action).toBe('reject');
  });

  it('verweigert komplett kaputte Payloads (kein Objekt)', () => {
    const decision = decideOutboxAction('nicht ein objekt', whitelist, { enabled: true });
    expect(decision.action).toBe('reject');
    if (decision.action === 'reject') {
      expect(decision.entry.chatJid).toBe('unbekannt');
    }
  });

  it('verweigert null-Payload', () => {
    const decision = decideOutboxAction(null, whitelist, { enabled: true });
    expect(decision.action).toBe('reject');
  });
});

describe('formatSentLogLine', () => {
  it('formatiert eine sent-Zeile mit ISO-Timestamp, chatJid, Ergebnis', () => {
    const line = formatSentLogLine({ chatJid: '4917xxx@s.whatsapp.net', text: 'Hi' }, 'sent');
    expect(line).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \| 4917xxx@s\.whatsapp\.net \| sent\n$/,
    );
  });

  it('hängt Detail an, wenn vorhanden (z. B. Fehlermeldung)', () => {
    const line = formatSentLogLine(
      { chatJid: '4917xxx@s.whatsapp.net', text: 'Hi' },
      'failed',
      'Timeout',
    );
    expect(line).toMatch(/\| failed \| Timeout\n$/);
  });
});
