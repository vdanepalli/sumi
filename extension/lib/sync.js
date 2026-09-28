// Optional sync to the user's OWN Google Drive, in the hidden app-data folder
// (only this extension can see it; scope drive.appdata). No server of ours is
// involved. Settings already sync through chrome.storage.sync.
import { get, set, deviceId } from './store.js';

const FILE = 'sumi-data.json';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

export function configured() {
  const id = chrome.runtime.getManifest().oauth2?.client_id || '';
  return !!id && !id.startsWith('REPLACE_');
}

async function token(interactive) {
  const r = await chrome.identity.getAuthToken({ interactive });
  return typeof r === 'string' ? r : r?.token;
}

async function api(url, opts = {}, tok) {
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${tok}`, ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`Google Drive ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return res;
}

// merge two {id: item} collections by updatedAt (tombstones win if newer)
function mergeColl(a = {}, b = {}) {
  const out = { ...a };
  for (const [id, item] of Object.entries(b)) if (!out[id] || (item.updatedAt || 0) > (out[id].updatedAt || 0)) out[id] = item;
  return out;
}
// per-device maps: keep each device's own numbers, take the larger when both have one
function mergeDevices(a = {}, b = {}) {
  const out = JSON.parse(JSON.stringify(a));
  for (const [dev, days] of Object.entries(b)) {
    out[dev] = out[dev] || {};
    for (const [day, v] of Object.entries(days)) {
      const cur = out[dev][day];
      if (!cur) { out[dev][day] = v; continue; }
      if (typeof v === 'object') for (const [k, n] of Object.entries(v)) cur[k] = Math.max(cur[k] || 0, n);
    }
  }
  return out;
}

async function localSnapshot() {
  const dev = await deviceId();
  return {
    version: 1,
    vocab: await get('vocab', {}),
    sessions: await get('sessions', {}),
    usage: { ...(await get('remoteUsage', {})), [dev]: await get('usage', {}) },
    focus: { ...(await get('remoteFocus', {})), [dev]: await get('focusLog', {}) }
  };
}

export async function syncNow(interactive = false) {
  if (!configured()) throw new Error('Drive sync is not set up in this build (see README: OAuth client ID).');
  const tok = await token(interactive);
  if (!tok) throw new Error('Not signed in');
  const q = encodeURIComponent(`name='${FILE}'`);
  const found = await (await api(`${DRIVE}?spaces=appDataFolder&q=${q}&fields=files(id)`, {}, tok)).json();
  const fileId = found.files?.[0]?.id;
  const remote = fileId ? await (await api(`${DRIVE}/${fileId}?alt=media`, {}, tok)).json() : {};
  const local = await localSnapshot();
  const merged = {
    version: 1,
    vocab: mergeColl(local.vocab, remote.vocab),
    sessions: mergeColl(local.sessions, remote.sessions),
    usage: mergeDevices(local.usage, remote.usage),
    focus: mergeDevices(local.focus, remote.focus),
    savedAt: Date.now()
  };
  const dev = await deviceId();
  await set('vocab', merged.vocab);
  await set('sessions', merged.sessions);
  const { [dev]: _u, ...otherUsage } = merged.usage;
  const { [dev]: _f, ...otherFocus } = merged.focus;
  await set('remoteUsage', otherUsage);
  await set('remoteFocus', otherFocus);

  const body = JSON.stringify(merged);
  if (fileId) {
    await api(`${UPLOAD}/${fileId}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }, tok);
  } else {
    const boundary = 'sumi' + Date.now();
    const meta = JSON.stringify({ name: FILE, parents: ['appDataFolder'] });
    const multipart = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
    await api(`${UPLOAD}?uploadType=multipart`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart }, tok);
  }
  await set('lastSync', Date.now());
  return merged;
}

export async function signOut() {
  const tok = await token(false).catch(() => null);
  if (tok) {
    await chrome.identity.removeCachedAuthToken({ token: tok });
    fetch(`https://accounts.google.com/o/oauth2/revoke?token=${tok}`).catch(() => {});
  }
  await set('syncEnabled', false);
}

// full local export / import (works without any sign-in)
export async function exportAll() {
  const local = await chrome.storage.local.get(null);
  const { settings } = await chrome.storage.sync.get('settings');
  return { app: 'sumi', exported: new Date().toISOString(), settings, local };
}
export async function importAll(data) {
  if (data.app !== 'sumi') throw new Error('Not a Sumi backup file');
  if (data.settings) await chrome.storage.sync.set({ settings: data.settings });
  if (data.local) await chrome.storage.local.set(data.local);
}
