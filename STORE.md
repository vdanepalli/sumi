# Chrome Web Store listing notes

## Sumi — Tabs, Focus & Time

**Short description (≤132 chars)**
Save tabs into collections, focus with a floating timer and stopwatch, and see where your time goes — all in your own Google account.

**Category:** Productivity → Workflow & planning

**Long description**
Sumi replaces your new tab with a calm, true-black workspace.

TAB COLLECTIONS — organise tabs into spaces and collections. Drag open tabs in, save whole windows, search everything, open a collection in one click. Imports from Toby and OneTab.

FOCUS — Pomodoro timer and stopwatch that float on every page while running (drag the widget anywhere). Daily goals, streaks, and optional blocking of distracting sites.

VIDEO PROGRESS — a small floating overlay on long videos (YouTube and others): % watched, time left at your playback speed, and when it will end. Works in full screen. Opt in to track a video and see real time spent, % actually seen, pauses, rewinds, skips and sittings.

INSIGHTS — time per website with your full history: today, weeks, months, all time, a yearly heatmap and CSV export.

READ & WATCH LATER — queue articles, papers and videos with read-by / watch-by deadlines and reminders.

TASKS — a simple list next to your tabs.

TAB TOOLS — close duplicates, group or sort by site, sleep inactive tabs, close stale tabs safely, merge windows.

PRIVATE — sign in with Google and your data is stored in a hidden folder in your own Google Drive. No Sumi servers, no analytics.

**Single purpose:** a new-tab workspace for organising tabs and staying focused.

**Permission justifications**
- tabs / tabGroups: list, search, save, group and sort the user's tabs; measure time on the active tab; redirect blocked sites during focus.
- storage / unlimitedStorage: store collections, tasks and long-term time history locally.
- alarms / notifications: run the timer and notify when a session ends.
- idle: pause time tracking when the user is away.
- contextMenus: "Save to Sumi Later" on pages and links.
- bookmarks: import the user's bookmarks into collections when they ask to.
- identity: Google sign-in to sync with the user's own Drive (drive.appdata).
- scripting + host permission <all_urls>: inject the floating timer widget and the video progress overlay into pages (display only; the overlay reads just the video's length and position, nothing is stored or sent).

**Data disclosures:** handles "Web history" (domains + time) and "Website content" is NOT read. Data is stored locally and in the user's own Google Drive, never transferred to the developer, not sold, not used for unrelated purposes.

## True Black (theme)
**Short description:** A pure black Chrome theme: black frame, tabs and new tab page, soft grey text.
**Category:** Themes → Dark & Black
