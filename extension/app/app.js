// App shell: Google sign-in gate, left navigation, view router.
import { $, $$, esc, toast, applyAccent } from '../lib/ui.js';
import { getSettings } from '../lib/store.js';
import { account, signIn, continueLocally, configured, syncNow } from '../lib/sync.js';

const VIEWS = {
  collections: () => import('./views/collections.js'),
  focus: () => import('./views/focus.js'),
  insights: () => import('./views/insights.js'),
  tasks: () => import('./views/tasks.js'),
  settings: () => import('./views/settings.js')
};
let cleanup = null;
let cfg = await getSettings();
applyAccent(cfg.accent);

// ---------------- sign-in gate ----------------
async function gate() {
  const acc = await account();
  $('#welcome').hidden = !!acc;
  $('#app').hidden = !acc;
  if (!acc) {
    $('#local').hidden = configured();
    if (!configured()) $('#signin-note').textContent = 'This developer build has no Google OAuth client ID yet (README → Google sign-in). You can still try Sumi with data kept on this device.';
    return false;
  }
  $('#acct').innerHTML = acc.local
    ? '<span class="chip warn" title="Data is only on this device">Local only</span>'
    : `${acc.photo ? `<img src="${esc(acc.photo)}" alt="">` : ''}<span title="${esc(acc.email)}">${esc(acc.name || acc.email)}</span>`;
  return true;
}
$('#signin').onclick = async () => {
  $('#signin').disabled = true;
  $('#signin').textContent = 'Signing in…';
  try { await signIn(); toast('Signed in - your data syncs to your Google Drive'); start(); }
  catch (e) { toast(e.message); }
  $('#signin').disabled = false;
  $('#signin').textContent = 'Sign in with Google';
};
$('#local').onclick = async () => { await continueLocally(); start(); };

// ---------------- router ----------------
async function route() {
  const name = (location.hash.slice(1) || 'collections').split('?')[0];
  const view = VIEWS[name] ? name : 'collections';
  $$('.rail a').forEach(a => a.classList.toggle('on', a.dataset.view === view));
  if (cleanup) { try { cleanup(); } catch (e) { /* ignore */ } cleanup = null; }
  const el = $('#view');
  el.innerHTML = '';
  el.className = `view v-${view}`;
  const mod = await VIEWS[view]();
  cleanup = await mod.mount(el) || null;
}
window.addEventListener('hashchange', () => { if (!$('#app').hidden) route(); });

// ---------------- mini clock in the rail ----------------
function tick() {
  const d = new Date();
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !cfg.clock24 });
  $('#mini-clock').innerHTML = `<b>${t}</b><span>${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>`;
}

async function start() {
  if (!(await gate())) return;
  tick();
  setInterval(tick, 1000 * 15);
  if (location.hash === '#welcome') location.hash = '#collections';
  await route();
  syncNow(false).catch(() => {});
}

chrome.storage.onChanged.addListener(async (c, area) => {
  if (area !== 'local') return;
  if (c.settings) { cfg = await getSettings(); applyAccent(cfg.accent); }
  if (c.account) { if (await gate()) route(); }
});
start();
