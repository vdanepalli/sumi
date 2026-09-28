// Tab tools, used directly from extension pages (tabs API works there).
import { domainOf, put, list, remove, uid, getSettings } from './store.js';

const normalUrl = u => { try { const x = new URL(u); x.hash = ''; return x.href; } catch (e) { return u; } };
const isInternal = t => !/^https?:|^file:/.test(t.url || '');

export async function allTabs() { return chrome.tabs.query({}); }

export async function overview() {
  const tabs = await allTabs();
  const wins = new Set(tabs.map(t => t.windowId));
  const seen = new Map();
  let dupes = 0;
  for (const t of tabs) { const k = normalUrl(t.url); if (seen.has(k)) dupes += 1; else seen.set(k, t); }
  const { staleDays } = await getSettings();
  const cutoff = Date.now() - staleDays * 86400000;
  const stale = tabs.filter(t => !t.active && !t.pinned && !t.audible && t.lastAccessed && t.lastAccessed < cutoff).length;
  const asleep = tabs.filter(t => t.discarded).length;
  const byDomain = {};
  for (const t of tabs) { const d = domainOf(t.url) || 'other'; byDomain[d] = (byDomain[d] || 0) + 1; }
  const top = Object.entries(byDomain).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return { count: tabs.length, windows: wins.size, dupes, stale, asleep, top };
}

export async function search(q) {
  const tabs = await allTabs();
  q = q.trim().toLowerCase();
  if (!q) return tabs.slice(0, 50);
  const words = q.split(/\s+/);
  return tabs
    .map(t => { const hay = `${t.title} ${t.url}`.toLowerCase(); return { t, ok: words.every(w => hay.includes(w)), score: hay.indexOf(words[0]) }; })
    .filter(x => x.ok).sort((a, b) => a.score - b.score).map(x => x.t).slice(0, 50);
}

export async function focusTab(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

export async function closeDuplicates() {
  const tabs = await allTabs();
  const keep = new Map();
  const close = [];
  // prefer keeping the active / pinned copy
  for (const t of [...tabs].sort((a, b) => (b.active - a.active) || (b.pinned - a.pinned))) {
    const k = normalUrl(t.url);
    if (keep.has(k)) close.push(t.id); else keep.set(k, t);
  }
  if (close.length) await chrome.tabs.remove(close);
  return close.length;
}

export async function groupByDomain(windowId) {
  const tabs = await chrome.tabs.query(windowId ? { windowId } : { currentWindow: true });
  const groups = {};
  for (const t of tabs) {
    if (t.pinned) continue;
    const d = domainOf(t.url);
    if (d) (groups[d] = groups[d] || []).push(t.id);
  }
  let made = 0;
  const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
  for (const [d, ids] of Object.entries(groups)) {
    if (ids.length < 2) continue;
    const gid = await chrome.tabs.group({ tabIds: ids });
    await chrome.tabGroups.update(gid, { title: d.replace(/\.(com|org|net|io|dev|co)$/, ''), color: colors[made % colors.length], collapsed: false });
    made += 1;
  }
  return made;
}

export async function ungroupAll() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const ids = tabs.filter(t => t.groupId !== -1).map(t => t.id);
  if (ids.length) await chrome.tabs.ungroup(ids);
  return ids.length;
}

export async function sortByDomain() {
  const tabs = (await chrome.tabs.query({ currentWindow: true })).filter(t => !t.pinned && t.groupId === -1);
  const sorted = [...tabs].sort((a, b) => (domainOf(a.url) || '~').localeCompare(domainOf(b.url) || '~') || a.title.localeCompare(b.title));
  const offset = (await chrome.tabs.query({ currentWindow: true, pinned: true })).length;
  for (let i = 0; i < sorted.length; i += 1) await chrome.tabs.move(sorted[i].id, { index: offset + i });
  return sorted.length;
}

// discard (sleep) tabs not in use: frees memory, the tab reloads when clicked
export async function sleepInactive() {
  const tabs = await allTabs();
  let n = 0;
  for (const t of tabs) {
    if (t.active || t.pinned || t.audible || t.discarded || isInternal(t)) continue;
    try { await chrome.tabs.discard(t.id); n += 1; } catch (e) { /* some tabs cannot be discarded */ }
  }
  return n;
}

export async function staleTabs() {
  const { staleDays } = await getSettings();
  const cutoff = Date.now() - staleDays * 86400000;
  return (await allTabs()).filter(t => !t.active && !t.pinned && !t.audible && t.lastAccessed && t.lastAccessed < cutoff);
}
export async function closeStale() {
  const tabs = await staleTabs();
  if (tabs.length) {
    await saveSession(`Closed stale tabs ${new Date().toLocaleString()}`, tabs); // never lose them
    await chrome.tabs.remove(tabs.map(t => t.id));
  }
  return tabs.length;
}

export async function closeDomain(domain) {
  const tabs = (await allTabs()).filter(t => domainOf(t.url) === domain);
  if (tabs.length) await chrome.tabs.remove(tabs.map(t => t.id));
  return tabs.length;
}

export async function mergeWindows() {
  const cur = await chrome.windows.getCurrent();
  const tabs = (await allTabs()).filter(t => t.windowId !== cur.id);
  for (const t of tabs) await chrome.tabs.move(t.id, { windowId: cur.id, index: -1 });
  return tabs.length;
}

// ---- sessions ----
export async function saveSession(name, tabs) {
  tabs = tabs || (await chrome.tabs.query({ currentWindow: true }));
  const items = tabs.filter(t => !isInternal(t)).map(t => ({ url: t.url, title: t.title, pinned: !!t.pinned, fav: t.favIconUrl || '' }));
  if (!items.length) return null;
  return put('sessions', { id: uid(), name: name || `Session ${new Date().toLocaleString()}`, created: Date.now(), tabs: items });
}
export const sessions = async () => (await list('sessions')).sort((a, b) => b.created - a.created);
export async function restoreSession(s, newWindow = true) {
  if (newWindow) {
    const w = await chrome.windows.create({ url: s.tabs.map(t => t.url), focused: true });
    const created = await chrome.tabs.query({ windowId: w.id });
    for (let i = 0; i < s.tabs.length; i += 1) if (s.tabs[i].pinned && created[i]) await chrome.tabs.update(created[i].id, { pinned: true });
  } else {
    for (const t of s.tabs) await chrome.tabs.create({ url: t.url, pinned: t.pinned, active: false });
  }
}
export const deleteSession = id => remove('sessions', id);
