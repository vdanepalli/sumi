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
# release build: no dev "key"; use the Web Store client ID (RELEASE_CLIENT_ID env or ./release-client-id)
rel="${RELEASE_CLIENT_ID:-$(cat release-client-id 2>/dev/null || true)}"
[ -z "$rel" ] && echo "note: no release client ID yet - store build keeps the dev client (sign-in only works after step 4 of PUBLISHING.md)"
python3 -c 'import json,sys; p,rel=sys.argv[1],sys.argv[2]; m=json.load(open(p)); m.pop("key",None)
if rel: m["oauth2"]["client_id"]=rel
json.dump(m,open(p,"w"),indent=2,ensure_ascii=False)' "$tmp/manifest.json" "$rel"
(cd "$tmp" && zip -qr "$OLDPWD/dist/sumi-extension-$v.zip" . -x '*.DS_Store')
rm -rf "$tmp"
(cd theme && zip -qr "../dist/sumi-theme-$tv.zip" . -x '*.DS_Store')
ls -la dist
