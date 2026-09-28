// Sumi service worker: focus timer, time-per-site tracking, focus-time site
// blocking, right-click dictionary lookups, keyboard commands, background sync.
import * as T from './lib/timer.js';
import { getSettings, update, dayKey, domainOf, matchesDomain, get, set } from './lib/store.js';
import { lookup, saveTerm, firstDef, normalize } from './lib/dict.js';
import { syncNow, configured } from './lib/sync.js';

// ---------------- install ----------------
chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'lookup', title: 'Sumi: look up and save “%s”', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'idiom', title: 'Sumi: save “%s” as an idiom', contexts: ['selection'] });
  });
  chrome.alarms.create('usage-flush', { periodInMinutes: 1 });
  chrome.alarms.create('sync', { periodInMinutes: 30 });
  await T.badge();
});
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create('usage-flush', { periodInMinutes: 1 }); T.badge(); });

// ---------------- time per site ----------------
// the domain being looked at now is kept in storage.session so it survives the
// service worker being stopped; elapsed time is added on every change/flush.
const MAX_CHUNK = 5 * 60; // never credit more than 5 min at once (sleep, crashes)

async function currentFocus() { return (await chrome.storage.session.get('cur')).cur || null; }

async function flush() {
  const cur = await currentFocus();
  if (!cur) return;
  const now = Date.now();
  const secs = Math.min(MAX_CHUNK, Math.round((now - cur.since) / 1000));
  if (secs > 0) {
    await update('usage', {}, u => {
      const d = dayKey();
      const day = u[d] || {};
      day[cur.domain] = (day[cur.domain] || 0) + secs;
      // keep 90 days
      const keys = Object.keys(u).sort();
      while (keys.length > 90) delete u[keys.shift()];
      return { ...u, [d]: day };
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
  const idle = await chrome.idle.queryState((await getSettings()).idleSec);
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
chrome.windows.onFocusChanged.addListener(async wid => {
  if (wid === chrome.windows.WINDOW_ID_NONE) await setFocus(null); else await refreshFocus();
});
chrome.idle.onStateChanged.addListener(async st => { if (st === 'active') await refreshFocus(); else await setFocus(null); });
getSettings().then(c => chrome.idle.setDetectionInterval(Math.max(15, c.idleSec)));

// ---------------- focus-time blocking ----------------
async function guard(tab) {
  const cfg = await getSettings();
  if (!cfg.blockDuringFocus || !(await T.isFocusing())) return;
  const d = domainOf(tab.url || '');
  if (d && matchesDomain(d, cfg.blocked)) {
    const url = chrome.runtime.getURL(`pages/blocked.html?u=${encodeURIComponent(tab.url)}`);
    chrome.tabs.update(tab.id, { url });
  }
}

// ---------------- alarms ----------------
chrome.alarms.onAlarm.addListener(async a => {
  if (a.name === 'timer-end') await T.complete(false);
  else if (a.name === 'timer-badge') await T.badge();
  else if (a.name === 'usage-flush') await flush();
  else if (a.name === 'sync' && configured() && (await get('syncEnabled', false))) syncNow(false).catch(() => {});
});

// ---------------- dictionary from the right-click menu ----------------
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const text = (info.selectionText || '').trim();
  if (!text || text.length > 80) return;
  const source = tab ? { url: tab.url, title: tab.title } : null;
  try {
    if (info.menuItemId === 'idiom') {
      const r = await lookup(text).catch(() => ({ term: normalize(text), found: false, meanings: [] }));
      await saveTerm(r, { kind: 'idiom', source });
      notify(`Saved idiom: ${r.term}`, r.found ? firstDef(r) : 'Add the meaning in Sumi > Vocabulary.');
    } else {
      const r = await lookup(text);
      const item = await saveTerm(r, { source });
      notify(`${item.term}${r.phonetic ? '  ' + r.phonetic : ''}`, r.found ? `${r.meanings[0].pos}: ${r.meanings[0].defs[0].d}` : 'No dictionary entry - saved so you can add a meaning.');
    }
  } catch (e) {
    notify('Lookup failed', e.message);
  }
});
function notify(title, message) {
  chrome.notifications.create('dict-' + Date.now(), { type: 'basic', iconUrl: '/icons/icon128.png', title, message: (message || '').slice(0, 250) });
}

// ---------------- keyboard ----------------
chrome.commands.onCommand.addListener(async cmd => { if (cmd === 'toggle-timer') await T.toggle(); });

// ---------------- messages from pages ----------------
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === 'timer') {
      const act = msg.action;
      if (act === 'toggle') return T.toggle();
      if (act === 'start') return T.start();
      if (act === 'pause') return T.pause();
      if (act === 'reset') return T.reset(msg.mode);
      if (act === 'skip') return T.complete(true);
      if (act === 'state') return T.state();
    }
    if (msg.type === 'flush') { await flush(); return true; }
    if (msg.type === 'sync') { await set('syncEnabled', true); return syncNow(true); }
    return null;
  })().then(r => reply({ ok: true, data: r }), e => reply({ ok: false, error: e.message }));
  return true; // async reply
});
