// Storage layer. Everything lives in chrome.storage.local (fast, offline) and is
// synced to the signed-in user's own Google Drive by sync.js. Records in
// collections carry updatedAt and are soft-deleted (tombstones) so two devices can
// be merged safely.

export const DEFAULT_SETTINGS = {
  // focus
  focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4,
  autoStartBreak: true, autoStartFocus: false, dailyGoalMin: 120,
  blockDuringFocus: false,
  blocked: ['youtube.com', 'x.com', 'twitter.com', 'reddit.com', 'instagram.com', 'facebook.com', 'tiktok.com'],
  sound: true,
  // floating widget
  showWidget: true, widgetExcluded: [],
  // tracking
  trackUsage: true, idleSec: 60, excluded: [],
  // collections
  openCardIn: 'new',            // 'new' tab | 'current' tab
  closeAfterSave: false,        // close tabs after saving a window to a collection
  // look
  clock24: false, accent: '#8ab4f8', staleDays: 3,
  // smart tabs
  autoSleepMin: 0,              // unload tabs unused this long (0 = off)
  sleepExcluded: ['mail.google.com', 'calendar.google.com', 'music.youtube.com', 'open.spotify.com'],
  tabLimit: 60,                 // nudge when more tabs than this are open (0 = off)
  groupRules: [],               // "url-part = Group name" lines
  snapshotMin: 15,              // auto-save all windows every N minutes
  // time awareness
  productive: ['github.com', 'stackoverflow.com', 'docs.python.org', 'developer.mozilla.org', 'notion.so', 'claude.ai', 'chatgpt.com', 'arxiv.org', 'figma.com', 'linear.app'],
  distracting: ['youtube.com', 'x.com', 'twitter.com', 'reddit.com', 'instagram.com', 'facebook.com', 'tiktok.com', 'netflix.com'],
  siteLimits: [],               // "domain minutes" lines, e.g. "youtube.com 45"
  limitBlock: true,             // block a site for the rest of the day once its limit is used
  weeklyReview: true
};

export const uid = () => crypto.randomUUID();
export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return dayKey(d); };

export async function get(key, fallback) {
  const r = await chrome.storage.local.get(key);
  return r[key] ?? fallback;
}
export async function set(key, value) { await chrome.storage.local.set({ [key]: value }); }

// serialise read-modify-write per key inside one JS context
const chains = {};
export function update(key, fallback, fn) {
  const run = async () => { const next = await fn(await get(key, fallback)); await set(key, next); return next; };
  chains[key] = (chains[key] || Promise.resolve()).then(run, run);
  return chains[key];
}

// settings are a single record so they sync like everything else
export async function getSettings() { return { ...DEFAULT_SETTINGS, ...((await get('settings', {})).value || {}) }; }
export async function setSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await set('settings', { value: next, updatedAt: Date.now() });
  return next;
}
export async function resetSettings() { await set('settings', { value: {}, updatedAt: Date.now() }); return getSettings(); }

export async function deviceId() {
  let id = await get('deviceId');
  if (!id) { id = uid().slice(0, 8); await set('deviceId', id); }
  return id;
}

// ---- record collections: { id: {...item, updatedAt, deleted?} } ----
export async function all(coll) { return Object.values(await get(coll, {})).filter(x => !x.deleted); }
export async function one(coll, id) { const x = (await get(coll, {}))[id]; return x && !x.deleted ? x : null; }
export async function put(coll, item) {
  item.updatedAt = Date.now();
  await update(coll, {}, m => ({ ...m, [item.id]: item }));
  return item;
}
export async function putMany(coll, items) {
  const t = Date.now();
  await update(coll, {}, m => { const n = { ...m }; for (const it of items) { it.updatedAt = t; n[it.id] = it; } return n; });
}
export async function remove(coll, ids) {
  ids = [].concat(ids);
  const t = Date.now();
  await update(coll, {}, m => { const n = { ...m }; for (const id of ids) if (n[id]) n[id] = { id, deleted: true, updatedAt: t }; return n; });
}

export function domainOf(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.hostname.replace(/^www\./, '');
  } catch (e) { return null; }
}
export const matchesDomain = (domain, list) => !!domain && list.some(d => domain === d || domain.endsWith('.' + d));
