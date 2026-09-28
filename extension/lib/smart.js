// Background helpers: session snapshots, auto-sleep, tab-limit nudge, auto-group
// rules, per-site daily limits, categories, weekly review.
import { get, set, update, getSettings, dayKey, daysAgo, domainOf, matchesDomain, uid } from './store.js';

const SNAP_KEEP = 30;
const webTab = t => /^(https?|file):/.test(t.url || '');

// ---------- session snapshots (auto-save every window) ----------
export async function snapshot(reason = 'auto') {
  const tabs = (await chrome.tabs.query({})).filter(webTab);
  if (!tabs.length) return null;
  const wins = {};
  for (const t of tabs) (wins[t.windowId] = wins[t.windowId] || []).push({ url: t.url, title: t.title, pinned: t.pinned, fav: t.favIconUrl || '' });
  const snap = { id: uid(), at: Date.now(), reason, windows: Object.values(wins), count: tabs.length };
  const sig = JSON.stringify(snap.windows.map(w => w.map(t => t.url)));
  await update('snapshots', [], list => {
    if (list[0] && list[0].sig === sig) { list[0].at = snap.at; return list; } // unchanged: just refresh the time
    return [{ ...snap, sig }, ...list].slice(0, SNAP_KEEP);
  });
  await set('lastSnapshot', Date.now());
  return snap;
}
export async function restoreSnapshot(snap, windowIndex = null) {
  const wins = windowIndex === null ? snap.windows : [snap.windows[windowIndex]];
  for (const w of wins) {
    const created = await chrome.windows.create({ url: w.map(t => t.url), focused: true });
    const tabs = await chrome.tabs.query({ windowId: created.id });
    w.forEach((t, i) => { if (t.pinned && tabs[i]) chrome.tabs.update(tabs[i].id, { pinned: true }); });
  }
}

// ---------- auto-sleep ----------
export async function autoSleep() {
  const cfg = await getSettings();
  if (!cfg.autoSleepMin) return 0;
  const cutoff = Date.now() - cfg.autoSleepMin * 60000;
  let n = 0;
  for (const t of await chrome.tabs.query({})) {
    if (t.active || t.pinned || t.audible || t.discarded || !webTab(t) || !t.lastAccessed || t.lastAccessed > cutoff) continue;
    if (matchesDomain(domainOf(t.url), cfg.sleepExcluded)) continue;
    try { await chrome.tabs.discard(t.id); n += 1; } catch (e) { /* not discardable */ }
  }
  return n;
}

// ---------- tab-limit nudge (at most once every 2 hours) ----------
export async function tabNudge() {
  const cfg = await getSettings();
  if (!cfg.tabLimit) return;
  const tabs = await chrome.tabs.query({});
  if (tabs.length <= cfg.tabLimit) return;
  const last = await get('lastNudge', 0);
  if (Date.now() - last < 2 * 3600000) return;
  const stale = tabs.filter(t => !t.active && !t.pinned && t.lastAccessed && t.lastAccessed < Date.now() - cfg.staleDays * 86400000).length;
  chrome.notifications.create('nudge', {
    type: 'basic', iconUrl: '/icons/icon128.png', title: `${tabs.length} tabs open`,
    message: stale ? `${stale} haven't been touched in ${cfg.staleDays}+ days. Save and close them from Sumi → Collections → Stale.` : 'Save a window to a collection to clear some space.',
    buttons: [{ title: 'Open Sumi' }]
  });
  await set('lastNudge', Date.now());
}

// ---------- auto-group rules: "url part = Group name" ----------
export function parseRules(lines) {
  return (lines || []).map(l => l.split('=').map(s => s.trim())).filter(([m, n]) => m && n).map(([match, name]) => ({ match: match.toLowerCase(), name }));
}
export async function applyGroupRules(tab) {
  const cfg = await getSettings();
  const rules = parseRules(cfg.groupRules);
  if (!rules.length || !webTab(tab) || tab.pinned) return;
  const url = tab.url.toLowerCase();
  const rule = rules.find(r => url.includes(r.match));
  if (!rule) return;
  const groups = await chrome.tabGroups.query({ windowId: tab.windowId, title: rule.name });
  if (groups[0]) { if (tab.groupId !== groups[0].id) await chrome.tabs.group({ tabIds: [tab.id], groupId: groups[0].id }); }
  else { const gid = await chrome.tabs.group({ tabIds: [tab.id] }); await chrome.tabGroups.update(gid, { title: rule.name }); }
}

// ---------- site limits ----------
export function parseLimits(lines) {
  return (lines || []).map(l => l.trim().split(/\s+/)).filter(([d, m]) => d && Number(m) > 0).map(([d, m]) => ({ domain: d.replace(/^www\./, ''), min: Number(m) }));
}
export async function limitFor(domain) {
  const cfg = await getSettings();
  return parseLimits(cfg.siteLimits).find(l => domain === l.domain || domain.endsWith('.' + l.domain)) || null;
}
// seconds used today on every domain covered by the limit
export async function usedToday(limit) {
  const day = (await get('usage', {}))[dayKey()] || {};
  return Object.entries(day).filter(([d]) => d === limit.domain || d.endsWith('.' + limit.domain)).reduce((a, [, s]) => a + s, 0);
}
export async function overLimit(domain) {
  const cfg = await getSettings();
  if (!cfg.limitBlock || !domain) return null;
  const l = await limitFor(domain);
  if (!l) return null;
  return (await usedToday(l)) >= l.min * 60 ? l : null;
}
// warn at 80% and 100% (once per day each)
export async function checkLimit(domain) {
  const l = domain && await limitFor(domain);
  if (!l) return;
  const used = await usedToday(l);
  const key = `${dayKey()}:${l.domain}`;
  const warned = await get('limitWarned', {});
  const level = used >= l.min * 60 ? 100 : used >= l.min * 48 ? 80 : 0;
  if (!level || (warned[key] || 0) >= level) return;
  await set('limitWarned', { ...Object.fromEntries(Object.entries(warned).filter(([k]) => k.startsWith(dayKey()))), [key]: level });
  chrome.notifications.create('limit-' + Date.now(), {
    type: 'basic', iconUrl: '/icons/icon128.png', priority: 2,
    title: level === 100 ? `${l.domain}: daily limit reached` : `${l.domain}: 80% of today's limit`,
    message: `${Math.round(used / 60)} of ${l.min} minutes used today.`
  });
}

// ---------- categories ----------
export function categoryOf(domain, cfg) {
  if (matchesDomain(domain, cfg.productive)) return 'productive';
  if (matchesDomain(domain, cfg.distracting)) return 'distracting';
  return 'neutral';
}

// ---------- weekly review (Monday, once) ----------
export function weekSummary(usage, focusLog, later, cfg, offsetWeeks = 0) {
  const days = [...Array(7)].map((_, i) => daysAgo(i + offsetWeeks * 7));
  const cat = { productive: 0, neutral: 0, distracting: 0 };
  const sites = {};
  for (const d of days) for (const [dom, s] of Object.entries(usage[d] || {})) { cat[categoryOf(dom, cfg)] += s; sites[dom] = (sites[dom] || 0) + s; }
  const total = cat.productive + cat.neutral + cat.distracting;
  const focus = days.reduce((a, d) => a + (focusLog[d]?.minutes || 0), 0);
  const since = Date.now() - (offsetWeeks + 1) * 7 * 86400000; const until = Date.now() - offsetWeeks * 7 * 86400000;
  const done = later.filter(i => i.doneAt && i.doneAt > since && i.doneAt <= until).length;
  const top = Object.entries(sites).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { total, cat, focus, done, top, score: total ? Math.round((100 * cat.productive) / total) : 0 };
}
export async function weeklyReview() {
  const cfg = await getSettings();
  if (!cfg.weeklyReview || new Date().getDay() !== 1) return;
  const week = dayKey();
  if ((await get('lastReview', '')) === week) return;
  const later = Object.values(await get('later', {})).filter(x => !x.deleted);
  const s = weekSummary(await get('usage', {}), await get('focusLog', {}), later, cfg, 0);
  const h = x => `${Math.round(x / 360) / 10}h`;
  chrome.notifications.create('review', {
    type: 'basic', iconUrl: '/icons/icon128.png', title: 'Your week in Sumi',
    message: `${h(s.total)} online · ${s.score}% productive · ${Math.round(s.focus / 6) / 10}h focused · ${s.done} Later items finished`,
    buttons: [{ title: 'Open weekly review' }]
  });
  await set('lastReview', week);
}
