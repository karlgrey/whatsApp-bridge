import type { StoredMessage } from './storage.js';

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
 */
export function mapMessage(
  raw: BaileysLikeMessage,
  whitelist: Map<string, string>,
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
