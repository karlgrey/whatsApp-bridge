/**
 * WA-Web-Version dynamisch auflösen (#326, 07.08.2026).
 *
 * Hintergrund: WhatsApp lehnt Verbindungen mit veralteter, in Baileys fest
 * codierter Web-Client-Version irgendwann mit 405 (client_too_old) ab
 * (wiederkehrendes Muster, siehe WhiskeySockets/Baileys#2370/#2107/#2159/
 * #2733 — zuletzt #325, 30.07.2026, behoben durch reinen Paket-Bump rc13→
 * rc14). Statt auf den nächsten manuellen Bump zu warten, wird die Version
 * bei jedem Prozessstart aus drei Quellen aufgelöst (erste, die eine als
 * aktuell markierte Version liefert, gewinnt):
 *
 *   1. `fetchLatestWaWebVersion()` — scraped die tatsächliche WA-Web-
 *      Client-Revision (sw.js), die WhatsApp aktuell verlangt. Primärquelle.
 *   2. `fetchLatestBaileysVersion()` — liest die von der Baileys-Community
 *      gepflegte Version aus dem Baileys-Repo (Defaults/index.ts).
 *   3. Paket-Default (`DEFAULT_CONNECTION_CONFIG.version`) — der in der
 *      installierten Baileys-Version fest codierte Wert, exakt das
 *      Verhalten vor #326.
 *
 * Beide Baileys-Fetches fangen Netzwerkfehler bereits intern ab und liefern
 * dann `isLatest: false` statt zu werfen — wir behandeln sie hier trotzdem
 * defensiv (try/catch + eigener Timeout), weil das kein garantiertes
 * Vertragsverhalten ist und der Timeout von Baileys nicht für beide Fetches
 * durchgereicht wird (fetchLatestBaileysVersion nimmt kein `signal` an).
 * Die Bridge darf am Fehlen/Timeout des Version-Endpoints NIE scheitern.
 */
import {
  fetchLatestWaWebVersion,
  fetchLatestBaileysVersion,
  DEFAULT_CONNECTION_CONFIG,
  type WAVersion,
} from '@whiskeysockets/baileys';

const DEFAULT_TIMEOUT_MS = 8_000;

export type WaVersionSource = 'wa-web' | 'baileys-repo' | 'package-default';

export interface WaVersionResult {
  version: WAVersion;
  source: WaVersionSource;
}

type FetchVersionFn = (options?: RequestInit) => Promise<{
  version: WAVersion;
  isLatest: boolean;
  error?: unknown;
}>;

export interface WaVersionDeps {
  fetchWaWeb?: FetchVersionFn;
  fetchBaileysRepo?: FetchVersionFn;
  packageDefaultVersion?: WAVersion;
  timeoutMs?: number;
  log?: (msg: string) => void;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout nach ${ms}ms (${label})`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/** Ein Auflösungsschritt: liefert die Version bei Erfolg, sonst `null` (nie einen Fehler). */
async function tryStep(
  label: WaVersionSource,
  fetchFn: () => Promise<{ version: WAVersion; isLatest: boolean; error?: unknown }>,
  timeoutMs: number,
  log: (msg: string) => void,
): Promise<WAVersion | null> {
  try {
    const result = await withTimeout(fetchFn(), timeoutMs, label);
    if (result.isLatest) {
      return result.version;
    }
    log(
      `WA-Web-Version (${label}) nicht verfügbar${result.error ? `: ${String(result.error)}` : ''} — nächster Fallback.`,
    );
    return null;
  } catch (err) {
    log(`WA-Web-Version (${label}) fehlgeschlagen: ${String(err)} — nächster Fallback.`);
    return null;
  }
}

/**
 * Löst die zu verwendende WA-Web-Version über die Fallback-Kette auf.
 * Wirft NIE — im schlimmsten Fall (beide Fetches down/Timeout) kommt der
 * Paket-Default zurück, exakt das Verhalten von vor #326.
 */
export async function resolveWaVersion(deps: WaVersionDeps = {}): Promise<WaVersionResult> {
  const {
    fetchWaWeb = fetchLatestWaWebVersion,
    fetchBaileysRepo = fetchLatestBaileysVersion,
    packageDefaultVersion = DEFAULT_CONNECTION_CONFIG.version as WAVersion,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    log = () => {},
  } = deps;

  const waWeb = await tryStep(
    'wa-web',
    () => fetchWaWeb({ signal: AbortSignal.timeout(timeoutMs) }),
    timeoutMs,
    log,
  );
  if (waWeb) {
    return { version: waWeb, source: 'wa-web' };
  }

  const baileysRepo = await tryStep('baileys-repo', () => fetchBaileysRepo(), timeoutMs, log);
  if (baileysRepo) {
    return { version: baileysRepo, source: 'baileys-repo' };
  }

  log(`WA-Web-Version: Fallback auf Paket-Default ${packageDefaultVersion.join('.')}.`);
  return { version: packageDefaultVersion, source: 'package-default' };
}
