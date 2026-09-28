# Sumi — Privacy Policy

_Last updated: 27 September 2026_

Sumi is built so that **your data belongs only to you**. The developer operates no
servers and collects nothing.

## What Sumi stores

| Data | Where it is kept |
| --- | --- |
| Settings (timer lengths, blocked sites, look) | Your browser, synced by Chrome through your Google account (`chrome.storage.sync`) |
| Saved words and idioms, notes, review progress | Your browser (`chrome.storage.local`) |
| Saved tab sessions (titles and URLs you chose to save) | Your browser |
| Time spent per website (domain names and seconds per day, last 90 days) | Your browser |
| Focus-timer history | Your browser |

If you turn on **Google Drive sync**, the items above are also written to a single
file in the hidden *app data* folder of **your own** Google Drive. Sumi requests
only the `drive.appdata` permission: it cannot see, read or change any of your
other Drive files, and nobody but you (through Sumi) can read that folder.

## What leaves your computer

- **Dictionary lookups:** the word or phrase you look up is sent to
  `api.dictionaryapi.dev` and/or `en.wiktionary.org` to fetch its definition.
- **Site icons:** domain names shown in lists are sent to Google's favicon service
  (`www.google.com/s2/favicons`) to display their icons.
- **Google Drive sync (optional, off by default):** your Sumi data file is
  exchanged with your own Google Drive.

Nothing is sent to the developer or any other party. No analytics, no ads, no
tracking, no selling of data.

## Permissions and why

- `tabs`, `tabGroups` — tab search, duplicates, grouping, sessions, time tracking of the active tab, focus blocking.
- `storage`, `unlimitedStorage` — keeping your data locally.
- `alarms`, `notifications` — the focus timer and its alerts.
- `contextMenus` — right-click "look up and save".
- `idle` — pausing time tracking when you are away.
- `identity` + `drive.appdata` — optional sync to your own Google Drive.

## Your control

Export or import everything as a JSON file, clear usage history, or stop Drive
sync at any time in Settings → Your data. Removing the extension deletes its
local data; the Drive file can be removed from Google Drive → Settings → Manage
apps → Sumi → Delete hidden app data.

## Contact

Open an issue on the project's GitHub repository.
