/**
 * PN↔LID-Mapping-Persistenz (#532). Baileys v7 adressiert manche Kontakte
 * intern nur noch über eine LID ("…@lid") statt über die Telefonnummern-JID
 * ("…@s.whatsapp.net") — bei Wanja (4915203177631) schlägt die
 * Telefonnummern-Auflösung inzwischen fehl ("USync fetch yielded no results
 * for pending PNs"), Baileys selbst löst das intern über genau so ein
 * Mapping, das es (für Sende-Zwecke) im Auth-State cached. Wir spiegeln das
 * hier eigenständig und dauerhaft (data/lid-map.json, gitignored wie der
 * Rest von data/), damit:
 *   - der Sende-Weg eine bekannte LID nutzen kann, wenn die
 *     Telefonnummern-Auflösung (sock.onWhatsApp) fehlschlägt,
 *   - der Empfangs-Weg eingehende @lid-Nachrichten OHNE remoteJidAlt einer
 *     Whitelist-PN zuordnen kann (die Whitelist selbst bleibt PN-basiert).
 *
 * Bewusst eine simple JSON-Datei (Konvention wie status.json/sent.log),
 * kein SQLite — die Anzahl der Whitelist-Kontakte ist klein (aktuell 6).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

/** Default-Pfad des PN→LID-Mappings. */
export const LID_MAP_FILE = path.join(DATA_DIR, 'lid-map.json');

/** PN-JID ("…@s.whatsapp.net") → LID-JID ("…@lid"). */
export type LidMap = Record<string, string>;

/** Lädt das Mapping. Fehlende/kaputte Datei oder unerwartete Form → leere Map (fail-safe, kein Crash). */
export function loadLidMap(file: string = LID_MAP_FILE): LidMap {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const map: LidMap = {};
  for (const [pn, lid] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof lid === 'string' && lid.length > 0) map[pn] = lid;
  }
  return map;
}

/** Schreibt das Mapping (legt data/ bei Bedarf an). */
export function saveLidMap(map: LidMap, file: string = LID_MAP_FILE): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(map, null, 2)}\n`);
}

/**
 * Rein funktionale Merge-Operation (kein fs) — fügt/aktualisiert einen
 * PN→LID-Eintrag. `changed:false` + dieselbe Map-Referenz, wenn der Eintrag
 * bereits identisch vorhanden ist (spart unnötige saveLidMap-Aufrufe).
 */
export function upsertLidMapping(
  map: LidMap,
  pn: string,
  lid: string,
): { map: LidMap; changed: boolean } {
  if (map[pn] === lid) return { map, changed: false };
  return { map: { ...map, [pn]: lid }, changed: true };
}

/** Reverse-Lookup für den Empfangs-Weg: welche Whitelist-PN gehört zu dieser LID? */
export function pnForLid(map: LidMap, lid: string): string | undefined {
  for (const [pn, l] of Object.entries(map)) {
    if (l === lid) return pn;
  }
  return undefined;
}
