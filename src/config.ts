import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Datenverzeichnis (gitignored): Auth-State, DB, Logs, Status. */
export const DATA_DIR = path.resolve(import.meta.dirname, '../data');

/** Default-Pfad der Whitelist. */
export const CHATS_CONFIG = path.resolve(import.meta.dirname, '../config/chats.json');

interface WhitelistEntry {
  jid: string;
  name: string;
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
