#!/bin/bash
# Build Chrome Web Store zips into dist/ (dev files left out).
set -euo pipefail
cd "$(dirname "$0")"
v=$(python3 -c 'import json;print(json.load(open("extension/manifest.json"))["version"])')
tv=$(python3 -c 'import json;print(json.load(open("theme/manifest.json"))["version"])')
mkdir -p dist
rm -f "dist/sumi-extension-$v.zip" "dist/sumi-theme-$tv.zip"
if grep -q 'REPLACE_WITH_YOUR_OAUTH_CLIENT_ID' extension/manifest.json; then
  echo "note: oauth2.client_id is still a placeholder - Drive sync will be off in this build"
fi
(cd extension && zip -qr "../dist/sumi-extension-$v.zip" . -x 'dev/*' '*.DS_Store')
(cd theme && zip -qr "../dist/sumi-theme-$tv.zip" . -x '*.DS_Store')
ls -la dist
