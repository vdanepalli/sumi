// App shell: Google sign-in gate, left navigation, view router.
import { $, $$, esc, toast, applyAccent, isTyping, h } from '../lib/ui.js';
import { urlsIn } from '../lib/dev.js';
import { getSettings } from '../lib/store.js';
import { account, signIn, continueLocally, configured, syncNow } from '../lib/sync.js';

const VIEWS = {
  collections: () => import('./views/collections.js'),
  later: () => import('./views/later.js'),
  videos: () => import('./views/videos.js'),
  sessions: () => import('./views/sessions.js'),
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
  if (name === 'plan' || name === 'shutdown') { // from the search: open the dialog over the new tab
    history.replaceState(null, '', '#collections');
    await route();
    const P = await import('./plan.js');
    return name === 'plan' ? P.openPlanner() : P.openShutdown();
  }
  const view = VIEWS[name] ? name : 'collections';
  $$('.rail a').forEach(a => a.classList.toggle('on', a.dataset.view === view));
  if (cleanup) { try { cleanup(); } catch (e) { /* ignore */ } cleanup = null; }
  const el = $('#view');
  el.innerHTML = '';
  el.className = `view v-${view}`;
  const mod = await VIEWS[view]();
  cleanup = await mod.mount(el) || null;
  if (view === 'collections' || view === 'focus') { // today's plan above the new tab and Focus
    const strip = document.createElement('div');
    strip.className = 'today-strip'; strip.hidden = true;
    const board = el.querySelector('.board-h'); // Collections: under the search bar of the middle column
    if (board) board.after(strip); else el.prepend(strip);
    (await import('./plan.js')).renderStrip(strip);
  }
}
window.addEventListener('hashchange', () => { if (!$('#app').hidden) route(); });

// ---------------- mini clock in the rail ----------------
function tick() {
  const d = new Date();
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !cfg.clock24 });
  $('#mini-clock').innerHTML = `<b>${t}</b><span>${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>`;
}

// due / overdue count on the Later nav item
async function laterBadge() {
  const { items } = await import('../lib/later.js');
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const n = (await items()).filter(i => i.status !== 'done' && i.due && i.due <= end.getTime()).length;
  $('#later-badge').hidden = !n;
  $('#later-badge').textContent = n;
}

async function start() {
  if (!(await gate())) return;
  tick();
  setInterval(tick, 1000 * 15);
  if (location.hash === '#welcome') location.hash = '#collections';
  await route();
  import('./plan.js').then(P => P.maybePlan());
  laterBadge();
  syncNow(false).catch(() => {});
}

// command palette: Ctrl+K / Cmd+K anywhere in the app
document.addEventListener('keydown', async e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !$('#app').hidden) {
    e.preventDefault();
    if ($('#pal-dlg')) return;
    const d = document.createElement('dialog');
    d.id = 'pal-dlg'; d.className = 'modal pal-dlg';
    document.body.appendChild(d);
    d.addEventListener('close', () => d.remove());
    d.addEventListener('click', ev => { if (ev.target === d) d.close(); });
    d.showModal();
    const { mountPalette } = await import('../lib/palette.js');
    mountPalette(d, { onDone: () => d.close() });
  }
});

// paste a list of links anywhere on the new tab (not in a text field): open them or save them
document.addEventListener('paste', async e => {
  if ($('#app').hidden || isTyping(e) || document.querySelector('dialog[open]')) return;
  const urls = urlsIn(e.clipboardData?.getData('text') || '');
  if (!urls.length) return;
  e.preventDefault();
  const d = h(`<dialog class="modal small"><form method="dialog"><h3>${urls.length} link${urls.length === 1 ? '' : 's'} pasted</h3>
    <ul class="paste-list">${urls.slice(0, 8).map(u => `<li>${esc(u)}</li>`).join('')}${urls.length > 8 ? `<li class="faint">…and ${urls.length - 8} more</li>` : ''}</ul>
    <div class="row end"><button value="cancel" class="ghost">Cancel</button><button value="save">Save as collection</button><button value="open" class="primary">Open ${urls.length > 1 ? 'all' : ''}</button></div></form></dialog>`);
  document.body.appendChild(d);
  d.addEventListener('close', async () => {
    const v = d.returnValue; d.remove();
    const C = await import('../lib/collections.js');
    if (v === 'open') await C.openCards(urls.map(url => ({ url })), { focus: false });
    if (v === 'save') {
      const sp = (await chrome.storage.local.get('lastSpace')).lastSpace;
      const spaces = await C.spaces();
      const col = await C.addCollection((spaces.find(s => s.id === sp) || spaces[0]).id, `Pasted ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}`);
      await C.addCards(col.id, urls.map(url => ({ url, title: url })));
      toast(`Saved ${urls.length} link${urls.length === 1 ? '' : 's'}`);
    }
  });
  d.showModal();
  d.querySelector('[value=open]').focus();
});

chrome.storage.onChanged.addListener(async (c, area) => {
  if (area !== 'local') return;
  if (c.settings) { cfg = await getSettings(); applyAccent(cfg.accent); }
  if (c.account) { if (await gate()) route(); }
  if (c.later) laterBadge();
  const strip = document.querySelector('.today-strip');
  if (strip && (c.plans || c.focusLog || c.settings)) (await import('./plan.js')).renderStrip(strip);
});
start();
