import { $, $$, esc, toast, mmss, dur, favicon, send, applyAccent, defHtml, wireAudio } from '../lib/ui.js';
import { getSettings, setSettings, resetSettings, get, set, list, remove, put, dayKey, daysAgo, domainOf } from '../lib/store.js';
import { leftMs, modeLabel } from '../lib/timer.js';
import * as Tabs from '../lib/tabs.js';
import * as Dict from '../lib/dict.js';
import { exportAll, importAll, signOut, configured } from '../lib/sync.js';

let cfg = await getSettings();
applyAccent(cfg.accent);

// ================= clock =================
function tickClock() {
  const d = new Date();
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  let suffix = '';
  if (!cfg.clock24) { suffix = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; }
  $('#time').innerHTML = `${h}:${m}${cfg.showSeconds ? `<small class="sec">${s}</small>` : ''}${suffix ? `<small class="ap">${suffix}</small>` : ''}`;
  $('#date').textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const hr = d.getHours();
  $('#greeting').textContent = hr < 5 ? 'Burning the midnight oil' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
}
tickClock();
setInterval(tickClock, 1000);

// ================= focus timer =================
let timer = await get('timer', null) || (await send({ type: 'timer', action: 'state' })).data;
const CIRC = 2 * Math.PI * 52;
function renderTimer() {
  if (!timer) return;
  const left = leftMs(timer);
  $('#left').textContent = mmss(left);
  $('#mode').textContent = modeLabel(timer.mode);
  $('#t-toggle').textContent = timer.running ? 'Pause' : left < timer.total ? 'Resume' : 'Start';
  $('#ring').style.strokeDashoffset = String(CIRC * (1 - (timer.total ? (timer.total - left) / timer.total : 0)));
  $('#focus').classList.toggle('break', timer.mode !== 'focus');
  $$('.modes button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === timer.mode)));
  $('#cycle').textContent = timer.cycle ? `${timer.cycle} done this round` : '';
  document.title = timer.running ? `${mmss(left)} · ${modeLabel(timer.mode)}` : 'New Tab';
}
renderTimer();
setInterval(renderTimer, 1000);
const act = action => send({ type: 'timer', action }).then(r => { if (r.ok) { timer = r.data; renderTimer(); } });
$('#t-toggle').onclick = () => act('toggle');
$('#t-reset').onclick = () => act('reset');
$('#t-skip').onclick = () => act('skip');
$$('.modes button').forEach(b => { b.onclick = () => send({ type: 'timer', action: 'reset', mode: b.dataset.mode }).then(r => { timer = r.data; renderTimer(); }); });

async function renderFocusStats() {
  const log = await get('focusLog', {});
  const today = log[dayKey()] || { count: 0, minutes: 0 };
  $('#goal-text').textContent = `${today.minutes} / ${cfg.dailyGoalMin} min · ${today.count} session${today.count === 1 ? '' : 's'}`;
  $('#goal-bar').style.width = `${Math.min(100, (100 * today.minutes) / cfg.dailyGoalMin)}%`;
  const days = [...Array(7)].map((_, i) => daysAgo(6 - i));
  const max = Math.max(cfg.dailyGoalMin, ...days.map(d => log[d]?.minutes || 0));
  $('#focus-week').innerHTML = days.map(d => {
    const mins = log[d]?.minutes || 0;
    const label = new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'narrow' });
    return `<div class="${d === dayKey() ? 'today' : ''}" title="${d}: ${mins} min"><i class="${mins >= cfg.dailyGoalMin ? 'on' : ''}" style="height:${Math.max(3, (40 * mins) / max)}px"></i>${label}</div>`;
  }).join('');
  // streak: consecutive days meeting at least one focus session
  let streak = 0;
  for (let i = log[dayKey()]?.count ? 0 : 1; ; i += 1) { if (log[daysAgo(i)]?.count) streak += 1; else break; }
  $('#streak').innerHTML = streak ? `<span class="chip">🔥 <b>${streak}</b> day focus streak</span>` : '<span class="chip">Start a focus session to begin a streak</span>';
}
renderFocusStats();

// ================= usage =================
let range = 1;
async function renderUsage() {
  await send({ type: 'flush' });
  const usage = await get('usage', {});
  const remote = await get('remoteUsage', {});
  const days = [...Array(range)].map((_, i) => daysAgo(i));
  const totals = {};
  const addDay = src => { for (const d of days) for (const [dom, s] of Object.entries(src[d] || {})) totals[dom] = (totals[dom] || 0) + s; };
  addDay(usage);
  Object.values(remote).forEach(addDay);
  const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((a, r) => a + r[1], 0);
  $('#usage-total').textContent = dur(total);
  $('#usage-sub').textContent = `${range === 1 ? 'today' : 'last 7 days'} across ${rows.length} site${rows.length === 1 ? '' : 's'}${Object.keys(remote).length ? ' · all devices' : ''}`;
  const max = rows[0]?.[1] || 1;
  $('#usage-list').innerHTML = rows.slice(0, 9).map(([d, s]) =>
    `<li title="${esc(d)}"><img src="${favicon(d)}" alt=""><span class="t">${esc(d)}</span><div class="bar"><i style="width:${(100 * s) / max}%"></i></div><span class="v">${dur(s)}</span></li>`
  ).join('') || '<li class="muted">Nothing tracked yet - browse a little.</li>';
  const week = [...Array(7)].map((_, i) => daysAgo(6 - i));
  const perDay = week.map(d => [usage, ...Object.values(remote)].reduce((a, src) => a + Object.values(src[d] || {}).reduce((x, y) => x + y, 0), 0));
  const wmax = Math.max(...perDay, 1);
  $('#usage-week').innerHTML = week.map((d, i) => `<div title="${d}: ${dur(perDay[i])}"><i style="height:${(56 * perDay[i]) / wmax}px"></i>${new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' })}</div>`).join('');
}
$$('.seg').forEach(b => { b.onclick = () => { range = Number(b.dataset.range); $$('.seg').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderUsage(); }; });
renderUsage();
setInterval(renderUsage, 60000);

// ================= tabs =================
async function renderTabs() {
  const o = await Tabs.overview();
  $('#tab-stats').textContent = `${o.count} tabs · ${o.windows} window${o.windows === 1 ? '' : 's'}${o.asleep ? ` · ${o.asleep} asleep` : ''}`;
  $('#n-dupes').textContent = o.dupes || '';
  $('#n-stale').textContent = o.stale || '';
  $('#top-domains').innerHTML = o.top.map(([d, n]) => `<span class="chip" data-close="${esc(d)}" title="Close all ${n} ${esc(d)} tabs"><img class="fav" src="${favicon(d)}" alt=""><b>${n}</b> ${esc(d)} ✕</span>`).join('');
  await renderTabResults();
  await renderSessions();
}
async function renderTabResults() {
  const tabs = await Tabs.search($('#tab-q').value);
  const self = (await chrome.tabs.getCurrent())?.id;
  $('#tab-results').innerHTML = tabs.filter(t => t.id !== self).map(t =>
    `<li data-id="${t.id}" data-win="${t.windowId}"><img src="${esc(t.favIconUrl || favicon(t.url))}" alt="" onerror="this.style.visibility='hidden'"><span class="t">${esc(t.title || t.url)}</span><span class="d">${esc(domainOf(t.url) || '')}</span>${t.discarded ? '<span class="chip">zz</span>' : ''}<button class="ghost x" data-x="${t.id}" title="Close">✕</button></li>`
  ).join('') || '<li class="muted">No matching tabs</li>';
}
$('#tab-q').addEventListener('input', renderTabResults);
$('#tab-q').addEventListener('keydown', async e => {
  if (e.key === 'Enter') { const li = $('#tab-results li[data-id]'); if (li) li.click(); }
});
$('#tab-results').addEventListener('click', async e => {
  const x = e.target.closest('[data-x]');
  if (x) { await chrome.tabs.remove(Number(x.dataset.x)); return renderTabs(); }
  const li = e.target.closest('li[data-id]');
  if (li) Tabs.focusTab({ id: Number(li.dataset.id), windowId: Number(li.dataset.win) });
});
$('#top-domains').addEventListener('click', async e => {
  const c = e.target.closest('[data-close]');
  if (c && confirm(`Close all ${c.dataset.close} tabs?`)) { toast(`Closed ${await Tabs.closeDomain(c.dataset.close)} tabs`); renderTabs(); }
});
$('.actions').addEventListener('click', async e => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const a = b.dataset.act;
  if (a === 'dupes') toast(`Closed ${await Tabs.closeDuplicates()} duplicate tabs`);
  if (a === 'group') toast(`Made ${await Tabs.groupByDomain()} groups`);
  if (a === 'ungroup') toast(`Ungrouped ${await Tabs.ungroupAll()} tabs`);
  if (a === 'sort') toast(`Sorted ${await Tabs.sortByDomain()} tabs`);
  if (a === 'sleep') toast(`Put ${await Tabs.sleepInactive()} tabs to sleep`);
  if (a === 'stale') {
    const n = (await Tabs.staleTabs()).length;
    if (!n) toast(`No tabs older than ${cfg.staleDays} days`);
    else if (confirm(`Close ${n} tabs not opened in ${cfg.staleDays}+ days? They are saved as a session first.`)) toast(`Closed ${await Tabs.closeStale()} stale tabs (saved)`);
  }
  if (a === 'merge') toast(`Moved ${await Tabs.mergeWindows()} tabs into this window`);
  if (a === 'save') {
    const name = prompt('Name this session', `Window ${new Date().toLocaleString()}`);
    if (name !== null) toast((await Tabs.saveSession(name)) ? 'Session saved' : 'Nothing to save');
  }
  renderTabs();
});
async function renderSessions() {
  const ss = await Tabs.sessions();
  $('#sessions').innerHTML = ss.map(s =>
    `<li data-s="${s.id}"><span class="t">${esc(s.name)}</span><span class="n">${s.tabs.length} tabs</span>
      <button class="ghost small" data-open="${s.id}" title="Open in a new window">Open</button><button class="ghost small" data-del="${s.id}" title="Delete">✕</button></li>`
  ).join('') || '<li class="muted small">Save a window to keep a set of tabs for later.</li>';
  $('#sessions').onclick = async e => {
    const o = e.target.closest('[data-open]'); const d = e.target.closest('[data-del]');
    if (o) await Tabs.restoreSession(ss.find(s => s.id === o.dataset.open));
    if (d && confirm('Delete this saved session?')) { await Tabs.deleteSession(d.dataset.del); renderSessions(); }
  };
}
chrome.tabs.onCreated.addListener(() => renderTabs());
chrome.tabs.onRemoved.addListener(() => renderTabs());
renderTabs();

// ================= vocabulary =================
wireAudio(document.body);
let lastLookup = null;
$('#lookup-form').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('#lookup-q').value.trim();
  if (!q) return;
  $('#lookup-out').innerHTML = '<div class="muted small">Looking up…</div>';
  try {
    lastLookup = await Dict.lookup(q);
    const saved = await Dict.findTerm(q);
    $('#lookup-out').innerHTML = defHtml(lastLookup, {
      actions: `<button class="small" id="save-word">${saved ? 'Saved ✓ (again)' : 'Save'}</button><button class="small ghost" id="save-idiom">as idiom</button>`,
      missing: 'Save it anyway and add your own meaning.'
    });
    $('#save-word').onclick = () => saveLookup();
    $('#save-idiom').onclick = () => saveLookup('idiom');
  } catch (err) {
    $('#lookup-out').innerHTML = `<div class="muted small">${esc(err.message)}</div>`;
  }
});
async function saveLookup(kind) {
  if (!lastLookup) return;
  await Dict.saveTerm(lastLookup, kind ? { kind } : {});
  toast(`Saved “${lastLookup.term}”`);
  $('#lookup-out').innerHTML = '';
  $('#lookup-q').value = '';
  renderVocab();
}

async function renderVocab() {
  const st = await Dict.stats();
  $('#vstats').innerHTML = `<span class="chip"><b>${st.total}</b> saved</span><span class="chip"><b>${st.mastered}</b> mastered</span>
    <span class="chip"><b>${st.learning}</b> learning</span><span class="chip"><b>${st.fresh}</b> new</span><span class="chip"><b>${st.phrases}</b> idioms/phrases</span>`;
  $('#review-btn').textContent = st.due ? `Review ${st.due}` : 'Review';
  $('#review-btn').disabled = !st.due;
  const w = await Dict.wordOfDay();
  $('#wotd').innerHTML = w ? `<div class="wotd"><div class="k">Word of the day</div><div class="w">${esc(w.term)} <span class="muted small">${esc(w.phonetic || '')}</span></div><div class="small">${esc(Dict.firstDef(w))}</div></div>` : '';
  const q = $('#vocab-q').value.trim().toLowerCase();
  const f = $('#vocab-filter').value;
  const now = Date.now();
  let items = await list('vocab');
  items = items.filter(v =>
    (!q || v.term.includes(q) || Dict.firstDef(v).toLowerCase().includes(q)) &&
    (f === 'all' || (f === 'due' && v.due <= now) || (f === 'learning' && v.box > 0 && v.box < Dict.MASTERED_BOX) ||
     (f === 'mastered' && v.box >= Dict.MASTERED_BOX) || (f === 'word' && v.kind === 'word') || (f === 'phrase' && v.kind !== 'word'))
  ).sort((a, b) => b.created - a.created);
  $('#words').innerHTML = items.slice(0, 200).map(v =>
    `<li data-w="${v.id}"><span class="lvl">${[1, 2, 3, 4, 5].map(i => `<i class="${v.box >= i ? 'on' : ''}"></i>`).join('')}</span>
     <span class="t"><b>${esc(v.term)}</b> <span class="muted small">${esc(Dict.firstDef(v)).slice(0, 90)}</span></span>${v.kind !== 'word' ? `<span class="k">${esc(v.kind)}</span>` : ''}</li>`
  ).join('') || `<li class="muted small">${st.total ? 'No matches' : 'Look up a word above, or select text on any page → right-click → “Sumi: look up”.'}</li>`;
}
$('#vocab-q').addEventListener('input', renderVocab);
$('#vocab-filter').addEventListener('change', renderVocab);
$('#words').addEventListener('click', async e => {
  const li = e.target.closest('[data-w]');
  if (!li) return;
  const v = (await list('vocab')).find(x => x.id === li.dataset.w);
  openWord(v);
});
function openWord(v) {
  const d = $('#word');
  const next = v.due <= Date.now() ? 'due now' : `next review ${new Date(v.due).toLocaleDateString()}`;
  $('#word-body').innerHTML = `${defHtml({ ...v, found: true }, { actions: '<button class="ghost" id="w-close">✕</button>' })}
    <div class="row small muted" style="margin:10px 0">Level ${v.box}/${Dict.INTERVALS.length - 1} · ${next} · looked up ${v.lookups || 1}× · reviewed ${v.reviews || 0}×
      ${v.source?.url ? ` · from <a href="${esc(v.source.url)}" target="_blank">${esc(domainOf(v.source.url) || 'page')}</a>` : ''}</div>
    <label class="small muted">Type</label>
    <select id="w-kind"><option value="word">word</option><option value="phrase">phrase</option><option value="idiom">idiom</option></select>
    <label class="small muted">Your note / meaning in your words</label>
    <textarea id="w-note" rows="3">${esc(v.note || '')}</textarea>
    <div class="row" style="margin-top:10px"><button class="primary" id="w-save">Save</button><button id="w-reset">Reset progress</button><span class="sp"></span><button class="danger" id="w-del">Delete</button></div>`;
  $('#w-kind').value = v.kind;
  $('#w-close').onclick = () => d.close();
  $('#w-save').onclick = async () => { v.note = $('#w-note').value; v.kind = $('#w-kind').value; await put('vocab', v); d.close(); renderVocab(); };
  $('#w-reset').onclick = async () => { Object.assign(v, { box: 0, due: Date.now() }); await put('vocab', v); d.close(); renderVocab(); };
  $('#w-del').onclick = async () => { if (confirm(`Delete “${v.term}”?`)) { await remove('vocab', v.id); d.close(); renderVocab(); } };
  d.showModal();
}
renderVocab();

// review session
let queue = [];
let cur = null;
async function startReview() {
  queue = await Dict.dueItems(30);
  if (!queue.length) return toast('Nothing due - nice!');
  $('#review').showModal();
  nextCard();
}
function nextCard() {
  cur = queue.shift();
  if (!cur) { $('#review').close(); toast('Review done ✓'); renderVocab(); return; }
  $('#rv-count').textContent = `${queue.length + 1} left`;
  $('#rv-term').textContent = cur.term;
  $('#rv-phon').textContent = cur.phonetic || (cur.kind !== 'word' ? cur.kind : '');
  $('#rv-back').hidden = true;
  $('#rv-grades').hidden = true;
  $('#rv-show-row').hidden = false;
}
function showBack() {
  $('#rv-back').innerHTML = defHtml({ ...cur, found: true }) + (cur.note ? `<p class="small">📝 ${esc(cur.note)}</p>` : '');
  $('#rv-back').hidden = false;
  $('#rv-grades').hidden = false;
  $('#rv-show-row').hidden = true;
}
async function grade(g) {
  if (!cur) return;
  await Dict.review(cur, g);
  if (g === 0) queue.push(cur); // see it again this session
  nextCard();
}
$('#review-btn').onclick = startReview;
$('#rv-show').onclick = showBack;
$('#rv-close').onclick = () => { $('#review').close(); renderVocab(); };
$('#rv-grades').addEventListener('click', e => { const b = e.target.closest('[data-g]'); if (b) grade(Number(b.dataset.g)); });
$('#review').addEventListener('keydown', e => {
  if (e.key === ' ' && !$('#rv-show-row').hidden) { e.preventDefault(); showBack(); }
  else if (/^[1-4]$/.test(e.key) && !$('#rv-grades').hidden) grade(Number(e.key) - 1);
});

// ================= settings =================
const form = $('#s-form');
function fillSettings() {
  for (const [k, v] of Object.entries(cfg)) {
    const el = form.elements[k];
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!v;
    else if (Array.isArray(v)) el.value = v.join('\n');
    else el.value = v;
  }
}
async function renderSync() {
  const last = await get('lastSync', 0);
  $('#sync-status').textContent = !configured() ? 'Drive sync needs an OAuth client ID in this build (see README).'
    : last ? `Last synced ${new Date(last).toLocaleString()}` : 'Not synced yet';
}
$('#open-settings').onclick = () => { fillSettings(); renderSync(); $('#settings').showModal(); };
$('#s-close').onclick = () => $('#settings').close();
form.addEventListener('change', async () => {
  const patch = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') patch[el.name] = el.checked;
    else if (el.type === 'number') patch[el.name] = Number(el.value);
    else if (el.tagName === 'TEXTAREA') patch[el.name] = el.value.split(/[\n,]/).map(s => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')).filter(Boolean);
    else patch[el.name] = el.value;
  }
  cfg = await setSettings(patch);
  applyAccent(cfg.accent);
  tickClock();
  renderFocusStats();
  toast('Saved');
});
$('#sync-btn').onclick = async () => {
  $('#sync-status').textContent = 'Syncing…';
  const r = await send({ type: 'sync' });
  if (r.ok) { toast('Synced with your Google Drive'); renderVocab(); renderTabs(); renderUsage(); } else toast(r.error);
  renderSync();
};
$('#signout-btn').onclick = async () => { await signOut(); toast('Drive sync stopped'); renderSync(); };
$('#export-btn').onclick = async () => {
  const blob = new Blob([JSON.stringify(await exportAll(), null, 1)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `sumi-backup-${dayKey()}.json` });
  a.click();
};
$('#import-btn').onclick = () => {
  const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
  inp.onchange = async () => {
    try { await importAll(JSON.parse(await inp.files[0].text())); toast('Backup imported'); setTimeout(() => location.reload(), 500); } catch (e) { toast(e.message); }
  };
  inp.click();
};
$('#reset-settings').onclick = async () => { if (confirm('Reset all settings to defaults? Your words, sessions and stats are kept.')) { cfg = await resetSettings(); fillSettings(); applyAccent(cfg.accent); toast('Settings reset'); } };
$('#clear-usage').onclick = async () => { if (confirm('Delete all time-per-site history on this device?')) { await set('usage', {}); renderUsage(); toast('Usage history cleared'); } };
if (location.hash === '#settings') $('#open-settings').click();

// ================= live updates & keys =================
chrome.storage.onChanged.addListener((changes, area) => {
  if (changes.timer) { timer = changes.timer.newValue; renderTimer(); }
  if (changes.focusLog) renderFocusStats();
  if (changes.vocab) renderVocab();
  if (changes.sessions) renderSessions();
  if (area === 'sync' && changes.settings) { cfg = { ...cfg, ...changes.settings.newValue }; applyAccent(cfg.accent); }
});
document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, select, dialog')) return;
  if (e.key === '/') { e.preventDefault(); $('#tab-q').focus(); }
  if (e.key === 'l') { e.preventDefault(); $('#lookup-q').focus(); }
  if (e.key === 'p') act('toggle');
  if (e.key === 'r') startReview();
});
