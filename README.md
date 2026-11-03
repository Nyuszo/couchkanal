# Couchkanal

Das iPad wird zum Fernseher, das Handy zur Fernbedienung. YouTube-Videos laufen
auf dem iPad (per HDMI am Fernseher), gesteuert vom Handy: suchen, Warteschlange,
Play, Pause, springen.

## Live-Adresse

- Fernseher (iPad): https://nyuszo.github.io/couchkanal/tv.html
- Fernbedienung (Handy): https://nyuszo.github.io/couchkanal/remote.html
- Startseite mit Auswahl: https://nyuszo.github.io/couchkanal/

Gehostet über GitHub Pages aus diesem Repository. Jede Änderung auf `main` ist
nach etwa einer Minute live.

## Apps auf dem Fernseher

Nach dem Start zeigt das iPad einen Startbildschirm mit App-Kacheln, die du vom
Handy aus mit dem Steuerkreuz oder direkt über die App-Leiste auswählst:

- **YouTube**: Angesagte Videos, Musik, Gaming, Sport und mehr direkt auf dem
  Fernseher, Auswahl mit dem Steuerkreuz, Suche vom Handy. Dafür braucht der
  Fernseher deinen Google-Schlüssel (wird von der Fernbedienung übertragen).
  Links vom Handy laufen auch ohne Schlüssel.
- **Twitch**: Kanalnamen am Handy eingeben, der Stream läuft auf dem Fernseher.
- **Radio**: 16 Sender, vom Deutschlandfunk bis Radio Paradise. Läuft auch weiter,
  wenn du zum Startbildschirm oder in den Bildschirmschoner wechselst.
- **Bildschirmschoner**: Uhr und Raumlicht.
- **Netflix, Prime Video, Disney+, Apple TV, ARD, ZDF, Arte, Joyn, Spotify**:
  Verknüpfungen. Sie öffnen die Webseite des Dienstes. Läuft Couchkanal vom
  Home-Bildschirm des iPads, erscheint die Seite in einem Fenster über der App,
  zurück geht es mit „Fertig“ oben links. In Safari öffnet sie im selben Tab,
  zurück mit der Zurück-Taste, Couchkanal läuft dann ohne neuen Tipp weiter.
  Wahlweise startet eine Verknüpfung die iPad-App (Einstellungen, „App“), dafür
  braucht sie die App-Adresse, zum Beispiel `nflx://`. Die Wiedergabe in fremden
  Apps und Seiten steuert Apples Fernsteuerung („Geräte in der Nähe steuern“),
  nicht Couchkanal. Eigene Verknüpfungen lassen sich hinzufügen.

Reihenfolge und Sichtbarkeit der Kacheln stellst du in den Einstellungen der
Fernbedienung ein (Zahnrad oben rechts). Netflix und ähnliche Dienste lassen sich
nicht einbetten und fehlen deshalb.

## Wie es funktioniert

- `tv.html` läuft auf dem iPad. Nach einem Tipp zeigt es einen vierstelligen Code
  und einen QR-Code.
- `remote.html` läuft auf dem Handy. Code eingeben oder den QR-Code scannen, fertig.
  Das Handy merkt sich den Code.
- Die Geräte reden direkt miteinander (WebRTC). Ein öffentlicher Vermittlungsdienst
  (PeerJS) hilft nur beim Finden, danach fließen die Befehle direkt.
- Es braucht keinen eigenen Server, nur eine Adresse, unter der die Dateien liegen.

## Einrichtung am iPad

1. `tv.html` in Safari öffnen, auf Teilen tippen und „Zum Home-Bildschirm“ wählen.
2. Einstellungen, Anzeige & Helligkeit, Automatische Sperre auf „Nie“.
3. HDMI-Adapter (am besten der von Apple) anschließen.
4. App vom Home-Bildschirm starten, einmal tippen, Code ablesen.

Die Lautstärke regelt bei iPads der Fernseher, nicht die Fernbedienung.
Stumm schalten geht trotzdem.

## YouTube-Suche am Handy

Links einfügen funktioniert sofort. Für die Suche nach Stichworten braucht es
einmalig einen kostenlosen Schlüssel von Google:

1. https://console.cloud.google.com öffnen, Projekt anlegen.
2. „YouTube Data API v3“ aktivieren.
3. Unter „Anmeldedaten“ einen API-Schlüssel erstellen.
4. In der Fernbedienung oben rechts auf das Zahnrad, Schlüssel einfügen, speichern.

Der Schlüssel bleibt nur auf dem Handy gespeichert.

## Dateien

| Datei | Zweck |
| --- | --- |
| `index.html` | Startseite: Fernseher oder Fernbedienung wählen |
| `tv.html`, `tv.css`, `tv.js` | Fernseher-Oberfläche fürs iPad |
| `remote.html`, `remote.css`, `remote.js` | Fernbedienung fürs Handy |
| `logic.js` | Gemeinsame Logik: Code, Link-Erkennung, Warteschlange |
| `common.css` | Farben, Schriften, Grundgestaltung |
| `test/logic.test.mjs` | Tests für die Logik (`node --test test/`) |
| `Couchkanal starten.command` | Startet die Seiten vom Mac aus im Heimnetz |

## Vom Mac aus starten (ohne Hosting)

Doppelklick auf `Couchkanal starten.command`. Das Fenster zeigt die Adresse,
die du am iPad und am Handy öffnest (gleiches WLAN). Der Mac muss dabei an bleiben.
