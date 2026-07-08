# WhatsApp-Bridge (v1, read-only)

Lokaler Mitlese-Dienst für Michas Mac: verbindet sich als verknüpftes Gerät
(Baileys) mit Michas privatem WhatsApp, filtert eingehende Nachrichten gegen
eine **Whitelist** und speichert Text + Metadaten in SQLite. Konsumiert wird
das vom Standup-Skill in TheBrain2 (Task-/Doku-Extraktion).

Spec: `docs/superpowers/specs/2026-07-08-whatsapp-bridge-design.md`

## Leitplanken (nicht verhandelbar)

- **Read-only:** Die Bridge enthält keinerlei Sende-Code. Senden ist kein v1-Feature.
- **Whitelist-Default leer:** Ohne Eintrag in `config/chats.json` wird NICHTS
  gespeichert. Nachrichten außerhalb der Whitelist werden verworfen, nie persistiert.
- **Keine Medien-Downloads:** nur der Typ (`image`/`video`/`audio`/`document`)
  wird vermerkt.
- **Daten bleiben lokal:** `data/` (Auth-State, DB, Logs, Status) und die echte
  `config/chats.json` sind gitignored. Chat-Rohinhalte gehen nie ins Wiki, nie
  in Deploy-Repos, nie auf Server.
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

## Re-Pairing (nach loggedOut)

Meldet `npm run status` „loggedOut — bitte neu pairen“:

1. Agent stoppen: `launchctl unload ~/Library/LaunchAgents/com.micha.whatsapp-bridge.plist`
2. `npm run dev` → QR neu scannen
3. Agent wieder laden: `launchctl load ~/Library/LaunchAgents/com.micha.whatsapp-bridge.plist`

## Entwicklung

- Tests: `npm test` (vitest — Whitelist, Storage, Mapping, Status)
- Typecheck: `npm run build` (tsc --noEmit)
- Architektur: `src/pipeline.ts` (purer Filter/Mapper) · `src/storage.ts`
  (SQLite) · `src/bridge.ts` (Baileys-Runtime) · `src/cli-*.ts` (CLIs)
