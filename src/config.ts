import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Datenverzeichnis (gitignored): Auth-State, DB, Logs, Status. */
export const DATA_DIR = path.resolve(import.meta.dirname, '../data');

/** Default-Pfad der Whitelist. */
export const CHATS_CONFIG = path.resolve(import.meta.dirname, '../config/chats.json');

/** Default-Pfad des Send-Feature-Flags (#312). */
export const SEND_CONFIG = path.resolve(import.meta.dirname, '../config/send.json');

interface WhitelistEntry {
  jid: string;
  name: string;
}

export interface SendConfig {
  enabled: boolean;
}

/**
 * Lädt die Chat-Whitelist (JSON-Array von {jid, name}).
 * Fehlende oder kaputte Datei → leere Map (es wird dann NICHTS persistiert).
 */
export function loadWhitelist(file: string = CHATS_CONFIG): Map<string, string> {
  const whitelist = new Map<string, string>();
  let rawText: string;
  try {
    rawText = readFileSync(file, 'utf8');
  } catch {
    console.warn(`[config] Whitelist ${file} nicht gefunden — es wird nichts gespeichert.`);
    return whitelist;
  }
  try {
    const entries = JSON.parse(rawText) as WhitelistEntry[];
    if (!Array.isArray(entries)) throw new Error('kein JSON-Array');
    for (const entry of entries) {
      if (entry && typeof entry.jid === 'string' && entry.jid.length > 0) {
        whitelist.set(entry.jid, typeof entry.name === 'string' ? entry.name : entry.jid);
      }
    }
  } catch (err) {
    console.warn(`[config] Whitelist ${file} unlesbar (${String(err)}) — es wird nichts gespeichert.`);
    return new Map();
  }
  return whitelist;
}

/**
 * Lädt das Send-Feature-Flag (#312). Fail-safe: fehlende/kaputte Datei oder
 * `enabled` ungleich dem literalen `true` → immer `{enabled: false}` (Dry-Run).
 * Das ist die harte Vorgabe „V1 sendet niemals autonom" — Default AUS.
 */
export function loadSendConfig(file: string = SEND_CONFIG): SendConfig {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { enabled?: unknown };
    return { enabled: parsed.enabled === true };
  } catch {
    return { enabled: false };
  }
}
