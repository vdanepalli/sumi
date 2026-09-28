// Storage helpers. Settings live in chrome.storage.sync (follows the user's Chrome
// sign-in); everything else is local and can sync to the user's own Google Drive
// (see sync.js). Nothing is sent anywhere else.

export const DEFAULT_SETTINGS = {
  focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4,
  autoStartBreak: true, autoStartFocus: false,
  blockDuringFocus: true,
  blocked: ['youtube.com', 'x.com', 'twitter.com', 'reddit.com', 'instagram.com', 'facebook.com', 'tiktok.com'],
  dailyGoalMin: 100,            // focus minutes a day
  trackUsage: true, idleSec: 60, excluded: [],
  clock24: false, showSeconds: true,
  accent: '#8ab4f8',
  staleDays: 3,
  sound: true
};

export const uid = () => crypto.randomUUID();
export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return dayKey(d); };

export async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}
export async function setSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.sync.set({ settings: next });
  return next;
}
export async function resetSettings() { await chrome.storage.sync.remove('settings'); return getSettings(); }

export async function get(key, fallback) {
  const r = await chrome.storage.local.get(key);
  return r[key] ?? fallback;
}
export async function set(key, value) { await chrome.storage.local.set({ [key]: value }); }
// read-modify-write on one key
export async function update(key, fallback, fn) {
  const next = await fn(await get(key, fallback));
  await set(key, next);
  return next;
}

export async function deviceId() {
  let id = await get('deviceId');
  if (!id) { id = uid().slice(0, 8); await set('deviceId', id); }
  return id;
}

// collections: { id: {..., updatedAt, deleted?} } - deletions are kept as tombstones so sync can merge
export async function list(coll) {
  const all = await get(coll, {});
  return Object.values(all).filter(x => !x.deleted);
}
export async function put(coll, item) {
  item.updatedAt = Date.now();
  await update(coll, {}, all => ({ ...all, [item.id]: item }));
  return item;
}
export async function remove(coll, id) {
  await update(coll, {}, all => (all[id] ? { ...all, [id]: { id, deleted: true, updatedAt: Date.now() } } : all));
}

export function domainOf(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.hostname.replace(/^www\./, '');
  } catch (e) { return null; }
}
export const matchesDomain = (domain, list) => !!domain && list.some(d => domain === d || domain.endsWith('.' + d));
