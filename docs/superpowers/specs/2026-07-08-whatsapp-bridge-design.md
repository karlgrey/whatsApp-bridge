# WhatsApp-Bridge — Design (v1, read-only)

**Datum:** 2026-07-08 · **Status:** approved (Micha, 2026-07-08, Design-Session in TheBrain2)
**Kontext:** Viel Arbeits-Kommunikation (Dienstleister, Team) läuft über Michas
privates WhatsApp. Ziel v1: **Mitlesen → Tasks/Doku** im täglichen Standup
(TheBrain2-Skill). Senden ist bewusst NICHT Teil von v1.

## Entscheidungen (Brainstorming 08.07.2026)

1. **Primärziel:** Mitlesen für Task-/Doku-Extraktion (Standup-Integration).
   Kein Senden in v1 — die Bridge enthält keinerlei Sende-Code.
2. **Konto/Scope:** Michas privates Konto; gelesen wird ausschließlich eine
   **Whitelist** von Arbeits-Chats. Default leer — ohne expliziten Eintrag
   wird nichts gespeichert.
3. **Technik:** Lokale Bridge auf Michas Mac (Baileys, Multi-Device-Protokoll,
   Pairing als „verknüpftes Gerät" per QR). Läuft als launchd-Agent.
   Verworfen: Matrix-Bridge auf Server (private Daten gehören nicht auf den
   Server), manueller Export-Flow (zu viel Reibung, nicht live).
4. **Risiko (dokumentiert):** Verknüpfte-Geräte-Automation verstößt formal
   gegen WhatsApp-ToS; Bann-Risiko beim reinen Mitlesen erfahrungsgemäß
   gering, aber nicht null. Micha akzeptiert das für v1 (read-only minimiert).

## Architektur

Ein kleiner Node-Dienst (TypeScript), ein Prozess, keine externen Dienste:

- **Baileys** (`@whiskeysockets/baileys`) verbindet als Linked Device;
  Auth-State in `data/auth/` (gitignored).
- **Whitelist** `config/chats.json`: Array von `{jid, name}`. Nachrichten aus
  Chats außerhalb der Whitelist werden **verworfen, nie persistiert**.
- **Storage:** SQLite `data/messages.db` (better-sqlite3), Tabelle `messages`
  (id, chat_jid, chat_name, sender, sender_name, timestamp, text, media_type,
  raw_stub). Nur Text + Metadaten; Medien werden NICHT heruntergeladen (v1),
  nur als Typ vermerkt.
- **Chat-Discovery:** CLI-Kommando `npm run chats` listet verfügbare Chats
  (JID + Name) zum Befüllen der Whitelist.
- **Betrieb:** launchd-Agent (`~/Library/LaunchAgents/com.micha.whatsapp-bridge.plist`),
  Start bei Login, Restart bei Crash; Logs nach `data/bridge.log` (rotierend,
  einfach). `npm run status` zeigt Verbindungszustand + letzte Nachricht.
- **Session-Verlust:** Bridge schreibt Status-Datei `data/status.json`
  (connected/disconnected + Zeitstempel) — das Standup liest sie und meldet
  „Bridge offline, bitte neu pairen" statt still zu schweigen.

## Konsum (TheBrain2-Seite)

- Standup-Skill bekommt einen Schritt „WhatsApp-Check": liest
  `~/Development/whatsapp-bridge/data/messages.db` (neue Nachrichten seit
  letztem Lauf, Lesezeichen in `data/standup-cursor.json`), fasst Relevantes
  zusammen, schlägt Tasks/Doku-Tasks vor (gleiche Regeln wie Mails:
  Kostenträger-Projektschnitt, Kleinkram nicht verticketen).
- v2-Kandidaten (NICHT in v1): Follow-up-Erkennung (unbeantwortete eigene
  Fragen), Senden mit Freigabe, Medien.

## Datenschutz-Leitplanken

- Nur Whitelist-Chats; alles andere wird nicht gespeichert.
- Daten bleiben auf dem Mac: `data/` ist gitignored; Chat-Rohinhalte gehen
  NIE ins TheBrain2-Wiki, nie in Deploy-Repos, nie auf Server. Ins Wiki
  fließt nur kuratiertes Wissen über den normalen Ingest-Workflow.
- Repo enthält keine Secrets (Auth-State = gitignored Session-Dateien).

## Testing

- Unit: Whitelist-Filter, Message-Mapping, Cursor-Logik (vitest).
- Integration: Pairing + Echtlauf mit einem Test-Chat (Micha nötig — QR).
- Definition of Done v1: Bridge läuft via launchd, ein Whitelist-Chat wird
  live in die DB geschrieben, `npm run status` grün, Standup-Skill liest und
  meldet neue Nachrichten.

## Nicht-Ziele (v1)

- Kein Senden (keinerlei Sende-Code). Keine Medien-Downloads. Keine
  Historie-Migration (Alt-Chats = separater Export-Ingest, Icebox #18).
- Kein Server-Deployment, kein Scope in brainstem-Repos.
