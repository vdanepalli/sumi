// Sumi service worker: timer + stopwatch, time-per-site tracking (kept forever),
// focus-time site blocking, Drive sync scheduling, keyboard commands.
import * as T from './lib/timer.js';
import { getSettings, update, dayKey, domainOf, matchesDomain, get, uid } from './lib/store.js';
import { syncNow, RECORDS } from './lib/sync.js';
import * as L from './lib/later.js';
import * as SM from './lib/smart.js';
import * as D from './lib/dev.js';
// static: import() is not allowed in a service worker (it threw, so save-window / save-tab never worked)
import { spaces, saveTabs, closeSaved } from './lib/collections.js';

// ---------------- install / startup ----------------
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  makeMenus();
  chrome.alarms.create('usage-flush', { periodInMinutes: 1 });
  chrome.alarms.create('sync', { periodInMinutes: 15 });
  await T.badge();
  if (reason === 'install' || reason === 'update') await injectWidgetEverywhere();
  scheduleReminders(); scheduleSnoozes();
  chrome.alarms.create('maintain', { periodInMinutes: 5 });
  if (reason === 'install') chrome.tabs.create({ url: 'app/app.html#welcome' });
});
chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create('usage-flush', { periodInMinutes: 1 });
  chrome.alarms.create('sync', { periodInMinutes: 15 });
  await T.badge();
  scheduleReminders(); scheduleSnoozes();
  chrome.alarms.create('maintain', { periodInMinutes: 5 });
  SM.snapshot('startup').catch(() => {});
  syncNow(false).catch(() => {});
});

// tabs opened before the extension was installed/updated get the floating widget too
async function injectWidgetEverywhere() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const t of tabs) if (!t.discarded) chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content/widget.js', 'content/progress.js', 'content/video.js'] }).catch(() => {});
}

// ---------------- time per site ----------------
// the domain being looked at is kept in storage.session so it survives the service
// worker being stopped. Seconds are buffered in storage.session ('pendingUsage') and
// written to the (large, kept forever) 'usage' map at most every few minutes: every
// storage.local write is broadcast to the content scripts of every open tab.
const MAX_CHUNK = 5 * 60;
const COMMIT_EVERY = 3 * 60000;
const currentFocus = async () => (await chrome.storage.session.get('cur')).cur || null;
// one tracking update at a time (tab + window events arrive together: no double counting)
let track = Promise.resolve();
const serial = fn => (...a) => (track = track.then(() => fn(...a), () => fn(...a)));

// add day → key → seconds maps
const addDays = (into, add) => {
  const out = { ...into };
  for (const [d, m] of Object.entries(add)) { const day = { ...(out[d] || {}) }; for (const [k, n] of Object.entries(m)) day[k] = (day[k] || 0) + n; out[d] = day; }
  return out;
};
async function commitUsage(force) {
  const { pendingUsage: p, pendingDev: pd, usageCommitAt = 0 } = await chrome.storage.session.get(['pendingUsage', 'pendingDev', 'usageCommitAt']);
  if (!force && Date.now() - usageCommitAt < COMMIT_EVERY) return;
  await chrome.storage.session.set({ pendingUsage: {}, pendingDev: {}, usageCommitAt: Date.now() });
  // developer time: "kind|entity key" (PR, issue, repo, ticket, localhost) and "cat:<category>" per day
  if (pd && Object.keys(pd).length) await update('devUsage', {}, u => addDays(u, pd));
  if (!p || !Object.keys(p).length) return;
  await update('usage', {}, u => {
    const out = { ...u };
    for (const [d, doms] of Object.entries(p)) {
      const day = { ...(out[d] || {}) };
      for (const [dom, n] of Object.entries(doms)) day[dom] = (day[dom] || 0) + n;
      out[d] = day;
    }
    return out; // history is kept forever (a year is ~0.5 MB)
  });
}
async function _flush(commit = false) {
  const cur = await currentFocus();
  const now = Date.now();
  if (cur) {
    const secs = Math.min(MAX_CHUNK, Math.round((now - cur.since) / 1000));
    if (secs > 0) {
      const { pendingUsage: p = {}, pendingDev: pd = {} } = await chrome.storage.session.get(['pendingUsage', 'pendingDev']);
      const d = dayKey();
      p[d] = { ...(p[d] || {}), [cur.domain]: ((p[d] || {})[cur.domain] || 0) + secs };
      if (cur.dev || cur.cat) {
        const day = { ...(pd[d] || {}) };
        if (cur.dev) day[cur.dev] = (day[cur.dev] || 0) + secs;
        if (cur.cat) day['cat:' + cur.cat] = (day['cat:' + cur.cat] || 0) + secs;
        pd[d] = day;
      }
      await chrome.storage.session.set({ pendingUsage: p, pendingDev: pd, cur: { ...cur, since: now } });
      await SM.checkLimit(cur.domain);
      if (await SM.overLimit(cur.domain)) { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); if (t) await guard(t); }
    }
  }
  await commitUsage(commit);
}
async function _setFocus(url) {
  await _flush();
  const cfg = await getSettings();
  const domain = cfg.trackUsage ? domainOf(url || '') : null;
  const tracked = domain && !matchesDomain(domain, cfg.excluded);
  const e = tracked ? D.entity(url) : null;
  const cat = tracked ? D.category(url, e) : null;
  await chrome.storage.session.set({ cur: tracked ? { domain, since: Date.now(), dev: e && e.kind !== 'commit' ? `${e.kind}|${e.key}` : null, cat } : null });
}
// only the active tab of the focused Chrome window counts, and only while not idle
// (a playing, audible tab counts while idle: watching a video is not being away)
async function _refreshFocus() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const idle = await chrome.idle.queryState(Math.max(15, (await getSettings()).idleSec));
  const win = tab ? await chrome.windows.get(tab.windowId).catch(() => null) : null;
  await _setFocus(tab && win?.focused && (idle === 'active' || (idle === 'idle' && tab.audible)) ? tab.url : null);
}
const flush = serial(_flush);
const setFocus = serial(_setFocus);
const refreshFocus = serial(_refreshFocus);
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await refreshFocus(); // a tab activated in a background window must not steal the tracking
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) await guard(tab);
});
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status === 'complete') SM.applyGroupRules(tab).catch(() => {});
  if (!info.url) return;
  if (tab.active) await refreshFocus();
  await guard(tab);
});
// (no snapshot on window close: taken after the close it never held the closed window, and a
// burst of closes - e.g. quitting Chrome - pushed the useful snapshots out of the 30 kept)
chrome.windows.onFocusChanged.addListener(async wid => { if (wid === chrome.windows.WINDOW_ID_NONE) await setFocus(null); else await refreshFocus(); });
chrome.idle.onStateChanged.addListener(async st => { await refreshFocus(); if (st !== 'active') await flush(true); });
getSettings().then(c => chrome.idle.setDetectionInterval(Math.max(15, c.idleSec)));
// timer that ran out while Chrome was closed (alarms can be lost on restart)
T.reconcile().catch(() => {});

// ---------------- focus-time blocking ----------------
async function guard(tab) {
  const dom = domainOf(tab.url || '');
  if (!dom) return;
  const over = await SM.overLimit(dom);
  if (over) return chrome.tabs.update(tab.id, { url: chrome.runtime.getURL(`pages/blocked.html?limit=${over.min}&u=${encodeURIComponent(tab.url)}`) });
  const cfg = await getSettings();
  const focusing = cfg.blockDuringFocus && await T.isFocusing();
  if (focusing && matchesDomain(dom, cfg.blocked)) return chrome.tabs.update(tab.id, { url: chrome.runtime.getURL(`pages/blocked.html?u=${encodeURIComponent(tab.url)}`) });
  // "what are you here for?": a pause before distracting sites, then 5 or 15 minutes on them
  const site = cfg.intentGate && (cfg.distracting || []).find(x => dom === x || dom.endsWith('.' + x));
  if (site && !focusing) {
    const { intentAllow = {} } = await chrome.storage.session.get('intentAllow');
    if ((intentAllow[site] || 0) < Date.now()) chrome.tabs.update(tab.id, { url: chrome.runtime.getURL(`pages/blocked.html?intent=${encodeURIComponent(site)}&u=${encodeURIComponent(tab.url)}`) });
  }
}
async function allowIntent(site, minutes, reason) {
  const until = Date.now() + Math.min(60, Math.max(1, Number(minutes) || 5)) * 60000;
  const { intentAllow = {} } = await chrome.storage.session.get('intentAllow');
  await chrome.storage.session.set({ intentAllow: { ...intentAllow, [site]: until } });
  chrome.alarms.create('intent-end', { when: until + 1000 }); // time's up: ask again on the next look
  const d = dayKey();
  await update('intents', {}, log => { // this computer only, last 30 days
    const out = Object.fromEntries(Object.entries(log).filter(([k]) => k >= dayKey(new Date(Date.now() - 30 * 86400000))));
    out[d] = [...(out[d] || []), { site, reason: String(reason || '').slice(0, 140), min: Number(minutes) || 5, at: Date.now() }];
    return out;
  });
}

// ---------------- snooze a tab ----------------
// closed now, reopened at `until` on this computer ('snoozed' is not synced: the tab comes back where you left it)
async function snoozeTab(tabId, until) {
  const tab = await chrome.tabs.get(tabId);
  if (!/^(https?|file):/.test(tab.url || '')) throw new Error('This page cannot be snoozed');
  const id = uid();
  await update('snoozed', {}, s => ({ ...s, [id]: { url: tab.url, title: tab.title || tab.url, until, at: Date.now() } }));
  chrome.alarms.create('snooze:' + id, { when: Math.max(until, Date.now() + 1000) });
  await closeSaved([tab]);
  return id;
}
async function wake(id, show = false) {
  const s = (await get('snoozed', {}))[id];
  await update('snoozed', {}, m => { const out = { ...m }; delete out[id]; return out; });
  chrome.alarms.clear('snooze:' + id);
  if (!s || !/^(https?|file):/.test(s.url)) return;
  const tab = await chrome.tabs.create({ url: s.url, active: show });
  if (!show) chrome.notifications.create('woke:' + tab.id, { type: 'basic', iconUrl: '/icons/icon128.png', title: 'Back from snooze', message: String(s.title).slice(0, 200) });
}
async function scheduleSnoozes() {
  const now = Date.now();
  for (const [id, s] of Object.entries(await get('snoozed', {}))) chrome.alarms.create('snooze:' + id, { when: Math.max(s.until, now + 5000) }); // missed while closed: now
}

// ---------------- sync scheduling ----------------
// sync ~20s after the last change to saved data, plus every 15 minutes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const keys = [...RECORDS, 'settings'].filter(k => k in changes);
  // video stats are saved every few seconds while playing: don't keep pushing the sync back for them
  if (keys.length === 1 && keys[0] === 'videos') chrome.alarms.get('sync-soon').then(x => { if (!x) chrome.alarms.create('sync-soon', { when: Date.now() + 120000 }); });
  else if (keys.length) chrome.alarms.create('sync-soon', { when: Date.now() + 20000 });
  if (changes.later) scheduleReminders();
  if (changes.settings) { T.syncLengths().catch(() => {}); getSettings().then(c => chrome.idle.setDetectionInterval(Math.max(15, c.idleSec))); }
  // focus started: block distracting sites already open in front of you
  const tv = changes.timer?.newValue;
  if (tv?.running && tv.mode === 'focus' && !(changes.timer.oldValue?.running && changes.timer.oldValue.mode === 'focus')) chrome.tabs.query({ active: true }).then(ts => ts.forEach(t => guard(t).catch(() => {})));
});

// ---------------- alarms ----------------
chrome.alarms.onAlarm.addListener(async a => {
  if (a.name === 'timer-end') await T.complete(false);
  else if (a.name === 'badge') await T.badge();
  else if (a.name === 'usage-flush') await refreshFocus(); // credits time, re-checks idle / focus
  else if (a.name === 'sync' || a.name === 'sync-soon') { await flush(true); syncNow(false).catch(() => {}); }
  else if (a.name.startsWith('later:')) await remind(a.name.slice(6));
  else if (a.name.startsWith('snooze:')) await wake(a.name.slice(7));
  else if (a.name === 'intent-end') for (const t of await chrome.tabs.query({ active: true })) await guard(t).catch(() => {});
  else if (a.name === 'maintain') {
    const cfg = await getSettings();
    if (Date.now() - (await chrome.storage.local.get('lastSnapshot')).lastSnapshot >= cfg.snapshotMin * 60000 || !(await chrome.storage.local.get('lastSnapshot')).lastSnapshot) await SM.snapshot('auto');
    await SM.autoSleep();
    await SM.tabNudge();
    await SM.weeklyReview();
    await nagTick();
  }
});

// ---------------- keyboard ----------------
chrome.commands.onCommand.addListener(async cmd => {
  if (cmd === 'toggle-timer') await T.toggle();
  if (cmd === 'toggle-stopwatch') await T.swToggle();
  if (cmd === 'save-later') {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && /^https?:/.test(tab.url)) { const it = await L.add({ url: tab.url, title: tab.title, minutes: await L.estimateTab(tab.id) }); note(`Saved to ${L.KINDS[it.kind]} later`, it.title); }
  }
  if (cmd === 'video-progress') await toggleVideo();
  if (cmd === 'save-window') {
    const [space] = await spaces();
    const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
    await saveTabs(space.id, `Saved ${new Date().toLocaleString()}`, tabs);
    chrome.notifications.create('saved-' + Date.now(), { type: 'basic', iconUrl: '/icons/icon128.png', title: 'Window saved', message: `${tabs.length} tabs saved to ${space.name}` });
  }
});

// video progress overlay on the active tab (content/video.js)
async function toggleVideo(tabId) {
  if (!tabId) [{ id: tabId } = {}] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tabId) return { ok: false, error: 'No tab' };
  return chrome.tabs.sendMessage(tabId, { type: 'video-progress' }).catch(() => ({ ok: false, error: 'Reload this page once so Sumi can see its video' }));
}

// ---------------- messages ----------------
const ACTIONS = {
  timer: { toggle: T.toggle, start: m => T.start({ project: m.project, minutes: m.minutes }), setProject: m => T.setProject(m.project), pause: T.pause, reset: m => T.reset(m.mode), skip: () => T.complete(true), state: T.state },
  stopwatch: { toggle: T.swToggle, start: m => T.swStart(m.label, m.project), pause: T.swPause, lap: T.swLap, reset: () => T.swReset(true), discard: () => T.swReset(false), state: T.swState }
};
const PAGE = chrome.runtime.getURL('');
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') return false;
  const page = (sender.url || '').startsWith(PAGE); // extension page, not a content script in some web page
  const known = Object.hasOwn(ACTIONS, msg.type) ? Object.hasOwn(ACTIONS[msg.type], msg.action) : msg.type === 'open-app' || (page && ['flush', 'sync', 'snapshot', 'video-toggle', 'snooze', 'wake', 'intent'].includes(msg.type));
  if (!known) return false; // not ours: leave the channel to other listeners
  (async () => {
    if (ACTIONS[msg.type]) return ACTIONS[msg.type][msg.action](msg);
    if (msg.type === 'flush') { await flush(true); return true; }
    if (msg.type === 'sync') return syncNow(true);
    if (msg.type === 'snapshot') return SM.snapshot('manual');
    if (msg.type === 'video-toggle') return toggleVideo(msg.tabId);
    if (msg.type === 'snooze') return snoozeTab(msg.tabId, Number(msg.until));
    if (msg.type === 'wake') return wake(String(msg.id), true);
    if (msg.type === 'intent') return allowIntent(String(msg.site), msg.minutes, msg.reason);
    if (msg.type === 'open-app') return chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html' + (/^#[\w-]*$/.test(msg.hash || '') ? msg.hash : '')) });
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
    chrome.contextMenus.create({ id: 'snooze', title: 'Snooze this tab', contexts: ['page'] });
    for (const [k, label] of L.SNOOZE) chrome.contextMenus.create({ id: `snooze-${k}`, parentId: 'snooze', title: label, contexts: ['page'] });
    chrome.contextMenus.create({ id: 'video-progress', title: 'Sumi: show / hide video progress', contexts: ['video'] });
  });
}
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'video-progress') return toggleVideo(tab?.id);
  if (String(info.menuItemId).startsWith('snooze-') && tab) {
    const until = L.snoozeAt(String(info.menuItemId).slice(7));
    try { await snoozeTab(tab.id, until); note('Snoozed', `${tab.title || ''} · back ${L.whenLabel(until)}`); } catch (e) { note('Cannot snooze', e.message); }
    return;
  }
  // saving the page itself (not a link on it): estimate how long it takes to read / watch
  const minutes = !info.linkUrl && tab ? await L.estimateTab(tab.id) : null;
  // a <video> src is often blob: - save the page it is on
  const url = [info.linkUrl, info.pageUrl, info.srcUrl].find(u => /^https?:/.test(u || ''));
  const title = info.linkUrl ? (info.selectionText || info.linkUrl) : tab?.title;
  if (!/^https?:/.test(url || '')) return;
  const id = String(info.menuItemId);
  if (id.startsWith('later-')) {
    const it = await L.add({ url, title, kind: id.slice(6), minutes });
    note(`Saved to ${L.KINDS[it.kind]} later`, it.title);
  } else if (id.startsWith('due-')) {
    const due = L.presetDue(id.slice(4));
    const it = await L.add({ url, title, due, remindBefore: 60, minutes });
    note(`Saved · due ${new Date(due).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`, it.title);
  } else if (id === 'save-tab' && tab) {
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
    message: String(it.title || it.url || '').slice(0, 200),
    buttons: [{ title: 'Open now' }, { title: 'Snooze 1 hour' }]
  });
  await L.patch(id, { reminded: true });
}
// "keep reminding me": checked every 5 minutes (maintain alarm). Never during a focus session or while
// away from the computer, only inside the allowed hours; a missed nudge comes on the next check.
async function nagTick() {
  const cfg = await getSettings();
  const now = Date.now();
  const due = (await L.items()).filter(i => i.nag?.every > 0 && i.status !== 'done' && (i.nag.next || 0) <= now);
  if (!due.length || !L.inHours(new Date().getHours(), cfg.nagFrom, cfg.nagTo) || await T.isFocusing()) return;
  if ((await chrome.idle.queryState(Math.max(15, cfg.idleSec))) !== 'active') return;
  for (const it of due.slice(0, 3)) {
    const sent = (it.nag.sent || 0) + 1;
    const days = Math.floor((now - (it.created || now)) / 86400000);
    chrome.notifications.create('nag:' + it.id, {
      type: 'basic', iconUrl: '/icons/icon128.png', priority: 1, requireInteraction: !!cfg.nagSticky,
      title: `Still to ${{ watch: 'watch', listen: 'listen to' }[it.kind] || 'read'}${it.due && it.due < now ? ' · overdue' : ''}`,
      message: String(it.title || it.url || '').slice(0, 200),
      contextMessage: `${days ? `Saved ${days} day${days === 1 ? '' : 's'} ago · ` : ''}nudge ${sent} · ${L.nagLabel(it.nag.every).toLowerCase()}`,
      buttons: [{ title: 'Open now' }, { title: 'Stop reminding me' }]
    }, () => void chrome.runtime.lastError);
    await L.patch(it.id, { nag: { ...it.nag, sent, next: L.nagNext(it.nag.every, cfg.nagFrom, cfg.nagTo, now) } });
  }
}
async function openLater(id) {
  const it = (await L.items()).find(x => x.id === id);
  if (!it || !/^https?:/.test(it.url || '')) return;
  await chrome.tabs.create({ url: it.url });
  if (it.status === 'todo') await L.patch(id, { status: 'doing' });
}

chrome.notifications.onButtonClicked.addListener(async (nid, btn) => {
  if (nid.startsWith('nag:')) {
    chrome.notifications.clear(nid);
    if (btn === 0) return openLater(nid.slice(4));
    await L.patch(nid.slice(4), { nag: null });
    return note('Reminders stopped', 'Turn them back on from Sumi → Later → Edit');
  }
  if (nid === 'nudge' || nid === 'review') chrome.notifications.clear(nid);
  if (nid === 'nudge') return chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html#collections') });
  if (nid === 'review') return chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html#insights') });
  if (!nid.startsWith('later:')) return;
  const id = nid.slice(6);
  chrome.notifications.clear(nid);
  const it = (await L.items()).find(x => x.id === id);
  if (!it) return;
  if (btn === 0 && /^https?:/.test(it.url || '')) { await chrome.tabs.create({ url: it.url }); if (it.status === 'todo') await L.patch(id, { status: 'doing' }); }
  if (btn === 1) await L.patch(id, { remindAt: Date.now() + 3600000, reminded: false });
});
chrome.notifications.onClicked.addListener(async nid => {
  // macOS often hides notification buttons: the body click must lead somewhere too
  const to = { nudge: 'collections', review: 'insights' }[nid] || (nid.startsWith('timer-') ? 'focus' : nid.startsWith('limit-') ? 'insights' : null);
  if (to) { chrome.notifications.clear(nid); return chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html#' + to) }); }
  if (nid.startsWith('nag:')) { chrome.notifications.clear(nid); return openLater(nid.slice(4)); }
  if (nid.startsWith('woke:')) { chrome.notifications.clear(nid); const t = await chrome.tabs.get(Number(nid.slice(5))).catch(() => null); if (t) { await chrome.tabs.update(t.id, { active: true }); await chrome.windows.update(t.windowId, { focused: true }); } return; }
  if (!nid.startsWith('later:')) return;
  chrome.notifications.clear(nid);
  chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html#later') });
});
function note(title, message) {
  chrome.notifications.create('n-' + Date.now(), { type: 'basic', iconUrl: '/icons/icon128.png', title, message: (message || '').slice(0, 200) });
}
