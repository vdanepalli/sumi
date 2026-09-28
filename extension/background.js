// Sumi service worker: timer + stopwatch, time-per-site tracking (kept forever),
// focus-time site blocking, Drive sync scheduling, keyboard commands.
import * as T from './lib/timer.js';
import { getSettings, update, dayKey, domainOf, matchesDomain } from './lib/store.js';
import { syncNow, RECORDS } from './lib/sync.js';
import * as L from './lib/later.js';
import * as SM from './lib/smart.js';

// ---------------- install / startup ----------------
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.alarms.create('usage-flush', { periodInMinutes: 1 });
  chrome.alarms.create('sync', { periodInMinutes: 15 });
  await T.badge();
  await injectWidgetEverywhere();
  makeMenus();
  scheduleReminders();
  chrome.alarms.create('maintain', { periodInMinutes: 5 });
  if (reason === 'install') chrome.tabs.create({ url: 'app/app.html#welcome' });
});
chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create('usage-flush', { periodInMinutes: 1 });
  chrome.alarms.create('sync', { periodInMinutes: 15 });
  await T.badge();
  scheduleReminders();
  chrome.alarms.create('maintain', { periodInMinutes: 5 });
  SM.snapshot('startup').catch(() => {});
  syncNow(false).catch(() => {});
});

// tabs opened before the extension was installed/updated get the floating widget too
async function injectWidgetEverywhere() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const t of tabs) chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content/widget.js', 'content/progress.js'] }).catch(() => {});
}

// ---------------- time per site ----------------
// the domain being looked at is kept in storage.session so it survives the service
// worker being stopped; elapsed time is credited on every change and every minute.
const MAX_CHUNK = 5 * 60;
const currentFocus = async () => (await chrome.storage.session.get('cur')).cur || null;

async function flush() {
  const cur = await currentFocus();
  if (!cur) return;
  const now = Date.now();
  const secs = Math.min(MAX_CHUNK, Math.round((now - cur.since) / 1000));
  if (secs > 0) {
    await update('usage', {}, u => {
      const d = dayKey();
      const day = { ...(u[d] || {}) };
      day[cur.domain] = (day[cur.domain] || 0) + secs;
      return { ...u, [d]: day }; // history is kept forever (a year is ~0.5 MB)
    });
    await SM.checkLimit(cur.domain);
    if (await SM.overLimit(cur.domain)) { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); if (t) await guard(t); }
  }
  await chrome.storage.session.set({ cur: { ...cur, since: now } });
}
async function setFocus(url) {
  await flush();
  const cfg = await getSettings();
  const domain = cfg.trackUsage ? domainOf(url || '') : null;
  const tracked = domain && !matchesDomain(domain, cfg.excluded);
  await chrome.storage.session.set({ cur: tracked ? { domain, since: Date.now() } : null });
}
async function refreshFocus() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const idle = await chrome.idle.queryState(Math.max(15, (await getSettings()).idleSec));
  const win = tab ? await chrome.windows.get(tab.windowId).catch(() => null) : null;
  await setFocus(tab && idle === 'active' && win?.focused ? tab.url : null);
}
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  await setFocus(tab?.url);
  if (tab) await guard(tab);
});
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status === 'complete') SM.applyGroupRules(tab).catch(() => {});
  if (!info.url) return;
  if (tab.active) await setFocus(tab.url);
  await guard(tab);
});
chrome.windows.onRemoved.addListener(() => SM.snapshot('window closed').catch(() => {}));
chrome.windows.onFocusChanged.addListener(async wid => { if (wid === chrome.windows.WINDOW_ID_NONE) await setFocus(null); else await refreshFocus(); });
chrome.idle.onStateChanged.addListener(async st => { if (st === 'active') await refreshFocus(); else await setFocus(null); });
getSettings().then(c => chrome.idle.setDetectionInterval(Math.max(15, c.idleSec)));

// ---------------- focus-time blocking ----------------
async function guard(tab) {
  const dom = domainOf(tab.url || '');
  const over = await SM.overLimit(dom);
  if (over) return chrome.tabs.update(tab.id, { url: chrome.runtime.getURL(`pages/blocked.html?limit=${over.min}&u=${encodeURIComponent(tab.url)}`) });
  const cfg = await getSettings();
  if (!cfg.blockDuringFocus || !(await T.isFocusing())) return;
  const d = domainOf(tab.url || '');
  if (d && matchesDomain(d, cfg.blocked)) chrome.tabs.update(tab.id, { url: chrome.runtime.getURL(`pages/blocked.html?u=${encodeURIComponent(tab.url)}`) });
}

// ---------------- sync scheduling ----------------
// sync ~20s after the last change to saved data, plus every 15 minutes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ([...RECORDS, 'settings'].some(k => k in changes)) chrome.alarms.create('sync-soon', { when: Date.now() + 20000 });
  if (changes.later) scheduleReminders();
});

// ---------------- alarms ----------------
chrome.alarms.onAlarm.addListener(async a => {
  if (a.name === 'timer-end') await T.complete(false);
  else if (a.name === 'badge') await T.badge();
  else if (a.name === 'usage-flush') await flush();
  else if (a.name === 'sync' || a.name === 'sync-soon') { await flush(); syncNow(false).catch(() => {}); }
  else if (a.name.startsWith('later:')) await remind(a.name.slice(6));
  else if (a.name === 'maintain') {
    const cfg = await getSettings();
    if (Date.now() - (await chrome.storage.local.get('lastSnapshot')).lastSnapshot >= cfg.snapshotMin * 60000 || !(await chrome.storage.local.get('lastSnapshot')).lastSnapshot) await SM.snapshot('auto');
    await SM.autoSleep();
    await SM.tabNudge();
    await SM.weeklyReview();
  }
});

// ---------------- keyboard ----------------
chrome.commands.onCommand.addListener(async cmd => {
  if (cmd === 'toggle-timer') await T.toggle();
  if (cmd === 'toggle-stopwatch') await T.swToggle();
  if (cmd === 'save-later') {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && /^https?:/.test(tab.url)) { const it = await L.add({ url: tab.url, title: tab.title }); note(`Saved to ${L.KINDS[it.kind]} later`, it.title); }
  }
  if (cmd === 'save-window') {
    const { spaces, saveTabs } = await import('./lib/collections.js');
    const [space] = await spaces();
    const tabs = await chrome.tabs.query({ currentWindow: true });
    await saveTabs(space.id, `Saved ${new Date().toLocaleString()}`, tabs);
    chrome.notifications.create('saved-' + Date.now(), { type: 'basic', iconUrl: '/icons/icon128.png', title: 'Window saved', message: `${tabs.length} tabs saved to ${space.name}` });
  }
});

// ---------------- messages ----------------
const ACTIONS = {
  timer: { toggle: T.toggle, start: m => T.start({ project: m.project, minutes: m.minutes }), setProject: m => T.setProject(m.project), pause: T.pause, reset: m => T.reset(m.mode), skip: () => T.complete(true), state: T.state },
  stopwatch: { toggle: T.swToggle, start: m => T.swStart(m.label, m.project), pause: T.swPause, lap: T.swLap, reset: () => T.swReset(true), discard: () => T.swReset(false), state: T.swState }
};
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (ACTIONS[msg.type]) return ACTIONS[msg.type][msg.action](msg);
    if (msg.type === 'flush') { await flush(); return true; }
    if (msg.type === 'sync') return syncNow(true);
    if (msg.type === 'snapshot') return SM.snapshot('manual');
    if (msg.type === 'open-app') return chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html' + (msg.hash || '')) });
    return null;
  })().then(r => reply({ ok: true, data: r }), e => reply({ ok: false, error: e.message }));
  return true;
});

// ---------------- Later: right-click menus ----------------
function makeMenus() {
  chrome.contextMenus.removeAll(() => {
    const ctx = ['page', 'link', 'video'];
    chrome.contextMenus.create({ id: 'later', title: 'Save to Sumi Later', contexts: ctx });
    for (const [k, label] of Object.entries(L.KINDS)) chrome.contextMenus.create({ id: `later-${k}`, parentId: 'later', title: `${label} later`, contexts: ctx });
    chrome.contextMenus.create({ id: 'later-sep', parentId: 'later', type: 'separator', contexts: ctx });
    for (const [k, label] of [['tonight', 'Tonight'], ['tomorrow', 'By tomorrow'], ['weekend', 'By the weekend'], ['week', 'Within a week']]) {
      chrome.contextMenus.create({ id: `due-${k}`, parentId: 'later', title: `Save · due ${label.toLowerCase()} (reminder 1h before)`, contexts: ctx });
    }
    chrome.contextMenus.create({ id: 'save-tab', title: 'Save tab to a Sumi collection (new)', contexts: ['page'] });
  });
}
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.linkUrl || info.srcUrl || info.pageUrl;
  const title = info.linkUrl ? (info.selectionText || info.linkUrl) : tab?.title;
  if (!/^https?:/.test(url || '')) return;
  const id = String(info.menuItemId);
  if (id.startsWith('later-')) {
    const it = await L.add({ url, title, kind: id.slice(6) });
    note(`Saved to ${L.KINDS[it.kind]} later`, it.title);
  } else if (id.startsWith('due-')) {
    const due = L.presetDue(id.slice(4));
    const it = await L.add({ url, title, due, remindBefore: 60 });
    note(`Saved · due ${new Date(due).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`, it.title);
  } else if (id === 'save-tab' && tab) {
    const { spaces, saveTabs } = await import('./lib/collections.js');
    const [space] = await spaces();
    await saveTabs(space.id, tab.title?.slice(0, 40) || 'Saved', [tab], { close: false });
    note('Tab saved', tab.title);
  }
});

// ---------------- Later: reminders ----------------
async function scheduleReminders() {
  const alarms = await chrome.alarms.getAll();
  for (const a of alarms) if (a.name.startsWith('later:')) await chrome.alarms.clear(a.name);
  const now = Date.now();
  for (const it of await L.items()) {
    if (it.status === 'done' || !it.remindAt) continue;
    if (it.remindAt > now) chrome.alarms.create('later:' + it.id, { when: it.remindAt });
    else if (!it.reminded) chrome.alarms.create('later:' + it.id, { when: now + 5000 }); // missed while the browser was closed
  }
}
async function remind(id) {
  const it = (await L.items()).find(x => x.id === id);
  if (!it || it.status === 'done') return;
  chrome.notifications.create('later:' + id, {
    type: 'basic', iconUrl: '/icons/icon128.png', priority: 2, requireInteraction: true,
    title: `${L.KINDS[it.kind]}: ${it.due ? (it.due < Date.now() ? 'overdue' : 'due ' + L.relTime(it.due)) : 'reminder'}`,
    message: it.title.slice(0, 200),
    buttons: [{ title: 'Open now' }, { title: 'Snooze 1 hour' }]
  });
  await L.patch(id, { reminded: true });
}
chrome.notifications.onButtonClicked.addListener(async (nid, btn) => {
  if (nid === 'nudge') return chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html#collections') });
  if (nid === 'review') return chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html#insights') });
  if (!nid.startsWith('later:')) return;
  const id = nid.slice(6);
  chrome.notifications.clear(nid);
  const it = (await L.items()).find(x => x.id === id);
  if (!it) return;
  if (btn === 0) { await chrome.tabs.create({ url: it.url }); if (it.status === 'todo') await L.patch(id, { status: 'doing' }); }
  if (btn === 1) await L.patch(id, { remindAt: Date.now() + 3600000, reminded: false });
});
chrome.notifications.onClicked.addListener(async nid => {
  if (!nid.startsWith('later:')) return;
  chrome.notifications.clear(nid);
  chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html#later') });
});
function note(title, message) {
  chrome.notifications.create('n-' + Date.now(), { type: 'basic', iconUrl: '/icons/icon128.png', title, message: (message || '').slice(0, 200) });
}
