# Outbox-Send-Kanal — Design (#312)

**Datum:** 2026-07-30 · **Status:** implementiert (Branch `feature/send-outbox-watcher`),
Aktivierung steht aus (Feature-Flag Default AUS)
**Kontext:** Die Bridge war v1 bewusst read-only (siehe
`2026-07-08-whatsapp-bridge-design.md`). Jetzt kommt ein Sende-Kanal dazu —
aber ausdrücklich **kein autonomes Senden**: ein reiner Ausführungskanal für
Nachrichten, die Micha (oder eine Session) manuell und einzeln freigibt,
indem sie als Datei abgelegt werden.

## Sicherheits-Vorgabe (Micha, 30.07.2026, HART)

> V1 sendet NIEMALS autonom — der Watcher ist ein reiner Ausführungskanal für
> manuell abgelegte, einzeln freigegebene Nachrichten.

Umgesetzt über zwei unabhängige Sperren, die beide fallen müssen, bevor
irgendetwas verschickt wird:

1. **Whitelist-Gate** — nur die 6 freigegebenen Einzelchats aus
   `config/chats.json` (dieselbe Whitelist wie beim Empfang, wiederverwendet
   über `loadWhitelist`). Alles andere wird verweigert, egal wie das
   Feature-Flag steht.
2. **Feature-Flag** `config/send.json` (`{"enabled": true|false}`),
   geladen über `loadSendConfig()` in `src/config.ts`. **Default AUS** und
   fail-safe: fehlende Datei, kaputtes JSON oder ein Wert ungleich dem
   literalen `true` → immer `enabled: false`. Solange aus: **Dry-Run** — der
   Watcher tut alles außer dem eigentlichen Senden (Whitelist-Check, Ablage
   verarbeiten, Log schreiben), ruft aber `sendFn` nicht auf.

Das Flag ist eine normale, eingecheckte Datei (kein Secret, keine PII) — das
Umschalten auf `enabled: true` ist damit ein sichtbarer, review-barer Commit.

## Architektur

Kein zweiter Prozess: der Watcher läuft im selben `bridge.ts`-Prozess und
nutzt dieselbe, bereits verbundene Baileys-Session (`sock.sendMessage`).
Das minimiert Session-Risiko — es gibt nur eine Verbindung, kein zweites
Linked-Device-Pairing.

```
src/config.ts           loadSendConfig()  → { enabled }, fail-safe Default AUS
src/outbox.ts            reiner Entscheidungs-Layer (kein fs/Netz):
                          decideOutboxAction(raw, whitelist, sendConfig)
                            → 'reject' | 'dry-run' | 'send'
                          formatSentLogLine(entry, result, detail?)
src/outbox-watcher.ts    Laufzeit: processOutboxOnce() (ein Durchlauf),
                          startOutboxWatcher() (Polling, setInterval),
                          recoverOrphans() (Crash-Reste)
src/bridge.ts            Wiring: startet den Watcher erst NACH connection
                          'open' (gültige Session), stoppt ihn bei 'close'
```

**Warum Polling statt `fs.watch`:** `fs.watch` ist auf macOS unzuverlässig
bei gebatchten/verzögerten Events; ein einfaches Intervall (Default 5 s,
`POLL_INTERVAL_MS`) ist robuster und für diesen Anwendungsfall (manuell,
selten, nicht zeitkritisch) völlig ausreichend.

## Dateiformat

**Eingabe** — eine Datei pro Nachricht, `data/outbox/<beliebiger-name>.json`:

```json
{ "chatJid": "4917xxx@s.whatsapp.net", "text": "Nachrichtentext" }
```

- `chatJid`: muss ein Eintrag der Whitelist (`config/chats.json`) sein.
- `text`: nicht-leerer String.
- Dateiname ist frei wählbar (Konvention: `<timestamp>-<slug>.json`), es wird
  jede `*.json`-Datei direkt in `data/outbox/` aufgegriffen (Unterordner
  `done/`, `failed/`, `.processing/` werden nicht rekursiv gescannt).

**Verarbeitung (Idempotenz):** Jede Datei wird zuerst atomar (rename,
gleiches Filesystem) nach `data/outbox/.processing/` geclaimt, bevor irgendwas
mit ihr passiert. Erst danach wird gesendet/dry-run/verweigert und die Datei
landet — wieder per rename — in `done/` (erfolgreich verarbeitet, inkl.
Dry-Run) oder `failed/` (Fehler/Ablehnung). Dieses Zwei-Schritt-Claim
verhindert, dass ein überlappender Poll-Tick dieselbe Datei zweimal aufgreift.

**Ergebnis-Feedback** — eine Zeile pro verarbeiteter Datei in `data/sent.log`:

```
2026-07-30T12:00:00.000Z | 4917xxx@s.whatsapp.net | sent
2026-07-30T12:00:05.000Z | 4917xxx@s.whatsapp.net | dry-run
2026-07-30T12:00:10.000Z | 4930999@s.whatsapp.net | rejected | Chat nicht auf der Whitelist: 4930999@s.whatsapp.net
2026-07-30T12:00:15.000Z | 4917xxx@s.whatsapp.net | failed | Error: Timeout beim Senden
```

Format: `<ISO-Timestamp> | <chatJid> | <sent|dry-run|failed|rejected>[ | <Detail>]`.

## Fehlerfälle

| Fall | Verhalten |
|---|---|
| Chat nicht auf der Whitelist | `rejected`, Datei → `failed/`, NIE gesendet (auch bei `enabled:true`) |
| Ungültiges JSON in der Datei | `rejected`, Datei → `failed/`, kein Crash des Watchers |
| `chatJid`/`text` fehlen oder leer | `rejected`, Datei → `failed/` |
| Feature-Flag aus (Default) | `dry-run` — Log zeigt, was gesendet WÜRDE; Datei → `done/` (kein Fehler, korrekt verarbeitet) |
| `sock.sendMessage` wirft (z. B. Netzwerkfehler) | `failed`, Datei → `failed/` mit Fehlermeldung im Log |
| Verbindung getrennt (`connection.update` → `close`) | Watcher wird gestoppt (`stop()`), bis eine neue Session offen ist — läuft nie gegen einen toten Socket; liegen gebliebene Outbox-Dateien werden beim nächsten `open` weiterverarbeitet |
| Bridge-Crash zwischen Claim und Ergebnis (Datei liegt in `.processing/`) | Beim nächsten Start räumt `recoverOrphans()` diese Dateien nach `failed/` (Ergebnis `rejected`, Hinweis „unklarer Zustand nach Neustart … manuell prüfen") — bewusst NICHT automatisch erneut senden (Risiko Doppel-Versand) und NICHT stillschweigend verwerfen |
| Zwei überlappende Poll-Ticks (z. B. ein Tick braucht länger als das Intervall) | Reentranz-Schutz in `startOutboxWatcher` — ein laufender Tick blockiert den nächsten |

## Aktivierung (für Micha/Review)

1. Code-Review dieses Branches (`feature/send-outbox-watcher`), danach Merge
   nach `main` — ändert am Betrieb noch nichts (Flag bleibt AUS).
2. Bridge neu starten, damit der neue Code läuft (launchd-Kickstart, siehe
   README „Betrieb"). Ab hier läuft der Watcher bereits — aber im Dry-Run.
3. **Testlauf im Dry-Run empfohlen:** eine Testdatei in `data/outbox/` legen,
   `data/sent.log` und `data/bridge.log` prüfen (`[dry-run] Würde senden an …`).
4. Erst wenn das passt: `config/send.json` auf `{"enabled": true}` setzen und
   committen — **das ist der bewusste Freigabe-Schritt**. Kein Bridge-Neustart
   nötig, `loadSendConfig()` wird bei jedem Poll-Tick frisch gelesen (im
   Gegensatz zur Whitelist, die beim Start einmalig geladen wird).
5. Nachrichten senden: passende `{chatJid, text}`-JSON-Datei in
   `data/outbox/` ablegen (z. B. `data/outbox/2026-07-30-test.json`),
   innerhalb von `POLL_INTERVAL_MS` (5 s) verarbeitet.

## Nicht-Ziele (dieser Iteration)

- Keine automatische/KI-gesteuerte Nachrichtenauswahl — die Freigabe „was
  wird gesendet" bleibt vollständig manuell (Datei ablegen ist der
  Freigabe-Akt).
- Kein Retry bei `failed/` — eine gescheiterte Nachricht muss neu abgelegt
  werden (bewusst einfach gehalten, kein Retry-Timing-Risiko für Doppelversand).
- Keine Medien im Send-Kanal (nur `text`).
- Kein zweiter Baileys-Prozess, keine zweite Session.
