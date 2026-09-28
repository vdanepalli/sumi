# Sumi 墨 — tabs, focus & time for Chrome

A Toby-style tab manager with focus tools and time tracking, on a true-black new
tab. Everything is stored in the user's **own Google account** (a private app
folder in their Google Drive) — there is no Sumi server.

| Folder | What it is |
| --- | --- |
| `extension/` | **Sumi** — the extension (new tab app, popup, floating widget, background worker) |
| `theme/` | **True Black** — optional pure-black Chrome theme (Chrome does not allow themes and extensions in one package) |

## Features

### Collections (the new tab)
- **Spaces → Collections → saved tabs**, like Toby. Rename, collapse, reorder
  collections by dragging their headers, move a collection to another space by
  dropping it on the space.
- **Open tabs panel** (right): every window and tab, live. Drag a tab onto a
  collection (hold Alt to also close it), onto the drop zone for a new
  collection, or click *Save* to save a whole window.
- Cards: click to open (⌘/Ctrl-click: new tab), edit title / URL / note, drag to
  reorder or move between collections, remove.
- Collection actions: open all, open in a new window, add the current tab, delete.
- **Search every saved tab** in every space (`/`).
- **Import** from Toby (JSON) and OneTab (text); **export** a space in Toby format.
- Tab tools: close duplicates, group by site (tab groups), sort by site, put
  inactive tabs to sleep, save & close stale tabs, merge all windows, close a tab.

### Later — read / watch / papers, with deadlines
- Save any page or link: right-click → **Save to Sumi Later** (Read / Watch / Paper /
  Listen, or with a deadline preset), the popup, `Alt+Shift+L`, or paste a link.
- Type is detected (YouTube/Vimeo → Watch, arXiv/DOI/PDF → Paper, podcasts →
  Listen); titles and thumbnails are filled in automatically; YouTube playlists
  are recognised; *Save open YouTube tabs* queues every open video.
- Deadline ("read / watch by") with a reminder (at the deadline, 15 min – 2 days
  before). Reminder notifications have **Open now** and **Snooze 1 hour**;
  reminders missed while Chrome was closed fire on next start.
- Status (not started → in progress → done), priority, estimated minutes, tags,
  notes. Grouped as Overdue / Today / This week / Later / No deadline / Done, with
  filters, search, and a due-count badge in the sidebar.

### Frequently visited & bookmarks
- The Collections page shows your most-used sites (last 30 days) — click to open
  or drag into a collection.
- Import Chrome bookmarks as a space (one collection per folder).

### Focus
- **Pomodoro** (focus / short / long break cycles, auto-start options, daily goal,
  streak, 30-day chart) with optional **blocking of distracting sites** during focus.
- **Stopwatch** with a label, laps, and a log of stopped sessions.
- **Floating widget on every page** while the timer or stopwatch is active:
  pause/resume, reset, skip; stopwatch lap, reset, stop & save — drag it anywhere (the position is shared by every tab
  and window), click the dot to minimise, double-click to open Sumi. Can be hidden
  per site.

### Insights
- Time per website, **kept permanently** (not just 7 days), merged across all your
  signed-in computers (or this device only).
- Ranges: today, yesterday, 7 / 30 / 90 days, this year, all time, custom dates.
- Totals with change vs the previous period, daily average, top site; chart by
  day / week / month; 12-month heatmap; full per-site table (share, days, average);
  CSV export; delete a site's history. Counts only the tab you are looking at and
  pauses when idle or locked; sites can be excluded.

### Tasks
- A simple list: add (`!high`, `!today` tags), complete, edit inline, drag to
  reorder, clear completed.

### Everywhere
- Popup (`Alt+Shift+S`): timer & stopwatch controls, save this tab / window to any
  collection, quick tab tools, time on the current site.
- Shortcuts: `Alt+Shift+P` timer, `Alt+Shift+W` stopwatch, `Alt+Shift+K` save
  window, `Alt+Shift+L` save page to Later (change at `chrome://extensions/shortcuts`).

## Your data

- **Sign in with Google is required.** Data is kept locally for speed and synced
  (20 s after changes, every 15 min, and on startup) to a hidden app-data file in
  the user's own Google Drive (scope `drive.appdata`: Sumi can see only its own
  folder, never other files). Records merge per item, so several computers work.
- No analytics, no Sumi server. See [PRIVACY.md](PRIVACY.md).
- Settings → Data: export / import a full JSON backup.

## Setup

### 1. Try it (developer build)
1. `chrome://extensions` → **Developer mode** → **Load unpacked** → `extension/`.
2. Open a new tab. Until a Google client ID is configured (step 2) the sign-in
   screen offers *Continue on this device only*.
3. Optional: **Load unpacked** → `theme/` for the black theme.

### 2. Google sign-in (one time, for the publisher)
1. Load the extension and copy its ID. To keep the ID stable across machines and
   the Web Store, add the store listing's public key as `"key"` in `manifest.json`.
2. [Google Cloud Console](https://console.cloud.google.com): new project → enable
   **Google Drive API**.
3. **OAuth consent screen** → External → scope `.../auth/drive.appdata` (a
   non-sensitive scope: no security review needed) → publish the app.
4. **Credentials → Create OAuth client ID → Chrome extension** → paste the ID.
5. Put the client ID in `extension/manifest.json` → `oauth2.client_id`, reload.

### 3. Publish
```bash
./package.sh     # dist/sumi-extension-<version>.zip and dist/sumi-theme-<version>.zip
```
Upload at https://chrome.google.com/webstore/devconsole ($5 one-time developer
fee). Listing text and permission justifications: [STORE.md](STORE.md).

## Development

Plain JavaScript modules, no build step.

- `lib/` — `store` (storage + records), `collections`, `tabs`, `timer` (pomodoro +
  stopwatch), `sync` (Google sign-in + Drive merge), `ui`.
- `background.js` — service worker: timers, tracking, blocking, sync schedule.
- `app/` — new tab app; `app/views/` — collections, focus, insights, tasks, settings.
- `content/widget.js` — floating timer (shadow DOM).
- `dev/` — `preview.html` (the app) and `widget-test.html` with a mocked
  `chrome.*` API and sample data:
  `python3 -m http.server -d extension 8820` → http://localhost:8820/dev/preview.html.
  Not included in the store package.

## License

MIT
