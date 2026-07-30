import type { SendConfig } from './config.js';

/**
 * Reiner Entscheidungs-/Mapping-Layer für den Outbox-Send-Kanal (#312).
 * Bewusst ohne fs/Netz, damit die Regeln ohne Mocks testbar sind — analog
 * zu pipeline.ts auf der Empfangsseite.
 */

export interface OutboxEntry {
  chatJid: string;
  text: string;
}

/** Minimal-Info für Log/Ablage, auch wenn die Payload kaputt/unvollständig ist. */
export interface OutboxLogEntry {
  chatJid: string;
  text: string;
}

export type OutboxDecision =
  | { action: 'send'; entry: OutboxEntry }
  | { action: 'dry-run'; entry: OutboxEntry }
  | { action: 'reject'; reason: string; entry: OutboxLogEntry };

/**
 * Entscheidet, was mit einer Outbox-Datei passiert. Reihenfolge bewusst:
 * erst Format, dann Whitelist, erst danach das Feature-Flag — eine
 * Nicht-Whitelist-Nachricht wird NIE gesendet, egal wie das Flag steht.
 *
 * - `reject`: ungültiges Format ODER Chat nicht auf der Whitelist.
 * - `dry-run`: gültig + whitelisted, aber Feature-Flag aus (Default) — es
 *   wird NICHTS gesendet, nur geloggt, was gesendet WÜRDE.
 * - `send`: gültig + whitelisted + Feature-Flag explizit an.
 */
export function decideOutboxAction(
  raw: unknown,
  whitelist: Map<string, string>,
  sendConfig: SendConfig,
): OutboxDecision {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const chatJid = obj && typeof obj.chatJid === 'string' ? obj.chatJid : '';
  const text = obj && typeof obj.text === 'string' ? obj.text : '';

  if (!chatJid || !text) {
    return {
      action: 'reject',
      reason: 'ungültiges Format: chatJid/text fehlen oder sind kein nicht-leerer String',
      entry: { chatJid: chatJid || 'unbekannt', text },
    };
  }

  if (!whitelist.has(chatJid)) {
    return {
      action: 'reject',
      reason: `Chat nicht auf der Whitelist: ${chatJid}`,
      entry: { chatJid, text },
    };
  }

  const entry: OutboxEntry = { chatJid, text };
  return sendConfig.enabled ? { action: 'send', entry } : { action: 'dry-run', entry };
}

export type SentLogResult = 'sent' | 'dry-run' | 'failed' | 'rejected';

/** Formatiert eine Zeile für data/sent.log: `<ISO-Timestamp> | <chatJid> | <Ergebnis>[ | Detail]`. */
export function formatSentLogLine(
  entry: OutboxLogEntry,
  result: SentLogResult,
  detail?: string,
): string {
  const base = `${new Date().toISOString()} | ${entry.chatJid} | ${result}`;
  return `${detail ? `${base} | ${detail}` : base}\n`;
}
