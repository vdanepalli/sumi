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
# the Web Store assigns its own key: ship the manifest without the dev "key"
tmp=$(mktemp -d); cp -R extension/. "$tmp"; rm -rf "$tmp/dev"
python3 -c 'import json,sys; p=sys.argv[1]; m=json.load(open(p)); m.pop("key",None); json.dump(m,open(p,"w"),indent=2,ensure_ascii=False)' "$tmp/manifest.json"
(cd "$tmp" && zip -qr "$OLDPWD/dist/sumi-extension-$v.zip" . -x '*.DS_Store')
rm -rf "$tmp"
(cd theme && zip -qr "../dist/sumi-theme-$tv.zip" . -x '*.DS_Store')
ls -la dist
