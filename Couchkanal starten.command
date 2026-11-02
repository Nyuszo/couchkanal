#!/bin/bash
# Startet Couchkanal im Heimnetz. Beenden mit Ctrl+C oder Fenster schließen.
cd "$(dirname "$0")"
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "DEINE-MAC-IP")
PORT=8787
echo ""
echo "  Couchkanal läuft."
echo ""
echo "  Am iPad öffnen:   http://$IP:$PORT/tv.html"
echo "  Am Handy öffnen:  http://$IP:$PORT/remote.html"
echo ""
echo "  Beide Geräte müssen im selben WLAN sein wie dieser Mac."
echo "  Beenden: Ctrl+C"
echo ""
exec python3 -m http.server "$PORT" --bind 0.0.0.0
