# Sumi — Privacy Policy

_Last updated: 28 September 2026_

Sumi keeps **your data in your own Google account**. The developer runs no
servers, has no database, and never receives any of your data.

## What Sumi stores

| Data | Purpose |
| --- | --- |
| Spaces, collections and saved tabs (titles, URLs, your notes) | Tab manager |
| Tasks | Task list |
| Time per website: domain name + seconds per day | Insights |
| Focus sessions and stopwatch logs | Focus history |
| Settings | Your preferences |

It is stored in your browser (`chrome.storage.local`) and, once you sign in with
Google, synced to **one file in the hidden app-data folder of your own Google
Drive**. Sumi asks only for the `drive.appdata` permission: it can read and
write that one private folder and cannot see any other Drive files. Your Google
email and name are shown in Sumi so you know which account is in use.

## What leaves your computer

- **Google Drive** (your own account) — the sync file described above.
- **Google favicon service** (`www.google.com/s2/favicons`) — site domain names,
  to display icons next to saved tabs and sites.

Nothing is sent to the developer or any third party. No analytics, advertising,
tracking pixels, or data sales.

## The floating widget

To show the timer on every page, Sumi adds a small widget to web pages. It only
displays Sumi's own timer state; it does not read, collect or send page content.

## Permissions

- `tabs`, `tabGroups` — list, search, group, sort, save and restore tabs; time the active tab; show the focus page for blocked sites.
- `storage`, `unlimitedStorage` — keep your data locally (history is kept until you delete it).
- `alarms`, `notifications` — timers and their alerts.
- `idle` — stop counting time when you are away.
- `identity` + `drive.appdata` — Google sign-in and sync to your own Drive.
- `scripting` + access to all sites — show the floating timer widget on pages.

## Your control

Settings → Data exports or imports everything as a JSON file. Insights lets you
delete a site's history. Signing out stops syncing. Uninstalling removes local
data; remove the Drive copy at Google Drive → Settings → Manage apps → Sumi →
Delete hidden app data.

## Contact

Open an issue on the project's GitHub repository.
