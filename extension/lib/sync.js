// Google account sign-in and sync to the user's OWN Google Drive (hidden app-data
// folder, scope drive.appdata: only Sumi can see it, and it cannot see any other
// Drive file). No server of ours is involved.
import { get, set, deviceId } from './store.js';
import { WEB_CLIENT_ID } from './config.js';

const FILE = 'sumi-data.json';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

// record collections merged item by item
export const RECORDS = ['spaces', 'collections', 'cards', 'tasks', 'later', 'videos', 'plans'];
// per-device day maps merged by device
const DEVICE_MAPS = { usage: 'usage', focusLog: 'focusLog', stopwatchLog: 'stopwatchLog', projectLog: 'projectLog', devUsage: 'devUsage' };

// ---------------- auth ----------------
// Fast path: chrome.identity.getAuthToken (Chrome Extension client in manifest oauth2).
// It only fully works in Google Chrome; elsewhere Google rejects it ("Custom URI scheme
// is not supported on Chrome apps"), so we fall back to launchWebAuthFlow with a
// "Web application" client (lib/config.js). The method that worked is remembered
// (authMethod) so background sync uses it non-interactively.
const chromeClient = () => { const id = chrome.runtime.getManifest().oauth2?.client_id || ''; return id && !id.startsWith('REPLACE_') ? id : ''; };
const webClient = () => (WEB_CLIENT_ID || '').trim();
export const configured = () => !!(chromeClient() || webClient());

// a hint only: browsers without the "Google Chrome" brand skip straight to the web flow
const looksLikeChrome = () => { const b = navigator.userAgentData?.brands; return !b || b.some(x => x.brand === 'Google Chrome'); };
const CANCELLED = /did not approve|cancel|closed/i;
const NO_WEB = 'Google sign-in through Chrome\'s account isn\'t available in this browser, and this Sumi build has no web sign-in client yet. Please use Google Chrome for now.';
const RENEW = 'Google sign-in needs renewing - open Sumi Settings and click Sync now';
const tokenArea = () => chrome.storage.session || chrome.storage.local;

async function chromeToken(interactive) {
  if (typeof chrome.identity.getAuthToken !== 'function') throw new Error('getAuthToken unsupported');
  const r = await chrome.identity.getAuthToken({ interactive });
  const t = typeof r === 'string' ? r : r?.token;
  if (!t) throw new Error('No token');
  return t;
}

async function launch(url, interactive) {
  const opts = { url, interactive };
  // let Google's (JS) redirect run in the hidden silent-refresh page
  if (!interactive) Object.assign(opts, { abortOnLoadForNonInteractive: false, timeoutMsForNonInteractive: 15000 });
  try { return await chrome.identity.launchWebAuthFlow(opts); }
  catch (e) { if (interactive || !/unexpected property/i.test(e.message)) throw e; return chrome.identity.launchWebAuthFlow({ url, interactive }); } // older browsers
}

async function webToken(interactive) {
  const { webToken: c } = await tokenArea().get('webToken');
  if (c?.token && c.exp > Date.now() + 60000) return c.token;
  if (!webClient()) throw new Error(NO_WEB);
  const acc = await get('account', null);
  const state = crypto.randomUUID();
  const p = new URLSearchParams({ client_id: webClient(), response_type: 'token', redirect_uri: chrome.identity.getRedirectURL(), scope: SCOPE, state });
  if (acc?.email) p.set('login_hint', acc.email);
  if (!interactive) p.set('prompt', 'none');
  else if (!acc?.email) p.set('prompt', 'select_account');
  let res;
  try { res = await launch('https://accounts.google.com/o/oauth2/v2/auth?' + p, interactive); }
  catch (e) { throw new Error(interactive ? `Google sign-in failed: ${e.message}` : RENEW); }
  const u = new URL(res);
  const h = new URLSearchParams(u.hash.slice(1) || u.search.slice(1));
  if (h.get('state') !== state) throw new Error('Google sign-in failed (bad state) - please try again');
  if (h.get('error')) throw new Error(interactive ? `Google sign-in failed: ${h.get('error')}` : RENEW);
  const token = h.get('access_token');
  if (!token) throw new Error('Google sign-in returned no token');
  if (h.get('scope') && !h.get('scope').split(' ').includes(SCOPE)) throw new Error('Sumi needs access to its private Drive folder - sign in again and allow it');
  await tokenArea().set({ webToken: { token, exp: Date.now() + (Number(h.get('expires_in')) || 3600) * 1000 } });
  return token;
}

async function token(interactive) {
  const method = await get('authMethod', null);
  let err = null;
  if (method !== 'web' && chromeClient() && (method === 'chrome' || looksLikeChrome() || !webClient())) {
    try {
      const t = await chromeToken(interactive);
      if (method !== 'chrome') await set('authMethod', 'chrome');
      return t;
    } catch (e) {
      err = e;
      // getAuthToken is proven to work here: this is a real cancel / revoked grant, not an unsupported browser
      if (method === 'chrome' && (!interactive || CANCELLED.test(e.message))) throw interactive ? e : new Error(RENEW);
    }
  }
  if (!webClient()) throw err ? new Error(interactive ? `${err.message}. ${NO_WEB}` : RENEW) : new Error(NO_WEB);
  const t = await webToken(interactive);
  if (method !== 'web') await set('authMethod', 'web');
  return t;
}

async function dropToken(t) {
  try { await chrome.identity.removeCachedAuthToken({ token: t }); } catch (e) { /* not a Chrome token */ }
  const { webToken: c } = await tokenArea().get('webToken');
  if (c?.token === t) await tokenArea().remove('webToken');
}

// auth = { tok }: on 401 the cached token is dropped, refreshed silently and the call retried once
async function api(url, opts = {}, auth) {
  const call = () => fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${auth.tok}` } });
  let res = await call();
  if (res.status === 401) {
    await dropToken(auth.tok);
    auth.tok = await token(false);
    res = await call();
  }
  if (!res.ok) throw new Error(`Google Drive ${res.status}: ${(await res.text()).slice(0, 140)}`);
  return res;
}

// ---------------- account ----------------
export const account = () => get('account', null);

export async function signIn() {
  if (!configured()) throw new Error('This build has no Google OAuth client ID yet (see README → Google sign-in).');
  const auth = { tok: await token(true) };
  const about = await (await api(`${DRIVE}/about?fields=user(displayName,emailAddress,photoLink)`, {}, auth)).json();
  const acc = { email: about.user?.emailAddress || '', name: about.user?.displayName || '', photo: about.user?.photoLink || '', since: Date.now() };
  await set('account', acc);
  await syncNow(false).catch(() => {}); // signed in either way; the error shows in Settings and sync retries
  return acc;
}

// developer builds without an OAuth client: keep data on this device only
export async function continueLocally() {
  const acc = { local: true, name: 'Local only', since: Date.now() };
  await set('account', acc);
  return acc;
}

// clears and revokes both kinds of token (Chrome's identity cache and the web-flow token)
export async function signOut() {
  const toks = [];
  if (chromeClient()) {
    const t = await chromeToken(false).catch(() => null);
    if (t) { toks.push(t); await chrome.identity.removeCachedAuthToken({ token: t }).catch(() => {}); }
  }
  try { await chrome.identity.clearAllCachedAuthTokens?.(); } catch (e) { /* older browsers */ }
  const { webToken: c } = await tokenArea().get('webToken');
  if (c?.token) toks.push(c.token);
  await tokenArea().remove('webToken');
  for (const t of toks) fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'token=' + encodeURIComponent(t) }).catch(() => {});
  await chrome.storage.local.remove(['authMethod', 'syncError']);
  await set('account', null);
}

// ---------------- merge ----------------
function mergeRecords(a = {}, b = {}) {
  const out = { ...a };
  for (const [id, item] of Object.entries(b)) if (!out[id] || (item.updatedAt || 0) > (out[id].updatedAt || 0)) out[id] = item;
  return out;
}
// { device: { day: {...numbers} | [...] } } - every device only ever grows its own entries
// this device's own map is authoritative (deleting a site's history must not be undone by the remote copy)
function mergeDevices(a = {}, b = {}, self) {
  const out = JSON.parse(JSON.stringify(a));
  for (const [dev, days] of Object.entries(b)) {
    if (dev === self) continue;
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
  if (!syncing) syncing = runSync(interactive).finally(() => { syncing = null; });
  return syncing;
}
// one sync at a time across the service worker and open pages; the last error is kept for Settings
async function runSync(interactive) {
  const job = () => doSync(interactive);
  try {
    const r = await (navigator.locks ? navigator.locks.request('sumi-sync', job) : job());
    if (r) await set('syncError', null);
    return r;
  } catch (e) { await set('syncError', { message: e.message, at: Date.now() }); throw e; }
}

async function doSync(interactive) {
  const acc = await account();
  if (!acc || acc.local || !configured()) return null;
  const tok = { tok: await token(interactive) };
  const q = encodeURIComponent(`name='${FILE}'`);
  const found = await (await api(`${DRIVE}/files?spaces=appDataFolder&q=${q}&fields=files(id)`, {}, tok)).json();
  const fileId = found.files?.[0]?.id;
  const remote = fileId ? await (await api(`${DRIVE}/files/${fileId}?alt=media`, {}, tok)).json() : {};
  if ((remote.resetAt || 0) > (await get('resetAt', 0))) await wipeLocal(remote.resetAt); // "delete everything" on another computer
  const local = await snapshot();
  const merged = { version: 2, savedAt: Date.now(), resetAt: Math.max(remote.resetAt || 0, await get('resetAt', 0)) || undefined, settings: newer(local.settings, remote.settings) };
  for (const k of RECORDS) merged[k] = mergeRecords(local[k], remote[k]);
  const dev = await deviceId();
  for (const k of Object.keys(DEVICE_MAPS)) merged[k] = mergeDevices(local[k], remote[k], dev);

  // write back locally
  if (merged.settings) await set('settings', merged.settings);
  for (const k of RECORDS) await set(k, merged[k]);
  for (const k of Object.keys(DEVICE_MAPS)) {
    const { [dev]: mine, ...others } = merged[k];
    await set('remote_' + k, others);
  }

  await upload(tok, fileId, JSON.stringify(merged));
  await set('lastSync', Date.now());
  return merged;
}

// write the sync file: replace it, or create it in the app-data folder
async function upload(tok, fileId, body) {
  if (fileId) return api(`${UPLOAD}/${fileId}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }, tok);
  const b = 'sumi' + Date.now();
  const meta = JSON.stringify({ name: FILE, parents: ['appDataFolder'] });
  return api(`${UPLOAD}?uploadType=multipart`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` },
    body: `--${b}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`
  }, tok);
}

// ---------------- delete everything (factory reset) ----------------
// Everything Sumi keeps on this computer goes; you stay signed in. With `everywhere`, the
// Drive file is replaced by an empty one carrying the reset time, and every other computer
// wipes itself when it next syncs (instead of merging its old copy back in).
const KEEP = ['account', 'authMethod', 'deviceId'];
async function wipeLocal(resetAt) {
  const keep = await chrome.storage.local.get(KEEP);
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ ...keep, resetAt });
  await chrome.storage.session.clear().catch(() => {});
  for (const a of await chrome.alarms.getAll()) if (/^(later:|snooze:|timer-end|badge|intent-end|sync-soon)/.test(a.name)) await chrome.alarms.clear(a.name);
  chrome.action.setBadgeText({ text: '' }).catch(() => {});
}
export async function factoryReset({ everywhere = true } = {}) {
  const resetAt = Date.now();
  const job = async () => {
    const acc = await account();
    if (everywhere && acc && !acc.local && configured()) {
      const tok = { tok: await token(true) };
      const q = encodeURIComponent(`name='${FILE}' and trashed=false`);
      const files = (await (await api(`${DRIVE}/files?spaces=appDataFolder&q=${q}&fields=files(id)`, {}, tok)).json()).files || [];
      const body = JSON.stringify({ version: 2, savedAt: resetAt, resetAt });
      if (!files.length) await upload(tok, null, body);
      for (const f of files) await upload(tok, f.id, body);
    }
    await wipeLocal(resetAt);
  };
  return navigator.locks ? navigator.locks.request('sumi-sync', job) : job(); // never alongside a sync
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
