/**
 * PN↔LID-Auflösung für den Sende-Weg (#532). Baileys' `onWhatsApp` warnte
 * bei Wanja (4915203177631) bereits VOR dem eigentlichen Versand mit
 * "USync fetch yielded no results for pending PNs" — sein Konto ist per
 * Telefonnummer nicht mehr auflösbar (LID-only). Der Outbox-Watcher sendete
 * trotzdem "stur" an die konfigurierte PN-JID, `sock.sendMessage` schlug
 * intern fehl, aber der Watcher schrieb dennoch "sent" ins sent.log — die
 * Nachricht kam nie an, ohne dass das irgendwo sichtbar wurde.
 *
 * Dieses Modul bricht den Versand in zwei testbare Schritte:
 *   - `resolveSendJid`: reine Entscheidungslogik (kein fs/Netz außer dem
 *     injizierten `onWhatsApp`) — analog zu outbox.ts' decideOutboxAction.
 *   - `sendToPn`: verdrahtet Auflösung + injizierten `sendMessage`-Aufruf.
 *     Kann keine Zustellung erreicht werden, wirft sie einen Error MIT
 *     Grund — der bestehende outbox-watcher.ts-Fehlerpfad (sendFn wirft →
 *     "failed" + Detail im Log) greift dann unverändert. Es gibt also
 *     bewusst keinen dritten Erfolgs-Pfad, der ein "sent" ohne echten
 *     Versand erzeugen könnte.
 *
 * Reihenfolge in resolveSendJid: erst `onWhatsApp(pn)` (frisch, live) —
 * liefert es einen Treffer, gewinnt der (PN- oder LID-Form, "wie bisher"
 * bzw. neu). Erst wenn das fehlschlägt (kein Treffer ODER die Anfrage
 * wirft), zählt eine bereits bekannte LID aus dem persistenten Mapping
 * (lid-map.ts) als Fallback. Kein Treffer und keine bekannte LID → ok:false.
 */
import type { LidMap } from './lid-map.js';
import { upsertLidMapping } from './lid-map.js';

export interface OnWhatsAppResult {
  jid: string;
  exists: boolean;
}

/** Minimaler struktureller Typ für sock.onWhatsApp — eine PN pro Aufruf. */
export type OnWhatsAppFn = (jid: string) => Promise<OnWhatsAppResult[] | undefined>;

export type SendJidResolution =
  | { ok: true; targetJid: string; via: 'pn' | 'lid-onwhatsapp' | 'lid-map'; learnedLid?: string }
  | { ok: false; reason: string };

async function tryOnWhatsApp(
  pn: string,
  onWhatsApp: OnWhatsAppFn,
): Promise<OnWhatsAppResult | undefined> {
  try {
    const results = await onWhatsApp(pn);
    return results?.find((r) => r.exists);
  } catch {
    // Netzwerk-/USync-Fehler: kein Treffer, aber kein Crash — Fallback auf
    // die bekannte LID (falls vorhanden) darf trotzdem greifen.
    return undefined;
  }
}

/**
 * Löst die Ziel-JID für eine Whitelist-PN auf. `knownLid` ist die bereits
 * bekannte LID aus dem persistenten Mapping (undefined = keine bekannt).
 */
export async function resolveSendJid(
  pn: string,
  onWhatsApp: OnWhatsAppFn,
  knownLid: string | undefined,
): Promise<SendJidResolution> {
  let onWhatsAppFailed = false;
  let hit: OnWhatsAppResult | undefined;
  let errorDetail: string | undefined;
  try {
    const results = await onWhatsApp(pn);
    hit = results?.find((r) => r.exists);
  } catch (err) {
    onWhatsAppFailed = true;
    errorDetail = String(err);
  }

  if (hit) {
    if (hit.jid.endsWith('@lid')) {
      return { ok: true, targetJid: hit.jid, via: 'lid-onwhatsapp', learnedLid: hit.jid };
    }
    return { ok: true, targetJid: hit.jid, via: 'pn' };
  }

  if (knownLid) {
    return { ok: true, targetJid: knownLid, via: 'lid-map' };
  }

  const base = `Zustellung nicht möglich für ${pn}: weder per Telefonnummer noch per bekannter LID erreichbar`;
  return {
    ok: false,
    reason: onWhatsAppFailed ? `${base} (onWhatsApp-Fehler: ${errorDetail})` : `${base} (onWhatsApp lieferte keinen Treffer)`,
  };
}

export interface SendToPnDeps {
  onWhatsApp: OnWhatsAppFn;
  sendMessage: (jid: string, text: string) => Promise<void>;
  /** Bereits bekannte LID für diese PN (aus dem persistenten Mapping), falls vorhanden. */
  knownLid?: string;
  /** Wird aufgerufen, wenn resolveSendJid eine bisher unbekannte LID liefert — Aufrufer persistiert. */
  onLearnedLid?: (lid: string) => void;
  log?: (msg: string) => void;
}

/**
 * Löst die Ziel-JID für `pn` auf und sendet darüber. Wirft, wenn keine
 * Zustellung möglich ist ODER wenn `sendMessage` selbst wirft — in beiden
 * Fällen NIE "sent" vortäuschen (siehe Modul-Kommentar).
 */
export async function sendToPn(pn: string, text: string, deps: SendToPnDeps): Promise<void> {
  const log = deps.log ?? (() => {});
  const resolution = await resolveSendJid(pn, deps.onWhatsApp, deps.knownLid);
  if (!resolution.ok) {
    throw new Error(resolution.reason);
  }
  if (resolution.learnedLid) {
    deps.onLearnedLid?.(resolution.learnedLid);
  }
  log(`Sende an ${pn} → ${resolution.targetJid} (${resolution.via})`);
  await deps.sendMessage(resolution.targetJid, text);
}

export interface WhitelistLidResolutionResult {
  pn: string;
  name: string;
  status: 'pn' | 'lid' | 'unresolved';
  jid?: string;
}

/**
 * Startet die Whitelist-weite LID-Auflösung (#532, "Beim Daemon-Start"):
 * ruft `onWhatsApp` für jede Telefonnummern-JID der Whitelist auf (Nicht-PN-
 * Einträge wie Gruppen werden übersprungen), baut ein LidMap-Delta für
 * LID-Treffer und loggt das Ergebnis pro Kontakt (Verifikationsgrundlage).
 * Wirft nie — ein Fehlschlag pro Kontakt landet als `status: 'unresolved'`.
 */
export async function resolveWhitelistLids(
  whitelist: Map<string, string>,
  onWhatsApp: OnWhatsAppFn,
  log: (msg: string) => void = () => {},
): Promise<{ map: LidMap; results: WhitelistLidResolutionResult[] }> {
  let map: LidMap = {};
  const results: WhitelistLidResolutionResult[] = [];

  for (const [pn, name] of whitelist) {
    if (!pn.endsWith('@s.whatsapp.net')) continue; // Gruppen/Kanäle: LID-Auflösung ergibt keinen Sinn.

    const hit = await tryOnWhatsApp(pn, onWhatsApp);
    if (!hit) {
      log(`LID-Auflösung ${name} (${pn}): kein Treffer.`);
      results.push({ pn, name, status: 'unresolved' });
      continue;
    }

    if (hit.jid.endsWith('@lid')) {
      map = upsertLidMapping(map, pn, hit.jid).map;
      log(`LID-Auflösung ${name} (${pn}): LID gefunden → ${hit.jid}.`);
      results.push({ pn, name, status: 'lid', jid: hit.jid });
    } else {
      log(`LID-Auflösung ${name} (${pn}): per Telefonnummer erreichbar (${hit.jid}).`);
      results.push({ pn, name, status: 'pn', jid: hit.jid });
    }
  }

  return { map, results };
}
