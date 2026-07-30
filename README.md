# WhatsApp-Bridge

Lokaler Mitlese-Dienst für Michas Mac: verbindet sich als verknüpftes Gerät
(Baileys) mit Michas privatem WhatsApp, filtert eingehende Nachrichten gegen
eine **Whitelist** und speichert Text + Metadaten in SQLite. Konsumiert wird
das vom Standup-Skill in TheBrain2 (Task-/Doku-Extraktion). Seit #312 gibt es
zusätzlich einen **Outbox-Send-Kanal** — Default AUS, siehe unten.

Spec: `docs/superpowers/specs/2026-07-08-whatsapp-bridge-design.md`
Spec Send-Kanal: `docs/superpowers/specs/2026-07-30-outbox-send-channel-design.md`

## Leitplanken (nicht verhandelbar)

- **Senden nur explizit freigegeben:** Der Empfangsteil ist read-only. Der
  Outbox-Send-Kanal (#312) sendet NIE autonom — nur manuell abgelegte,
  einzeln freigegebene Nachrichten, doppelt abgesichert (Whitelist +
  Feature-Flag, Default AUS/Dry-Run). Details unten.
- **Whitelist-Default leer:** Ohne Eintrag in `config/chats.json` wird NICHTS
  gespeichert (Empfang) bzw. gesendet (Outbox). Nachrichten/Ziele außerhalb
  der Whitelist werden verworfen, nie persistiert/gesendet.
- **Keine Medien-Downloads:** nur der Typ (`image`/`video`/`audio`/`document`)
  wird vermerkt.
- **Daten bleiben lokal:** `data/` (Auth-State, DB, Logs, Status, Outbox) und
  die echte `config/chats.json` sind gitignored. Chat-Rohinhalte gehen nie
  ins Wiki, nie in Deploy-Repos, nie auf Server.
- ToS-Hinweis: Linked-Device-Automation verstößt formal gegen WhatsApp-ToS
  (Risiko dokumentiert und akzeptiert, siehe Spec).

## Setup

1. `npm install`
2. `npm run dev` — QR-Code erscheint im Terminal. Mit dem Handy scannen:
   WhatsApp → Einstellungen → **Verknüpfte Geräte** → Gerät hinzufügen.
3. `npm run chats` — listet verfügbare Chats (`JID | Name`). Direkt nach dem
   Pairing ausführen, dann liefert der History-Sync auch Einzelchats.
4. Gewünschte Chats in `config/chats.json` eintragen (Vorlage:
   `config/chats.example.json`):
   ```json
   [{ "jid": "4917…@s.whatsapp.net", "name": "Wanja" }]
   ```
5. `scripts/install-launchd.sh` — installiert den launchd-Agent
   (Start bei Login, Restart bei Crash).

## Betrieb

- `npm run status` — Verbindungszustand + letzte gespeicherte Nachricht.
- Log: `data/bridge.log` (launchd leitet stdout/stderr dorthin um).
- DB: `data/messages.db`, Tabelle `messages`
  (`id, chat_jid, chat_name, sender, sender_name, timestamp, text, media_type`).
- Status-Datei: `data/status.json` (`connected`, `detail`, `updatedAt`) —
  liest u. a. das Standup-Skill („Bridge offline, bitte neu pairen“).
- Whitelist geändert? Bridge neu starten
  (`launchctl kickstart -k gui/$UID/com.micha.whatsapp-bridge`), die
  Whitelist wird beim Start geladen.

## Outbox-Send-Kanal (#312, Default AUS)

Reiner Ausführungskanal für manuell freigegebene Nachrichten — kein
autonomes Senden, keine KI-gesteuerte Auswahl. Details, Fehlerfälle,
Aktivierungsschritte: `docs/superpowers/specs/2026-07-30-outbox-send-channel-design.md`.

Kurzfassung:

1. `{ "chatJid": "…@s.whatsapp.net", "text": "…" }` als Datei in
   `data/outbox/` ablegen (nur Whitelist-JIDs erlaubt, sonst `rejected`).
2. Solange `config/send.json` → `{"enabled": false}` (Default): **Dry-Run** —
   nichts wird gesendet, nur geloggt/verschoben nach `data/outbox/done/`.
3. Erst `config/send.json` → `{"enabled": true}` schaltet echten Versand
   scharf. Kein Bridge-Neustart nötig (wird pro Poll-Tick neu gelesen).
4. Ergebnis je Datei: eine Zeile in `data/sent.log`
   (`<Timestamp> | <chatJid> | sent|dry-run|failed|rejected`).

## Re-Pairing (nach loggedOut)

Meldet `npm run status` „loggedOut — bitte neu pairen“:

1. Agent stoppen: `launchctl unload ~/Library/LaunchAgents/com.micha.whatsapp-bridge.plist`
2. `npm run dev` → QR neu scannen
3. Agent wieder laden: `launchctl load ~/Library/LaunchAgents/com.micha.whatsapp-bridge.plist`

## Entwicklung

- Tests: `npm test` (vitest — Whitelist, Storage, Mapping, Status, Outbox)
- Typecheck: `npm run build` (tsc --noEmit)
- Architektur: `src/pipeline.ts` (purer Filter/Mapper, Empfang) · `src/outbox.ts`
  (purer Entscheidungs-Layer, Versand) · `src/storage.ts` (SQLite) ·
  `src/outbox-watcher.ts` (Outbox-Polling, Laufzeit) · `src/bridge.ts`
  (Baileys-Runtime, verdrahtet beides) · `src/cli-*.ts` (CLIs)
