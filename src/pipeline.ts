import type { StoredMessage } from './storage.js';
import { pnForLid, type LidMap } from './lid-map.js';

/**
 * Minimaler struktureller Typ für eingehende Baileys-Nachrichten —
 * bewusst ohne Baileys-Import, damit die Pipeline pur testbar bleibt.
 */
export interface BaileysLikeMessage {
  key: {
    id?: string | null;
    remoteJid?: string | null;
    /** Baileys v7: bei LID-Adressierung trägt remoteJid "…@lid" und
     *  remoteJidAlt die Telefonnummern-Adresse ("…@s.whatsapp.net"). */
    remoteJidAlt?: string | null;
    participant?: string | null;
    fromMe?: boolean | null;
  };
  messageTimestamp?: number | { toNumber(): number } | null;
  pushName?: string | null;
  message?: {
    conversation?: string | null;
    extendedTextMessage?: { text?: string | null } | null;
    imageMessage?: object | null;
    videoMessage?: object | null;
    audioMessage?: object | null;
    documentMessage?: object | null;
    [key: string]: unknown;
  } | null;
}

const MEDIA_TYPES: Array<[key: string, label: string]> = [
  ['imageMessage', 'image'],
  ['videoMessage', 'video'],
  ['audioMessage', 'audio'],
  ['documentMessage', 'document'],
];

function toUnixSeconds(ts: BaileysLikeMessage['messageTimestamp']): number {
  if (typeof ts === 'number') return ts;
  if (ts && typeof (ts as { toNumber(): number }).toNumber === 'function') {
    return (ts as { toNumber(): number }).toNumber();
  }
  return Math.floor(Date.now() / 1000);
}

/**
 * WhatsApp-Stories laufen über das Pseudo-Chat-JID "status@broadcast",
 * Kanäle über "@newsletter", alte Broadcast-Listen über "@broadcast".
 * Keine davon sind echte Chat-Nachrichten (#412) — werden hart verworfen,
 * unabhängig von der Whitelist (die sie ohnehin nie enthalten sollte).
 */
function isStoryOrBroadcastJid(jid: string): boolean {
  return jid === 'status@broadcast' || jid.endsWith('@newsletter') || jid.endsWith('@broadcast');
}

/**
 * Whitelist-Filter + Mapping auf StoredMessage.
 * null = verwerfen (Chat nicht auf der Whitelist ODER weder Text noch Medium).
 * Nachrichten außerhalb der Whitelist werden NIE persistiert.
 *
 * `lidMap` (#532, Default {}): gelerntes PN→LID-Mapping (siehe lid-map.ts).
 * Fallback, wenn eine eingehende @lid-Nachricht KEIN remoteJidAlt trägt (bei
 * manchen Kontakten, z. B. Wanja, fehlt es) — die LID wird dann gegen das
 * Mapping aufgelöst, um die zugehörige Whitelist-PN zu finden. Gespeichert
 * wird weiterhin immer die kanonische PN-JID (unverändert seit dem
 * remoteJidAlt-Fix vom 09.07.2026).
 */
export function mapMessage(
  raw: BaileysLikeMessage,
  whitelist: Map<string, string>,
  lidMap: LidMap = {},
): StoredMessage | null {
  // LID-Adressierung: Whitelist gegen beide JID-Formen prüfen; gespeichert
  // wird immer die Whitelist-JID (kanonische Telefonnummern-Adresse).
  const candidates = [raw.key?.remoteJid, raw.key?.remoteJidAlt].filter(
    (jid): jid is string => typeof jid === 'string' && jid !== '',
  );
  if (candidates.some(isStoryOrBroadcastJid)) return null;
  let chatJid = '';
  let chatName: string | undefined;
  for (const jid of candidates) {
    const name = whitelist.get(jid);
    if (name !== undefined) {
      chatJid = jid;
      chatName = name;
      break;
    }
  }
  // Fallback (#532): keine direkte Whitelist-Übereinstimmung — bei einer
  // @lid-Nachricht ohne (whitelisted) remoteJidAlt über das PN↔LID-Mapping
  // versuchen, die zugehörige Whitelist-PN zu finden.
  if (chatName === undefined) {
    const lidCandidate = candidates.find((jid) => jid.endsWith('@lid'));
    if (lidCandidate) {
      const pn = pnForLid(lidMap, lidCandidate);
      const name = pn !== undefined ? whitelist.get(pn) : undefined;
      if (pn !== undefined && name !== undefined) {
        chatJid = pn;
        chatName = name;
      }
    }
  }
  if (chatName === undefined) return null;

  const msg = raw.message ?? {};
  const text = msg.conversation ?? msg.extendedTextMessage?.text ?? '';

  let mediaType: string | null = null;
  for (const [key, label] of MEDIA_TYPES) {
    if (msg[key]) {
      mediaType = label;
      break;
    }
  }

  if (text === '' && mediaType === null) return null;

  const fromMe = raw.key?.fromMe === true;
  const sender = fromMe ? 'me' : (raw.key?.participant ?? chatJid);
  const senderName = fromMe ? 'Micha' : (raw.pushName ?? sender);

  return {
    id: raw.key?.id ?? `${chatJid}:${String(raw.messageTimestamp)}`,
    chatJid,
    chatName,
    sender,
    senderName,
    timestamp: toUnixSeconds(raw.messageTimestamp),
    text,
    mediaType,
  };
}

/**
 * Lernt eine PN↔LID-Zuordnung aus einer eingehenden Nachricht (#532):
 * kommt remoteJid als "…@lid" UND remoteJidAlt als Telefonnummern-JID an,
 * ist das Paar bekannt — unabhängig von der Whitelist (die Filterung
 * passiert separat in mapMessage). Der Aufrufer (bridge.ts) persistiert das
 * Paar über lid-map.ts, damit spätere @lid-Nachrichten OHNE remoteJidAlt
 * (siehe mapMessage-Fallback oben) trotzdem zugeordnet werden können.
 */
export function learnLidMappingFromMessage(
  raw: BaileysLikeMessage,
): { pn: string; lid: string } | null {
  const remoteJid = raw.key?.remoteJid;
  const remoteJidAlt = raw.key?.remoteJidAlt;
  if (
    typeof remoteJid === 'string' &&
    remoteJid.endsWith('@lid') &&
    typeof remoteJidAlt === 'string' &&
    remoteJidAlt.endsWith('@s.whatsapp.net')
  ) {
    return { pn: remoteJidAlt, lid: remoteJid };
  }
  return null;
}
