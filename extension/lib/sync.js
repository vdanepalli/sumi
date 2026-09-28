// Google account sign-in and sync to the user's OWN Google Drive (hidden app-data
// folder, scope drive.appdata: only Sumi can see it, and it cannot see any other
// Drive file). No server of ours is involved.
import { get, set, deviceId } from './store.js';

const FILE = 'sumi-data.json';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

// record collections merged item by item
export const RECORDS = ['spaces', 'collections', 'cards', 'tasks', 'later'];
// per-device day maps merged by device
const DEVICE_MAPS = { usage: 'usage', focusLog: 'focusLog', stopwatchLog: 'stopwatchLog', projectLog: 'projectLog' };

export function configured() {
  const id = chrome.runtime.getManifest().oauth2?.client_id || '';
  return !!id && !id.startsWith('REPLACE_');
}

async function token(interactive) {
  const r = await chrome.identity.getAuthToken({ interactive });
  return typeof r === 'string' ? r : r?.token;
}
async function api(url, opts = {}, tok) {
  let res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${tok}`, ...(opts.headers || {}) } });
  if (res.status === 401) { // expired token: drop it and retry once
    await chrome.identity.removeCachedAuthToken({ token: tok });
    tok = await token(false);
    res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${tok}`, ...(opts.headers || {}) } });
  }
  if (!res.ok) throw new Error(`Google Drive ${res.status}: ${(await res.text()).slice(0, 140)}`);
  return res;
}

// ---------------- account ----------------
export const account = () => get('account', null);

export async function signIn() {
  if (!configured()) throw new Error('This build has no Google OAuth client ID yet (see README → Google sign-in).');
  const tok = await token(true);
  if (!tok) throw new Error('Sign-in was cancelled');
  const about = await (await api(`${DRIVE}/about?fields=user(displayName,emailAddress,photoLink)`, {}, tok)).json();
  const acc = { email: about.user?.emailAddress || '', name: about.user?.displayName || '', photo: about.user?.photoLink || '', since: Date.now() };
  await set('account', acc);
  await syncNow(false);
  return acc;
}

// developer builds without an OAuth client: keep data on this device only
export async function continueLocally() {
  const acc = { local: true, name: 'Local only', since: Date.now() };
  await set('account', acc);
  return acc;
}

export async function signOut() {
  const tok = await token(false).catch(() => null);
  if (tok) {
    await chrome.identity.removeCachedAuthToken({ token: tok });
    fetch(`https://accounts.google.com/o/oauth2/revoke?token=${tok}`).catch(() => {});
  }
  await set('account', null);
}

// ---------------- merge ----------------
function mergeRecords(a = {}, b = {}) {
  const out = { ...a };
  for (const [id, item] of Object.entries(b)) if (!out[id] || (item.updatedAt || 0) > (out[id].updatedAt || 0)) out[id] = item;
  return out;
}
// { device: { day: {...numbers} | [...] } } - every device only ever grows its own entries
function mergeDevices(a = {}, b = {}) {
  const out = JSON.parse(JSON.stringify(a));
  for (const [dev, days] of Object.entries(b)) {
    out[dev] = out[dev] || {};
    for (const [day, v] of Object.entries(days)) {
      const cur = out[dev][day];
      if (cur === undefined) out[dev][day] = v;
      else if (Array.isArray(v)) out[dev][day] = v.length > cur.length ? v : cur;
      else if (typeof v === 'object') for (const [k, n] of Object.entries(v)) cur[k] = typeof n === 'object' ? ((cur[k]?.minutes || 0) >= (n?.minutes || 0) ? cur[k] : n) : Math.max(cur[k] || 0, n);
    }
  }
  return out;
}
const newer = (a, b) => ((b?.updatedAt || 0) > (a?.updatedAt || 0) ? b : a);

async function snapshot() {
  const dev = await deviceId();
  const s = { version: 2, settings: await get('settings', null) };
  for (const k of RECORDS) s[k] = await get(k, {});
  for (const k of Object.keys(DEVICE_MAPS)) s[k] = { ...(await get('remote_' + k, {})), [dev]: await get(k, {}) };
  return s;
}

let syncing = null;
export function syncNow(interactive = false) {
  if (!syncing) syncing = doSync(interactive).finally(() => { syncing = null; });
  return syncing;
}

async function doSync(interactive) {
  const acc = await account();
  if (!acc || acc.local || !configured()) return null;
  const tok = await token(interactive);
  if (!tok) throw new Error('Not signed in');
  const q = encodeURIComponent(`name='${FILE}'`);
  const found = await (await api(`${DRIVE}/files?spaces=appDataFolder&q=${q}&fields=files(id)`, {}, tok)).json();
  const fileId = found.files?.[0]?.id;
  const remote = fileId ? await (await api(`${DRIVE}/files/${fileId}?alt=media`, {}, tok)).json() : {};
  const local = await snapshot();
  const merged = { version: 2, savedAt: Date.now(), settings: newer(local.settings, remote.settings) };
  for (const k of RECORDS) merged[k] = mergeRecords(local[k], remote[k]);
  for (const k of Object.keys(DEVICE_MAPS)) merged[k] = mergeDevices(local[k], remote[k]);

  // write back locally
  const dev = await deviceId();
  if (merged.settings) await set('settings', merged.settings);
  for (const k of RECORDS) await set(k, merged[k]);
  for (const k of Object.keys(DEVICE_MAPS)) {
    const { [dev]: mine, ...others } = merged[k];
    await set('remote_' + k, others);
  }

  const body = JSON.stringify(merged);
  if (fileId) {
    await api(`${UPLOAD}/${fileId}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }, tok);
  } else {
    const b = 'sumi' + Date.now();
    const meta = JSON.stringify({ name: FILE, parents: ['appDataFolder'] });
    await api(`${UPLOAD}?uploadType=multipart`, {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` },
      body: `--${b}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`
    }, tok);
  }
  await set('lastSync', Date.now());
  return merged;
}

// merged per-device maps (this device + others) for Insights
export async function allDevices(key) {
  const dev = await deviceId();
  return { ...(await get('remote_' + key, {})), [dev]: await get(key, {}) };
}

// ---------------- backup file ----------------
export async function exportAll() { return { app: 'sumi', exported: new Date().toISOString(), data: await chrome.storage.local.get(null) }; }
export async function importAll(file) {
  if (file.app !== 'sumi' || !file.data) throw new Error('Not a Sumi backup file');
  const { account: _a, deviceId: _d, ...rest } = file.data; // keep this device's identity
  await chrome.storage.local.set(rest);
}
