import type { StoredMessage } from './storage.js';
import type { BaileysLikeMessage } from './pipeline.js';

/** Größenlimit pro Datei (25 MB) — größere Medien werden nicht geladen. */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

const MEDIA_NODE_KEYS = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'];

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'audio/ogg; codecs=opus': '.ogg',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'application/pdf': '.pdf',
};

interface MediaNode {
  fileName?: string | null;
  mimetype?: string | null;
  fileLength?: number | { toNumber(): number } | null;
}

export interface MediaPlan {
  /** Zielpfad relativ zu DATA_DIR, z. B. media/Wanja/1751990400-MSG1-Rechnung.pdf */
  relPath: string;
}

/** Pfadsegment-/Dateinamen-Sanitizing: nur [A-Za-z0-9._-], kein Traversal. */
function sanitize(segment: string): string {
  return segment
    .replace(/\.\./g, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[.-]+|[-.]+$/g, '')
    .slice(0, 120);
}

function toNumber(v: MediaNode['fileLength']): number {
  if (typeof v === 'number') return v;
  if (v && typeof v.toNumber === 'function') return v.toNumber();
  return 0;
}

/**
 * Plant Ablageort für das Medium einer Nachricht.
 * null = nichts herunterladen (kein Medien-Knoten oder über dem Größenlimit).
 */
export function planMediaFile(
  stored: StoredMessage,
  msg: BaileysLikeMessage['message'],
): MediaPlan | null {
  if (!msg) return null;
  let node: MediaNode | null = null;
  for (const key of MEDIA_NODE_KEYS) {
    const candidate = (msg as Record<string, unknown>)[key];
    if (candidate && typeof candidate === 'object') {
      node = candidate as MediaNode;
      break;
    }
  }
  if (!node) return null;
  if (toNumber(node.fileLength) > MAX_MEDIA_BYTES) return null;

  const chatDir = sanitize(stored.chatName) || 'unbekannt';
  let suffix: string;
  if (node.fileName) {
    suffix = `-${sanitize(node.fileName)}`;
  } else {
    suffix = EXT_BY_MIME[node.mimetype ?? ''] ?? '.bin';
  }
  return { relPath: `media/${chatDir}/${stored.timestamp}-${sanitize(stored.id)}${suffix}` };
}
