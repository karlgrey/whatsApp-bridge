# WhatsApp-Bridge als systemd-User-Service (labs)

Analog `launchd/` auf dem Mac, aber fuer den Claude-Arbeitsplatz auf
`labs.remoterepublic.com`, User `claude` (Home 700, kein sudo) — Kernschutz-
Playbook `wiki/prozesse/Server-App anbinden.md` in TheBrain2, Abschnitt
„Claude-Arbeitsplatz auf labs". Der Service laeuft als **User**-Unit
(`~/.config/systemd/user/`), nicht system-weit — braucht kein root/sudo.

## Voraussetzung: Node per nvm, fest verdrahteter Default-Alias

Die Unit haengt sich nicht an eine konkrete nvm-Node-Patchversion (die kann
sich aendern, wenn spaeter im selben Home ein `nvm install` fuer ein anderes
Projekt laeuft). Stattdessen sourct `ExecStart` `nvm.sh` und ruft
`nvm use default`. Damit das stabil auf Node 22 zeigt, EINMALIG nach der
Node-Installation:

```
nvm alias default 22
```

(`nvm alias default` zeigt danach `-> 22 (-> v22.x.y)`; ein spaeteres
`nvm install <andere-version>` fuer ein anderes Repo aendert diesen Alias
nicht automatisch.)

## Install

1. Repo liegt unter `~/Development/whatsapp-bridge` (Klon), `npm ci` gelaufen,
   `config/chats.json` + `data/lid-map.json` liegen (siehe Haupt-README).
2. Unit-Dateien kopieren:
   ```
   mkdir -p ~/.config/systemd/user
   cp systemd/whatsapp-bridge.service ~/.config/systemd/user/
   cp systemd/whatsapp-bridge-logrotate.service ~/.config/systemd/user/
   cp systemd/whatsapp-bridge-logrotate.timer ~/.config/systemd/user/
   ```
3. ```
   systemctl --user daemon-reload
   ```
4. **NICHT sofort starten/enablen** — erst nach dem Pairing (QR-Scan durch
   Micha, siehe Haupt-README „Setup"/Task-Kommentar). Danach:
   ```
   systemctl --user enable --now whatsapp-bridge.service
   systemctl --user enable --now whatsapp-bridge-logrotate.timer
   ```
5. Damit der User-Service auch ohne aktive SSH-Session/Login weiterlaeuft
   (kein root fuer `loginctl enable-linger` noetig, wenn das schon fuer
   `claude` gesetzt ist — sonst durch den Admin-User/root pruefen lassen):
   ```
   loginctl show-user claude -p Linger
   ```
   Steht dort `Linger=no`, braucht es einmalig `loginctl enable-linger claude`
   (root/Admin-User) — sonst stoppt der Service beim Logout.

## Betrieb

- Status: `systemctl --user status whatsapp-bridge.service`
- Log: `~/Development/whatsapp-bridge/data/bridge.log` (append, wie am Mac)
- Neustart nach Whitelist-Aenderung: `systemctl --user restart whatsapp-bridge.service`
- Re-Pairing (nach `loggedOut`): Service stoppen
  (`systemctl --user stop whatsapp-bridge.service`), `npm run dev` in einer
  tmux-Session fuer den QR-Scan, danach Service wieder starten.

## Log-Rotation (logrotate-frei)

`claude` hat kein sudo und damit keinen Zugriff auf `/etc/logrotate.d` —
System-`logrotate` scheidet aus. Zwei Bausteine liegen bereit, beide
root-frei:

- **`whatsapp-bridge-logrotate.service` + `.timer`** (oben installiert):
  taeglicher Check, rotiert `bridge.log` auf `bridge.log.1`, sobald es 20 MB
  ueberschreitet (Referenz: das Mac-Log lag bei 23 MB). Einfache
  Ein-Generationen-Rotation, kein `gzip`, kein `logrotate`-Binary noetig.
- **Alternative gepruef, bewusst nicht gewaehlt:** `StandardOutput=journal`
  (System-Journal statt `append:`-Datei) haette eingebaute Rotation/Vacuum
  (`journalctl --vacuum-size`) — aber Akzeptanzkriterium (4) verlangt
  explizit `StandardOutput/StandardError=append:<pfad>/bridge.log`, damit das
  Log am selben Ort wie am Mac liegt (Tools/Skills, die den Pfad lesen,
  bleiben unveraendert). Deshalb: Datei-Append + eigene Mini-Rotation statt
  Journal.

## Kernschutz-Bezug

Dieser Service laeuft NICHT unter `deploy` (der App-User fuer /opt-Apps) und
NICHT unter `root`, sondern unter `claude` im eigenen Home (700). Das
entspricht der einzigen Ausnahme vom Kernschutz-Playbook („Claude-
Arbeitsplatz auf labs", `wiki/prozesse/Server-App anbinden.md`): ein
Trusted Endpoint wie Michas Laptop, unter eigenem Unix-User von den
oeffentlich erreichbaren Apps getrennt — keine Angriffsflaeche nach aussen,
kein Diensteport, kein pm2.
