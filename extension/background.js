// Sumi service worker: timer + stopwatch, time-per-site tracking (kept forever),
// focus-time site blocking, Drive sync scheduling, keyboard commands.
import * as T from './lib/timer.js';
import { getSettings, update, dayKey, domainOf, matchesDomain } from './lib/store.js';
import { syncNow, RECORDS } from './lib/sync.js';

// ---------------- install / startup ----------------
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.alarms.create('usage-flush', { periodInMinutes: 1 });
  chrome.alarms.create('sync', { periodInMinutes: 15 });
  await T.badge();
  await injectWidgetEverywhere();
  if (reason === 'install') chrome.tabs.create({ url: 'app/app.html#welcome' });
});
chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create('usage-flush', { periodInMinutes: 1 });
  chrome.alarms.create('sync', { periodInMinutes: 15 });
  await T.badge();
  syncNow(false).catch(() => {});
});

// tabs opened before the extension was installed/updated get the floating widget too
async function injectWidgetEverywhere() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const t of tabs) chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content/widget.js'] }).catch(() => {});
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
  if (!info.url) return;
  if (tab.active) await setFocus(tab.url);
  await guard(tab);
});
chrome.windows.onFocusChanged.addListener(async wid => { if (wid === chrome.windows.WINDOW_ID_NONE) await setFocus(null); else await refreshFocus(); });
chrome.idle.onStateChanged.addListener(async st => { if (st === 'active') await refreshFocus(); else await setFocus(null); });
getSettings().then(c => chrome.idle.setDetectionInterval(Math.max(15, c.idleSec)));

// ---------------- focus-time blocking ----------------
async function guard(tab) {
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
});

// ---------------- alarms ----------------
chrome.alarms.onAlarm.addListener(async a => {
  if (a.name === 'timer-end') await T.complete(false);
  else if (a.name === 'badge') await T.badge();
  else if (a.name === 'usage-flush') await flush();
  else if (a.name === 'sync' || a.name === 'sync-soon') { await flush(); syncNow(false).catch(() => {}); }
});

// ---------------- keyboard ----------------
chrome.commands.onCommand.addListener(async cmd => {
  if (cmd === 'toggle-timer') await T.toggle();
  if (cmd === 'toggle-stopwatch') await T.swToggle();
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
  timer: { toggle: T.toggle, start: T.start, pause: T.pause, reset: m => T.reset(m.mode), skip: () => T.complete(true), state: T.state },
  stopwatch: { toggle: T.swToggle, start: m => T.swStart(m.label), pause: T.swPause, lap: T.swLap, reset: () => T.swReset(true), discard: () => T.swReset(false), state: T.swState }
};
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (ACTIONS[msg.type]) return ACTIONS[msg.type][msg.action](msg);
    if (msg.type === 'flush') { await flush(); return true; }
    if (msg.type === 'sync') return syncNow(true);
    if (msg.type === 'open-app') return chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html' + (msg.hash || '')) });
    return null;
  })().then(r => reply({ ok: true, data: r }), e => reply({ ok: false, error: e.message }));
  return true;
});
