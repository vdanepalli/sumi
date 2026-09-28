// Spaces → Collections → Cards (saved tabs), Toby-style.
// Stored as three record collections so edits from different devices merge per item.
import { all, one, put, putMany, remove, uid, getSettings, safeUrl } from './store.js';

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.created ?? 0) - (b.created ?? 0);
const nextOrder = list => (list.length ? Math.max(...list.map(x => x.order ?? 0)) + 1 : 0);
const isSaveable = url => /^(https?|file|ftp):/.test(url || '');

// ---------- spaces ----------
export async function spaces() {
  let s = (await all('spaces')).sort(byOrder);
  if (!s.length) s = [await put('spaces', { id: uid(), name: 'My space', order: 0, created: Date.now() })];
  return s;
}
export async function addSpace(name) { return put('spaces', { id: uid(), name: name || 'New space', order: nextOrder(await spaces()), created: Date.now() }); }
export async function renameSpace(id, name) { const s = await one('spaces', id); if (s) { s.name = name; await put('spaces', s); } }
export async function deleteSpace(id) {
  const cols = (await all('collections')).filter(c => c.spaceId === id);
  for (const c of cols) await deleteCollection(c.id);
  await remove('spaces', id);
}

// ---------- collections ----------
export async function collections(spaceId) {
  const c = await all('collections');
  return (spaceId ? c.filter(x => x.spaceId === spaceId) : c).sort(byOrder);
}
export async function addCollection(spaceId, name, atTop = true) {
  const list = await collections(spaceId);
  const order = atTop ? (list.length ? Math.min(...list.map(x => x.order ?? 0)) - 1 : 0) : nextOrder(list);
  return put('collections', { id: uid(), spaceId, name: name || 'New collection', order, created: Date.now(), collapsed: false, starred: false });
}
export async function patchCollection(id, patch) { const c = await one('collections', id); if (c) return put('collections', { ...c, ...patch }); return null; }
export async function deleteCollection(id) {
  const cs = (await all('cards')).filter(c => c.collectionId === id).map(c => c.id);
  if (cs.length) await remove('cards', cs);
  await remove('collections', id);
}
export async function reorderCollections(ids) {
  const cols = await all('collections');
  const upd = ids.map((id, i) => { const c = cols.find(x => x.id === id); return c ? { ...c, order: i } : null; }).filter(Boolean);
  await putMany('collections', upd);
}

// ---------- cards ----------
export async function cards(collectionId) {
  const c = await all('cards');
  return (collectionId ? c.filter(x => x.collectionId === collectionId) : c).sort(byOrder);
}
export async function addCards(collectionId, tabs, index) {
  const existing = await cards(collectionId);
  const fresh = tabs.filter(t => isSaveable(t.url)).map(t => ({
    id: uid(), collectionId, url: t.url, title: t.title || t.url, note: t.note || '', fav: t.favIconUrl || t.fav || '', created: Date.now()
  }));
  if (!fresh.length) return [];
  const list = [...existing];
  list.splice(index ?? list.length, 0, ...fresh);
  await putMany('cards', list.map((c, i) => ({ ...c, order: i })));
  return fresh;
}
export async function patchCard(id, patch) { if (patch.url && !safeUrl(patch.url)) delete patch.url; const c = await one('cards', id); if (c) return put('cards', { ...c, ...patch }); return null; }
export const deleteCards = ids => remove('cards', ids);
// move a card to a collection at a position (same or different collection)
export async function moveCard(cardId, toCollection, index) {
  const card = await one('cards', cardId);
  if (!card) return;
  const target = (await cards(toCollection)).filter(c => c.id !== cardId);
  target.splice(index ?? target.length, 0, { ...card, collectionId: toCollection });
  await putMany('cards', target.map((c, i) => ({ ...c, order: i })));
}

// ---------- tabs <-> collections ----------
export async function saveTabs(spaceId, name, tabs, { close } = {}) {
  const cfg = await getSettings();
  const col = await addCollection(spaceId, name);
  await addCards(col.id, tabs);
  if (close ?? cfg.closeAfterSave) {
    const ids = tabs.filter(t => isSaveable(t.url) && t.id && !t.pinned).map(t => t.id);
    if (ids.length) {
      // keep the window alive: open a new tab first if we would close every tab
      const win = await chrome.tabs.query({ windowId: tabs[0].windowId });
      if (win.length <= ids.length) await chrome.tabs.create({ windowId: tabs[0].windowId });
      await chrome.tabs.remove(ids);
    }
  }
  return col;
}
export async function openCards(list, { newWindow = false, focus = true } = {}) {
  const urls = list.map(c => c.url).filter(safeUrl);
  if (!urls.length) return;
  if (newWindow) return chrome.windows.create({ url: urls, focused: focus });
  for (let i = 0; i < urls.length; i += 1) await chrome.tabs.create({ url: urls[i], active: focus && i === 0 });
}
export async function openCard(card, where) {
  if (!safeUrl(card.url)) return null;
  const cfg = await getSettings();
  if ((where || cfg.openCardIn) === 'current') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return chrome.tabs.update(tab.id, { url: card.url });
  }
  return chrome.tabs.create({ url: card.url });
}

// ---------- search ----------
export async function search(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const cols = Object.fromEntries((await all('collections')).map(c => [c.id, c]));
  return (await all('cards'))
    .filter(c => cols[c.collectionId] && words.every(w => `${c.title} ${c.url} ${c.note}`.toLowerCase().includes(w)))
    .map(c => ({ ...c, collection: cols[c.collectionId] }))
    .slice(0, 200);
}

// ---------- import / export ----------
// Toby export: { version, lists: [{ title, cards: [{ title, url, customTitle, customDescription }] }] }
// (also accepts { groups: [{ lists }] } from newer Toby exports)
export async function importToby(json, spaceId) {
  const lists = json.lists || (json.groups || []).flatMap(g => g.lists || []);
  if (!Array.isArray(lists) || !lists.length) throw new Error('No Toby collections found in this file');
  let cols = 0; let n = 0;
  for (const l of lists) {
    const col = await addCollection(spaceId, l.title || 'Imported', false);
    const added = await addCards(col.id, (l.cards || []).map(c => ({ url: c.url, title: c.customTitle || c.title, note: c.customDescription || '' })));
    cols += 1; n += added.length;
  }
  return { collections: cols, cards: n };
}
// OneTab export: lines "url | title", blank line between groups
export async function importOneTab(text, spaceId) {
  const groups = text.trim().split(/\n\s*\n/);
  let n = 0;
  for (const [i, g] of groups.entries()) {
    const tabs = g.split('\n').map(l => { const [url, ...t] = l.split(' | '); return { url: url.trim(), title: t.join(' | ').trim() }; }).filter(t => t.url);
    const col = await addCollection(spaceId, `OneTab ${i + 1}`, false);
    n += (await addCards(col.id, tabs)).length;
  }
  return { collections: groups.length, cards: n };
}
export async function exportToby(spaceId) {
  const cols = await collections(spaceId);
  const lists = [];
  for (const c of cols) lists.push({ title: c.name, cards: (await cards(c.id)).map(k => ({ title: k.title, url: k.url, customTitle: k.title, customDescription: k.note || '' })) });
  return { version: 3, lists };
}

// Chrome bookmarks -> a new space, one collection per folder that holds links
export async function importBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  const space = await addSpace('Chrome bookmarks');
  let cols = 0; let n = 0;
  const walk = async (node, path) => {
    const links = (node.children || []).filter(c => c.url);
    const name = path.filter(Boolean).join(' › ') || 'Bookmarks';
    if (links.length) {
      const col = await addCollection(space.id, name, false);
      n += (await addCards(col.id, links.map(l => ({ url: l.url, title: l.title })))).length;
      cols += 1;
    }
    for (const c of node.children || []) if (!c.url) await walk(c, [...path, c.title]);
  };
  for (const root of tree[0].children || []) await walk(root, [root.title]);
  return { space, collections: cols, cards: n };
}

// "End of day": every window becomes a collection in a new space (optionally closing them)
export async function saveAllWindows(name, { close = false, keepTabId = null } = {}) {
  const tabs = (await chrome.tabs.query({})).filter(t => isSaveable(t.url));
  if (!tabs.length) return null;
  const space = await addSpace(name);
  const wins = [...new Set(tabs.map(t => t.windowId))];
  for (const [i, w] of wins.entries()) {
    const list = tabs.filter(t => t.windowId === w);
    await addCards((await addCollection(space.id, `Window ${i + 1} · ${list.length} tabs`, false)).id, list);
  }
  if (close) {
    // close every window, including the one Sumi is in (after the caller has shown its message)
    const allWins = await chrome.windows.getAll();
    setTimeout(() => { for (const w of allWins) chrome.windows.remove(w.id).catch(() => {}); }, 1200);
  }
  return { space, windows: wins.length, tabs: tabs.length };
}
// reopen a space: each collection in its own window. The first one reuses the
// current window when it only holds new-tab pages (so no extra empty window is left).
export async function openSpaceAsWindows(spaceId) {
  const lists = [];
  for (const c of await collections(spaceId)) {
    const list = (await cards(c.id)).filter(k => safeUrl(k.url));
    if (list.length) lists.push(list);
  }
  if (!lists.length) return 0;
  const cur = await chrome.windows.getCurrent({ populate: true }).catch(() => null);
  const blank = t => /^(chrome|edge|about):\/\/(newtab|new-tab-page)|^chrome-extension:\/\/[^/]+\/app\/app\.html/.test(t.url || t.pendingUrl || '') || t.url === 'about:blank';
  const reusable = cur && cur.tabs.every(blank);
  for (const [i, list] of lists.entries()) {
    if (i === 0 && reusable) {
      for (const [j, k] of list.entries()) await chrome.tabs.create({ windowId: cur.id, url: k.url, active: j === 0 });
      await chrome.tabs.remove(cur.tabs.map(t => t.id)).catch(() => {});
    } else {
      await chrome.windows.create({ url: list.map(k => k.url), focused: i === 0 });
    }
  }
  return lists.length;
}
