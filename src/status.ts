import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import type { ConnectionGap } from './gap-detector.js';

/** Default-Pfad der Status-Datei (liest u. a. das Standup-Skill). */
export const STATUS_FILE = path.join(DATA_DIR, 'status.json');

export interface BridgeStatus {
  connected: boolean;
  detail?: string;
  updatedAt: string;
  /** Erkannte Offline-Fenster oberhalb der Lücken-Schwelle (#483) — leer/fehlend = keine bekannten Lücken. */
  gaps?: ConnectionGap[];
}

/** Schreibt den Verbindungszustand als JSON (atomar genug für lokale Leser). */
export function writeStatus(
  state: { connected: boolean; detail?: string; gaps?: ConnectionGap[] },
  file: string = STATUS_FILE,
): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const status: BridgeStatus = { ...state, updatedAt: new Date().toISOString() };
  writeFileSync(file, JSON.stringify(status, null, 2) + '\n');
}

/** Liest die Status-Datei; null wenn nicht vorhanden/unlesbar. */
export function readStatus(file: string = STATUS_FILE): BridgeStatus | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as BridgeStatus;
  } catch {
    return null;
  }
}
