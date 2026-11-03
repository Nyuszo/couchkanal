#!/bin/bash
# Stempelt eine neue Versionsnummer in alle Datei-Verweise (gegen alte Zwischenspeicher),
# committet mit der übergebenen Nachricht und schiebt nach GitHub.
set -e
cd "$(dirname "$0")"
V=$(date +%Y%m%d%H%M)
for f in tv.html remote.html index.html tv.js remote.js; do
  perl -pi -e "s/\\?v=[A-Za-z0-9]+/?v=$V/g" "$f"
done
echo "Version $V gestempelt"
git add -A
git commit -q -m "$1

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -q origin main
echo "gepusht $(git rev-parse --short HEAD)"
