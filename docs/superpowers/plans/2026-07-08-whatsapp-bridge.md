# WhatsApp-Bridge v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lokaler read-only WhatsApp-Mitlese-Dienst (Whitelist → SQLite) für Michas Mac, betrieben via launchd.

**Architecture:** Ein Node/TypeScript-Prozess: Baileys verbindet als Linked Device, eingehende Nachrichten laufen durch einen puren Filter-/Mapping-Layer (Whitelist) und werden in SQLite persistiert. CLIs für Chat-Discovery und Status. Kein Sende-Code — nirgends.

**Tech Stack:** Node ≥ 20, TypeScript (ESM), `@whiskeysockets/baileys`, `better-sqlite3`, `qrcode-terminal`, `vitest`, `tsx`.

## Global Constraints (aus der Spec — `docs/superpowers/specs/2026-07-08-whatsapp-bridge-design.md`, vor Start lesen)

- **READ-ONLY:** Keinerlei Sende-Funktionen implementieren (kein `sendMessage`-Aufruf, auch nicht „für Tests").
- **Whitelist-Default leer:** Ohne Eintrag in `config/chats.json` wird NICHTS persistiert.
- Nur Text + Metadaten speichern; Medien nie herunterladen (nur `media_type` vermerken).
- `data/` ist gitignored (Auth-State, DB, Logs, Status) — nie committen.
- Alle Pfade relativ zum Repo-Root `~/Development/whatsapp-bridge`.
- Commits auf Deutsch im Stil `feat: …` / `test: …`, jeweils mit `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Scaffold + Whitelist-Config

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `config/chats.example.json`, `src/config.ts`
- Test: `src/config.test.ts`

**Interfaces:**
- Produces: `loadWhitelist(path?: string): Map<string, string>` (JID → Anzeigename; leere Map wenn Datei fehlt/leer), `DATA_DIR` (Konstante `data/`, absolut aufgelöst).

- [ ] **Step 1:** `npm init -y`, dann `package.json` anpassen: `"type": "module"`, Scripts `{"dev":"tsx src/bridge.ts","chats":"tsx src/cli-chats.ts","status":"tsx src/cli-status.ts","test":"vitest run","build":"tsc --noEmit"}`. Install: `npm i @whiskeysockets/baileys better-sqlite3 qrcode-terminal` und `npm i -D typescript tsx vitest @types/better-sqlite3 @types/qrcode-terminal @types/node`. `tsconfig.json`: `strict`, `module: NodeNext`, `target: ES2022`, `noEmit`.
- [ ] **Step 2:** Failing test `src/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadWhitelist } from './config.js';
import { writeFileSync, rmSync } from 'node:fs';

describe('loadWhitelist', () => {
  it('liefert leere Map wenn Datei fehlt', () => {
    expect(loadWhitelist('/tmp/wab-nope.json').size).toBe(0);
  });
  it('lädt {jid,name}-Einträge', () => {
    writeFileSync('/tmp/wab-chats.json', JSON.stringify([{ jid: '4917xxx@s.whatsapp.net', name: 'Wanja' }]));
    const wl = loadWhitelist('/tmp/wab-chats.json');
    expect(wl.get('4917xxx@s.whatsapp.net')).toBe('Wanja');
    rmSync('/tmp/wab-chats.json');
  });
});
```

- [ ] **Step 3:** Run `npm test` → FAIL (Modul fehlt). Implementiere `src/config.ts`: liest JSON-Array `{jid,name}[]`, Default-Pfad `config/chats.json`, fehlende/kaputte Datei → leere Map + `console.warn`. Exportiere `DATA_DIR = path.resolve(import.meta.dirname, '../data')`.
- [ ] **Step 4:** `npm test` → PASS. `config/chats.example.json` mit zwei Beispiel-Einträgen anlegen.
- [ ] **Step 5:** Commit `feat: Scaffold + Whitelist-Config`.

### Task 2: SQLite-Storage

**Files:**
- Create: `src/storage.ts` — Test: `src/storage.test.ts`

**Interfaces:**
- Produces: `openDb(file?: string): Database` (better-sqlite3, legt Schema an), `insertMessage(db, msg: StoredMessage): void` (idempotent per PK), Typ `StoredMessage = { id: string; chatJid: string; chatName: string; sender: string; senderName: string; timestamp: number; text: string; mediaType: string | null }`.

- [ ] **Step 1:** Failing test: In-Memory-DB (`openDb(':memory:')`), `insertMessage` zweimal mit derselben id → genau 1 Zeile; Felder kommen 1:1 wieder raus (SELECT).
- [ ] **Step 2:** Run → FAIL. Implementieren: Tabelle `messages(id TEXT PRIMARY KEY, chat_jid TEXT NOT NULL, chat_name TEXT, sender TEXT, sender_name TEXT, timestamp INTEGER NOT NULL, text TEXT, media_type TEXT)` + Index auf `(chat_jid, timestamp)`; `INSERT OR IGNORE`.
- [ ] **Step 3:** `npm test` → PASS. Commit `feat: SQLite-Storage für Nachrichten`.

### Task 3: Filter-/Mapping-Pipeline (pur, ohne Baileys-Verbindung)

**Files:**
- Create: `src/pipeline.ts` — Test: `src/pipeline.test.ts`

**Interfaces:**
- Consumes: `Map` aus Task 1, `StoredMessage` aus Task 2.
- Produces: `mapMessage(raw: BaileysLikeMessage, whitelist: Map<string,string>): StoredMessage | null` — `null` wenn Chat nicht auf der Whitelist ODER kein Text extrahierbar. `BaileysLikeMessage` = minimaler struktureller Typ (`{ key: { id, remoteJid, participant?, fromMe }, messageTimestamp, pushName?, message?: {...} }`), damit ohne echte Baileys-Objekte getestet werden kann.
- Text-Extraktion: `message.conversation` → sonst `message.extendedTextMessage.text` → sonst leer; `mediaType` aus vorhandenem Key (`imageMessage`→`image`, `videoMessage`→`video`, `audioMessage`→`audio`, `documentMessage`→`document`, sonst `null`). Nachricht ohne Text aber mit Medium → `text: ''`, `mediaType` gesetzt (wird gespeichert). `fromMe`-Nachrichten WERDEN gespeichert (eigene Antworten gehören zur Doku), `senderName` dann `'Micha'`.

- [ ] **Step 1:** Failing tests: (a) Nicht-Whitelist-JID → null. (b) Whitelist + `conversation`-Text → korrektes StoredMessage (chatName aus Whitelist). (c) Bild ohne Text → `mediaType: 'image'`, `text: ''`. (d) `fromMe: true` → senderName `'Micha'`.
- [ ] **Step 2:** Run → FAIL. Implementieren. Run → PASS.
- [ ] **Step 3:** Commit `feat: Whitelist-Filter + Message-Mapping`.

### Task 4: Bridge-Runtime (Baileys, QR, status.json)

**Files:**
- Create: `src/bridge.ts`, `src/status.ts` — Test: `src/status.test.ts`

**Interfaces:**
- Consumes: alles Vorherige.
- Produces: `writeStatus(state: {connected: boolean; detail?: string}, file?: string): void` → JSON `{connected, detail, updatedAt}` (Default `data/status.json`); `readStatus(file?)` fürs CLI.
- `src/bridge.ts` (kein Unit-Test, nur Smoke): `makeWASocket` mit `useMultiFileAuthState(DATA_DIR + '/auth')`, `printQRInTerminal` via `qrcode-terminal` beim `connection.update`-QR-Event; auf `connection.update` → `writeStatus`; auf `messages.upsert` → je Message `mapMessage` → bei non-null `insertMessage`; Reconnect-Logik: bei `DisconnectReason.loggedOut` NICHT reconnecten (Status disconnected + Hinweis „neu pairen"), sonst reconnect mit Backoff (5s, max 60s). Logs mit Zeitstempel nach stdout (launchd leitet um).

- [ ] **Step 1:** Failing test für `writeStatus`/`readStatus` (Roundtrip in `/tmp`). Run → FAIL → implementieren → PASS.
- [ ] **Step 2:** `src/bridge.ts` schreiben (oben spezifiziert). **Smoke:** `timeout 20 npx tsx src/bridge.ts` → erwartet: startet ohne Exception, zeigt QR-ASCII ODER „connecting", schreibt `data/status.json` mit `connected: false`. (Pairing kann der Agent NICHT durchführen — nicht versuchen.)
- [ ] **Step 3:** `npm run build` (tsc noEmit) → 0 Fehler. Commit `feat: Bridge-Runtime mit QR-Pairing und Status-Datei`.

### Task 5: CLIs — Chat-Discovery + Status

**Files:**
- Create: `src/cli-chats.ts`, `src/cli-status.ts`

**Interfaces:**
- `cli-chats`: verbindet mit vorhandenem Auth-State, wartet auf `chats.set`/liest `groupFetchAllParticipating()` + Store-Kontakte, druckt Tabelle `JID | Name` (nur Metadaten!), beendet sich. Ohne gepairte Session: Meldung „Erst pairen: npm run dev" + Exit 1.
- `cli-status`: liest `data/status.json` + letzte Zeile aus DB (`SELECT chat_name, timestamp FROM messages ORDER BY timestamp DESC LIMIT 1`), druckt beides menschenlesbar; kein Netz.

- [ ] **Step 1:** Beide implementieren. Smoke: `npx tsx src/cli-status.ts` läuft ohne Pairing (zeigt „disconnected / noch keine Nachrichten"); `npx tsx src/cli-chats.ts` ohne Session → sauberer Hinweis, Exit 1.
- [ ] **Step 2:** Commit `feat: CLIs für Chat-Discovery und Status`.

### Task 6: launchd + README + Endabnahme

**Files:**
- Create: `launchd/com.micha.whatsapp-bridge.plist`, `README.md`, `scripts/install-launchd.sh`

- [ ] **Step 1:** Plist: Label `com.micha.whatsapp-bridge`, `ProgramArguments` = [`/bin/zsh`,`-lc`,`cd $HOME/Development/whatsapp-bridge && npx tsx src/bridge.ts`], `RunAtLoad true`, `KeepAlive true`, `StandardOutPath`/`StandardErrorPath` → `data/bridge.log`. `install-launchd.sh`: kopiert nach `~/Library/LaunchAgents/` + `launchctl load`. NICHT ausführen (macht Micha).
- [ ] **Step 2:** README: Setup (npm install → `npm run dev` → QR mit Handy scannen [WhatsApp → Verknüpfte Geräte] → `npm run chats` → JIDs in `config/chats.json` → `scripts/install-launchd.sh`), Betrieb (`npm run status`, Log-Pfad, Re-Pairing bei loggedOut), Leitplanken aus der Spec (read-only, Whitelist, data/ lokal).
- [ ] **Step 3:** Endabnahme: `npm test` (alle grün), `npm run build` (0 Fehler), Smoke aus Task 4 wiederholen. `git log --oneline` zeigt ≥ 6 Commits. Commit `docs: README + launchd-Setup`.
