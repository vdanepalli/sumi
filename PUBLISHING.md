# Publishing Sumi to the Chrome Web Store

## 1. Make the privacy policy public
The store needs a public privacy-policy URL. Push this repo to a **public** GitHub
repo (e.g. `vdanepalli/sumi`), then use
`https://github.com/vdanepalli/sumi/blob/main/PRIVACY.md`.

## 2. Developer account (one time)
https://chrome.google.com/webstore/devconsole → sign in → pay the one-time **$5**
fee → verify your email / identity if asked.

## 3. Upload a draft to get the store ID
```bash
./package.sh                      # dist/sumi-extension-<version>.zip (dev key removed)
```
Dashboard → **New item** → upload the zip → it becomes a draft. Copy its
**Item ID** (32 letters, shown on the item page). Do not submit yet.

## 4. Google sign-in for the store build
Google Cloud Console, project **Sumi**:
1. **Clients** (https://console.cloud.google.com/auth/clients) → **Create client**
   → type **Chrome Extension** → name `Sumi (store)` → Item ID = the store ID → Create.
2. Save its client ID for packaging:
   ```bash
   echo "<store client id>.apps.googleusercontent.com" > release-client-id
   ./package.sh
   ```
   and upload the new zip to the draft (Package → Upload new package).
3. **Branding** (https://console.cloud.google.com/auth/branding): add the app home
   page (the GitHub repo URL) and privacy policy URL; add an app logo if you like
   (a logo needs Google's brand verification, a few days).
4. **Audience** (https://console.cloud.google.com/auth/audience) → **Publish app**
   (Testing → In production) so anyone can sign in. `drive.appdata` is a
   non-sensitive scope: no security review is needed.

Both clients live in the same Cloud project, so the store build and your dev
build read and write the same Drive data.

## 5. Store listing
- **Store listing** tab: text from STORE.md, category *Productivity*, language.
- Images: icon 128×128 (`extension/icons/icon128.png`), at least one screenshot
  1280×800 (Collections, Later, Focus, Insights make a good set), optional small
  promo tile 440×280.
- **Privacy** tab: single purpose, one justification per permission (in
  STORE.md), data usage: "Web history" (domains + time, kept in the user's own
  Drive), not sold, not transferred; privacy policy URL from step 1.
- **Distribution**: Public, or **Unlisted** (only people with the link) to try it
  with friends first.

## 6. Submit for review
Usually a few days; access to all sites (needed for the floating timer) can make
it take longer. Updates: bump `version` in `extension/manifest.json`,
`./package.sh`, upload the zip, submit.

## Theme
`dist/sumi-theme-<version>.zip` is a separate item (category Themes). Themes
need no privacy tab and are usually approved quickly.
