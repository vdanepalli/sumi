# Sumi 墨 — focus, tabs & words for Chrome

A calm, true-black Chrome setup in two parts:

| Folder | What it is |
| --- | --- |
| `theme/` | **True Black** theme: pure black frame, tabs and new-tab page, near-black toolbar. |
| `extension/` | **Sumi**, the productivity extension (new-tab dashboard, popup, background worker). |

Chrome does not let one package be both a theme and an extension (themes cannot
contain code, and Chrome has no theme API), so they install separately.

## Features

**New tab dashboard** — large ticking clock, greeting, focus streak, and four cards:

- **Focus timer (Pomodoro)** — focus / short / long break cycles, countdown on the
  toolbar icon, notifications, auto-start options, daily focus goal with a 7-day
  chart and a streak. Optional **blocking of distracting sites** while a focus
  session runs (a calm "Stay with it" page shows the time left).
- **Time online** — time per website for today or the last 7 days. Counts only the
  tab you are actually looking at; pauses when you are idle, the screen locks or
  Chrome is in the background. Sites can be excluded.
- **Tabs** — search every tab in every window (Enter jumps to it), close
  duplicates, group by site (Chrome tab groups), ungroup, sort by site, put
  inactive tabs to sleep (frees memory), close stale tabs (saved first, never
  lost), merge all windows, close every tab of one site, save / restore named
  sessions.
- **Vocabulary** — look up words and idioms (dictionaryapi.dev, with Wiktionary for
  idioms and as a fallback), pronunciation audio, examples, synonyms. Save them,
  add your own notes, and review with spaced repetition (Again / Hard / Good /
  Easy; intervals 1, 3, 7, 16, 35, 90 days). Words looked up again drop back for
  review. Word of the day, mastery levels, filters (due, learning, mastered,
  idioms).

**Anywhere on the web** — select text → right-click → *Sumi: look up and save* (or
*save as an idiom*): the definition appears as a notification and the word is
saved with the page it came from.

**Popup** (toolbar icon, `Alt+Shift+S`) — timer controls, quick lookup, time on
the current site, quick tab actions.

**Keys** — `Alt+Shift+P` start/pause timer anywhere. On the new tab: `/` search
tabs, `l` look up, `p` timer, `r` review; in review `space` reveals, `1`–`4` grade.

## Privacy

No servers, no analytics, no accounts of ours. See [PRIVACY.md](PRIVACY.md).

- Settings sync through the user's own Chrome sign-in (`chrome.storage.sync`).
- Vocabulary, sessions and stats are stored locally and can sync to a hidden
  app-data folder in **the user's own Google Drive** (scope `drive.appdata`: only
  Sumi can see that folder; it cannot read any other Drive files).
- The only outside requests: dictionary lookups (the looked-up word only) to
  dictionaryapi.dev / Wiktionary, Google's favicon service for site icons, and
  Google Drive when sync is on.
- Export / import a full JSON backup any time (Settings → Your data).

## Install (development)

1. `chrome://extensions` → turn on **Developer mode**.
2. **Load unpacked** → select `extension/`. Open a new tab.
3. Optional theme: **Load unpacked** → select `theme/`.

Everything works right away except Google Drive sync, which needs an OAuth
client ID (below). Without it, settings still sync via Chrome and backups work.

## Enabling Google Drive sync

1. Load the extension once and note its ID. To keep the ID stable, add a `"key"`
   to `manifest.json` (Chrome Web Store → Package → *public key*, or generate one).
2. Google Cloud Console → create a project → enable **Google Drive API**.
3. **OAuth consent screen**: External, add scope `.../auth/drive.appdata`.
4. **Credentials → Create OAuth client ID → Chrome extension**, paste the ID.
5. Put the client ID in `extension/manifest.json` → `oauth2.client_id`, reload.
6. Settings → *Sign in with Google & sync*. Syncs every 30 min after that.

`drive.appdata` is a non-sensitive scope, so publishing does not need Google's
restricted-scope security review.

## Publish to the Chrome Web Store

```bash
./package.sh          # builds dist/sumi-extension-<version>.zip and dist/sumi-theme-<version>.zip
```

Upload each zip at https://chrome.google.com/webstore/devconsole (one-time $5
developer fee). Listing text and permission justifications are in
[STORE.md](STORE.md). The privacy policy URL can point to PRIVACY.md on GitHub.

## Development

- Plain JavaScript modules, no build step. `extension/lib/` holds the logic
  (`store`, `timer`, `tabs`, `dict`, `sync`, `ui`), `background.js` the service
  worker, `dashboard/`, `popup/`, `pages/` the UI.
- `extension/dev/preview.html` previews the dashboard in a normal browser with a
  mocked `chrome.*` API and sample data:
  `python3 -m http.server -d extension 8820` → http://localhost:8820/dev/preview.html
  (`dev/` is left out of the store package).

## License

MIT
