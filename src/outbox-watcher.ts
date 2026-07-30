/**
 * Outbox-Watcher (#312): überwacht data/outbox/*.json und sendet über die
 * BESTEHENDE Baileys-Session (kein zweiter Prozess). V1 sendet niemals
 * autonom — ohne explizit gesetztes Feature-Flag (config/send.json,
 * `loadSendConfig`, Default AUS) läuft der Watcher im Dry-Run: er loggt nur,
 * was er senden WÜRDE, verschickt aber nichts.
 *
 * Ablage manuell freigegebener Nachrichten: `{chatJid, text}` als JSON-Datei
 * direkt in data/outbox/. Verarbeitete Dateien werden atomar (rename, selbes
 * Filesystem) wegverschoben — erst in .processing/ (Claim), dann je nach
 * Ergebnis nach done/ oder failed/ — damit nichts doppelt gesendet wird.
 */
import { readdirSync, readFileSync, renameSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR, loadWhitelist, loadSendConfig, type SendConfig } from './config.js';
import { decideOutboxAction, formatSentLogLine, type OutboxLogEntry, type SentLogResult } from './outbox.js';

export const OUTBOX_DIR = path.join(DATA_DIR, 'outbox');
export const OUTBOX_DONE_DIR = path.join(OUTBOX_DIR, 'done');
export const OUTBOX_FAILED_DIR = path.join(OUTBOX_DIR, 'failed');
export const OUTBOX_PROCESSING_DIR = path.join(OUTBOX_DIR, '.processing');
export const SENT_LOG_FILE = path.join(DATA_DIR, 'sent.log');

/** Sendet eine Nachricht über die aktive Baileys-Session; wird von bridge.ts injiziert. */
export type SendFn = (chatJid: string, text: string) => Promise<void>;

export interface OutboxDirs {
  outboxDir?: string;
  doneDir?: string;
  failedDir?: string;
  processingDir?: string;
  sentLogFile?: string;
}

export interface OutboxWatcherOptions extends OutboxDirs {
  sendFn: SendFn;
  loadWhitelistFn?: () => Map<string, string>;
  loadSendConfigFn?: () => SendConfig;
  log?: (msg: string) => void;
}

interface ResolvedDirs {
  outboxDir: string;
  doneDir: string;
  failedDir: string;
  processingDir: string;
  sentLogFile: string;
}

function resolveDirs(opts: OutboxDirs): ResolvedDirs {
  return {
    outboxDir: opts.outboxDir ?? OUTBOX_DIR,
    doneDir: opts.doneDir ?? OUTBOX_DONE_DIR,
    failedDir: opts.failedDir ?? OUTBOX_FAILED_DIR,
    processingDir: opts.processingDir ?? OUTBOX_PROCESSING_DIR,
    sentLogFile: opts.sentLogFile ?? SENT_LOG_FILE,
  };
}

function ensureDirs(dirs: ResolvedDirs): void {
  mkdirSync(dirs.outboxDir, { recursive: true });
  mkdirSync(dirs.doneDir, { recursive: true });
  mkdirSync(dirs.failedDir, { recursive: true });
  mkdirSync(dirs.processingDir, { recursive: true });
}

function logResult(
  sentLogFile: string,
  entry: OutboxLogEntry,
  result: SentLogResult,
  detail: string | undefined,
  log: (msg: string) => void,
  fileName: string,
): void {
  appendFileSync(sentLogFile, formatSentLogLine(entry, result, detail));
  log(`Outbox ${fileName}: ${result}${detail ? ` (${detail})` : ''}`);
}

export interface OutboxWatcherHandle {
  stop(): void;
}

/** Poll-Intervall — kein fs-Watch, damit ein liegender Prozess-Hänger nicht zu verpassten Events führt. */
export const POLL_INTERVAL_MS = 5_000;

/**
 * Startet das Polling (setInterval, kein fs.watch — robuster bei
 * verzögertem/gebatchtem FS-Events auf macOS). Räumt vor dem ersten Tick
 * Crash-Reste aus einem vorherigen Lauf weg (recoverOrphans). Reentranz-Schutz:
 * ein laufender Tick blockiert den nächsten, überlappende Läufe sind
 * ausgeschlossen. `stop()` beendet das Polling (z. B. bei Verbindungsverlust,
 * da der injizierte sendFn dann eine tote Session nutzen würde).
 */
export function startOutboxWatcher(
  opts: OutboxWatcherOptions & { intervalMs?: number },
): OutboxWatcherHandle {
  const log = opts.log ?? (() => {});
  recoverOrphans({ ...opts, log });

  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    processOutboxOnce(opts)
      .catch((err) => log(`Outbox-Watcher-Fehler: ${String(err)}`))
      .finally(() => {
        running = false;
      });
  }, opts.intervalMs ?? POLL_INTERVAL_MS);

  return { stop: () => clearInterval(timer) };
}

/**
 * Ein Durchlauf: verarbeitet alle *.json-Dateien direkt in outboxDir
 * (Unterordner done/failed/.processing werden nicht rekursiv gescannt).
 * Jede Datei wird zuerst nach .processing/ geclaimt (atomarer rename), bevor
 * gesendet wird — das verhindert doppelte Verarbeitung bei überlappenden
 * Läufen und macht Crash-Reste erkennbar (siehe recoverOrphans).
 */
export async function processOutboxOnce(opts: OutboxWatcherOptions): Promise<void> {
  const dirs = resolveDirs(opts);
  const log = opts.log ?? (() => {});
  ensureDirs(dirs);

  let files: string[];
  try {
    files = readdirSync(dirs.outboxDir).filter((f) => f.endsWith('.json'));
  } catch {
    return;
  }
  if (files.length === 0) return;

  const whitelist = (opts.loadWhitelistFn ?? loadWhitelist)();
  const sendConfig = (opts.loadSendConfigFn ?? loadSendConfig)();

  for (const fileName of files) {
    const srcPath = path.join(dirs.outboxDir, fileName);
    const claimedPath = path.join(dirs.processingDir, fileName);
    try {
      renameSync(srcPath, claimedPath);
    } catch (err) {
      // Datei ist verschwunden/schon geclaimt (z. B. überlappender Lauf) — überspringen.
      log(`Outbox ${fileName}: konnte nicht geclaimt werden (${String(err)}), übersprungen.`);
      continue;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(claimedPath, 'utf8'));
    } catch (err) {
      renameSync(claimedPath, path.join(dirs.failedDir, fileName));
      logResult(dirs.sentLogFile, { chatJid: 'unbekannt', text: '' }, 'rejected', `ungültiges JSON: ${String(err)}`, log, fileName);
      continue;
    }

    const decision = decideOutboxAction(raw, whitelist, sendConfig);

    if (decision.action === 'reject') {
      renameSync(claimedPath, path.join(dirs.failedDir, fileName));
      logResult(dirs.sentLogFile, decision.entry, 'rejected', decision.reason, log, fileName);
      continue;
    }

    if (decision.action === 'dry-run') {
      log(`[dry-run] Würde senden an ${decision.entry.chatJid}: "${decision.entry.text.slice(0, 80)}"`);
      renameSync(claimedPath, path.join(dirs.doneDir, fileName));
      logResult(dirs.sentLogFile, decision.entry, 'dry-run', undefined, log, fileName);
      continue;
    }

    // decision.action === 'send'
    try {
      await opts.sendFn(decision.entry.chatJid, decision.entry.text);
      renameSync(claimedPath, path.join(dirs.doneDir, fileName));
      logResult(dirs.sentLogFile, decision.entry, 'sent', undefined, log, fileName);
    } catch (err) {
      renameSync(claimedPath, path.join(dirs.failedDir, fileName));
      logResult(dirs.sentLogFile, decision.entry, 'failed', String(err), log, fileName);
    }
  }
}

/**
 * Räumt beim Watcher-Start liegengebliebene .processing-Dateien weg (Crash
 * zwischen Claim und Ergebnis-rename). Der Sende-Status ist dann UNBEKANNT —
 * um kein Risiko einzugehen (weder doppelt senden noch eine offene Nachricht
 * stillschweigend verlieren), landen sie in failed/ mit klarem Hinweis zur
 * manuellen Prüfung, statt automatisch erneut verarbeitet zu werden.
 */
export function recoverOrphans(opts: OutboxDirs & { log?: (msg: string) => void } = {}): void {
  const dirs = resolveDirs(opts);
  const log = opts.log ?? (() => {});
  ensureDirs(dirs);

  let files: string[];
  try {
    files = readdirSync(dirs.processingDir).filter((f) => f.endsWith('.json'));
  } catch {
    return;
  }

  for (const fileName of files) {
    const claimedPath = path.join(dirs.processingDir, fileName);
    let entry: OutboxLogEntry = { chatJid: 'unbekannt', text: '' };
    try {
      const raw = JSON.parse(readFileSync(claimedPath, 'utf8')) as Partial<OutboxLogEntry>;
      entry = {
        chatJid: typeof raw.chatJid === 'string' ? raw.chatJid : 'unbekannt',
        text: typeof raw.text === 'string' ? raw.text : '',
      };
    } catch {
      // Inhalt unlesbar — Fallback-Entry bleibt stehen, trotzdem nach failed/ verschieben.
    }
    renameSync(claimedPath, path.join(dirs.failedDir, fileName));
    logResult(
      dirs.sentLogFile,
      entry,
      'rejected',
      'unklarer Zustand nach Neustart (Crash während Verarbeitung) — manuell prüfen',
      log,
      fileName,
    );
  }
}
