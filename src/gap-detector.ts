/**
 * Lücken-Erkennung bei Reconnects (#483).
 *
 * WhatsApp/Baileys liefert nach einem Reconnect "offline messages/
 * notifications" nach — das deckt in der Praxis nur einen Teil der
 * Nachrichten ab, die während der Trennung verschickt wurden (siehe
 * Analyse #483: mehrere Reconnects mit "handled 0 offline messages"
 * trotz nachweislich verschickter Nachrichten). Echtes Nachziehen per
 * Baileys ist nicht zuverlässig möglich — also MINDESTENS Lücken
 * sichtbar machen, statt Vollständigkeit vorzutäuschen: ein Disconnect-
 * Fenster oberhalb der Schwelle wird als Lücke in status.json vermerkt,
 * damit Standups/Auswertungen blinde Fenster erkennen.
 */

/** Ein erkanntes Offline-Fenster. */
export interface ConnectionGap {
  /** ISO-Zeitstempel: Verbindung verloren. */
  from: string;
  /** ISO-Zeitstempel: Verbindung wiederhergestellt. */
  to: string;
  /** Dauer der Lücke in Minuten (gerundet). */
  minutes: number;
}

/**
 * Prüft, ob zwischen Trennung (`closedAt`) und Wiederverbindung
 * (`reopenedAt`) eine Lücke oberhalb von `thresholdMs` liegt.
 * `closedAt === null` heißt: keine offene Trennung erfasst (z. B.
 * Prozessstart) → keine Lücke.
 */
export function detectGap(
  closedAt: number | null,
  reopenedAt: number,
  thresholdMs: number,
): ConnectionGap | null {
  if (closedAt === null) return null;
  const durationMs = reopenedAt - closedAt;
  if (durationMs <= thresholdMs) return null;
  return {
    from: new Date(closedAt).toISOString(),
    to: new Date(reopenedAt).toISOString(),
    minutes: Math.round(durationMs / 60_000),
  };
}

/**
 * Hängt eine Lücke an die bestehende Liste an und deckelt sie auf
 * `maxEntries` (älteste zuerst verworfen) — status.json soll nicht
 * unbegrenzt wachsen.
 */
export function appendGap(
  gaps: ConnectionGap[],
  gap: ConnectionGap,
  maxEntries: number,
): ConnectionGap[] {
  const next = [...gaps, gap];
  return next.length > maxEntries ? next.slice(next.length - maxEntries) : next;
}
