// Later: reading list / watch later / papers with deadlines and reminders.
import { $, $$, esc, h, toast, favicon, confirmBox } from '../../lib/ui.js';
import { domainOf } from '../../lib/store.js';
import * as L from '../../lib/later.js';

let state = { kind: 'all', q: '', showDone: false, group: 'due' };
const GROUPS = { due: 'Deadline', site: 'Site', kind: 'Type', tag: 'Tag', none: 'Newest first' };

export async function mount(el) {
  el.innerHTML = `
    <header class="later-h">
      <form id="add" class="row nowrap grow">
        <input type="url" id="url" placeholder="Paste a link to read or watch later…" autocomplete="off" required>
        <select id="kind"><option value="">Auto type</option>${Object.entries(L.KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <select id="due">
          <option value="">No deadline</option><option value="tonight">Tonight</option><option value="tomorrow">Tomorrow</option>
          <option value="weekend">This weekend</option><option value="week">Within a week</option><option value="month">Within a month</option><option value="custom">Pick date…</option>
        </select>
        <button class="primary">Add</button>
      </form>
    </header>
    <div class="later-bar">
      <div class="seg" id="kinds"><button data-k="all">All</button>${Object.entries(L.KINDS).map(([k, v]) => `<button data-k="${k}">${v}</button>`).join('')}</div>
      <input type="search" id="q" placeholder="Search…" autocomplete="off">
      <label class="small muted">Group by <select id="group">${Object.entries(GROUPS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label class="small muted" title="Only items you can finish in this time (estimated when saved, or set in ✎ Edit)">Fits in <select id="fits"><option value="0">any time</option>${[10, 20, 30, 60].map(m => `<option value="${m}">${m} min</option>`).join('')}</select></label>
      <label class="ck small muted"><input type="checkbox" id="done"> Show done</label>
      <span class="sp"></span>
      <button id="yt" class="ghost" title="Save every open YouTube tab to Watch later">Save open YouTube tabs</button>
    </div>
    <div class="later-stats" id="stats"></div>
    <div id="upnext"></div>
    <div id="list"></div>`;

  $('#add').onsubmit = async e => {
    e.preventDefault();
    const url = $('#url').value.trim();
    let due = null;
    const pick = $('#due').value;
    if (pick === 'custom') { due = await pickDate(); if (!due) return; }
    else if (pick) due = L.presetDue(pick);
    const btn = $('#add button'); btn.disabled = true; // fetching the title can take a few seconds
    let it;
    try {
      const had = await L.find(url).catch(() => null);
      it = await L.add({ url, kind: $('#kind').value || undefined, due, remindBefore: due ? 60 : null });
      toast(had ? `Already in Later: ${it.title}` : `Saved: ${it.title}`);
      $('#url').value = ''; $('#due').value = '';
    } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  };
  $('#kinds').onclick = e => { const b = e.target.closest('[data-k]'); if (b) { state.kind = b.dataset.k; render(); } };
  $('#q').oninput = e => { state.q = e.target.value.toLowerCase(); render(); };
  $('#done').onchange = e => { state.showDone = e.target.checked; render(); };
  $('#fits').onchange = e => { state.fits = Number(e.target.value); render(); };
  state.group = GROUPS[(await chrome.storage.local.get('laterGroup')).laterGroup] ? (await chrome.storage.local.get('laterGroup')).laterGroup : 'due';
  $('#group').value = state.group;
  $('#group').onchange = e => { state.group = e.target.value; chrome.storage.local.set({ laterGroup: state.group }); render(); };
  $('#yt').onclick = async () => {
    const seen = new Set();
    const tabs = (await chrome.tabs.query({})).filter(t => L.isYoutube(t.url) && /watch|list=|shorts/.test(t.url) && !seen.has(L.urlKey(t.url)) && seen.add(L.urlKey(t.url)));
    if (!tabs.length) return toast('No YouTube videos open');
    const before = (await L.items()).length;
    $('#yt').disabled = true;
    toast(`Saving ${tabs.length} YouTube tab${tabs.length === 1 ? '' : 's'}…`);
    const queue = [...tabs]; // a few at a time: each one looks up the video title
    await Promise.all([1, 2, 3, 4].map(async () => { for (let t; (t = queue.shift());) await L.add({ url: t.url, title: t.title, kind: 'watch' }).catch(() => {}); }));
    $('#yt').disabled = false;
    const n = (await L.items()).length - before;
    toast(n ? `Saved ${n} YouTube video${n === 1 ? '' : 's'}${n < tabs.length ? ` (${tabs.length - n} already saved)` : ''}` : 'All open YouTube videos are already saved');
  };
  const onStore = (c, a) => { if (a === 'local' && (c.later || c.laterProgress)) render(); };
  chrome.storage.onChanged.addListener(onStore);
  const iv = setInterval(render, 60000); // keep "due in…" fresh
  render();
  return () => { chrome.storage.onChanged.removeListener(onStore); clearInterval(iv); };
}

let progress = {};
async function render() {
  progress = (await chrome.storage.local.get('laterProgress')).laterProgress || {};
  const all = await L.items();
  const now = Date.now();
  const open = all.filter(i => i.status !== 'done');
  const weekAgo = now - 7 * 86400000;
  $('#stats').innerHTML = [
    ['To read', open.filter(i => i.kind === 'read' || i.kind === 'paper').length],
    ['To watch', open.filter(i => i.kind === 'watch').length],
    ['Overdue', open.filter(i => i.due && i.due < now).length],
    ['Done this week', all.filter(i => i.doneAt && i.doneAt > weekAgo).length]
  ].map(([k, v]) => `<span class="chip">${k} <b>${v}</b></span>`).join('');
  // up next: in progress first, then the most urgent deadline, then high priority, then newest
  const next = [...open].sort((a, b) => (b.status === 'doing') - (a.status === 'doing') || (a.due || Infinity) - (b.due || Infinity) || (b.priority === 'high') - (a.priority === 'high') || b.created - a.created)[0];
  $('#upnext').innerHTML = next ? `<div class="upnext" data-id="${esc(next.id)}"><span class="k">Up next</span>${next.thumb ? `<img src="${esc(next.thumb)}" alt="" data-fb="hide">` : ''}
    <div class="lt"><div class="tt">${esc(next.title)}</div><div class="dd">${kindLabel(next)}${next.minutes ? ` · ${Number(next.minutes)} min` : ''}${next.due ? ` · ${L.relTime(next.due)}` : ''}${pct(next) !== null ? ` · ${pct(next)}% done` : ''}</div></div>
    <button class="primary" data-a="focus">▶ Start with focus timer</button><button data-a="open">Open</button></div>` : '';
  $('#upnext').onclick = async e => {
    const b = e.target.closest('[data-a]'); if (!b || !next) return;
    if (b.dataset.a === 'focus') await chrome.runtime.sendMessage({ type: 'timer', action: 'start', minutes: next.minutes || undefined, project: { type: 'later', id: next.id, title: next.title } });
    chrome.tabs.create({ url: next.url });
    if (next.status === 'todo') await L.patch(next.id, { status: 'doing' });
  };
  $$('#kinds button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === state.kind)));
  const shown = all.filter(i => (state.kind === 'all' || i.kind === state.kind) && (!state.fits || (i.minutes && i.minutes <= state.fits)) &&
    (state.showDone || i.status !== 'done') &&
    (!state.q || `${i.title} ${i.url} ${i.note || ''} ${tagsOf(i).map(t => '#' + t).join(' ')} ${i.author || ''}`.toLowerCase().includes(state.q)));
  $('#list').innerHTML = grouped(shown, now).map(([k, label, list]) => `<section class="lgroup ${k}"><h3 class="sub">${label} <span class="faint">${list.length}</span>
    ${state.group !== 'due' && list.some(i => i.status !== 'done') ? `<button class="ghost small" data-open-group="${esc(k)}" title="Open the unfinished ones (up to 15)">Open all</button>` : ''}</h3>
    ${list.map(itemHtml).join('')}</section>`).join('')
    || `<div class="empty"><h3>Nothing queued</h3><p class="muted">Right-click any page or link → <b>Save to Sumi Later</b>, press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>, or paste a link above.</p></div>`;
  $('#list').onclick = async e => {
    const og = e.target.closest('[data-open-group]');
    if (og) {
      const list = (grouped(shown, now).find(g => g[0] === og.dataset.openGroup)?.[2] || []).filter(i => i.status !== 'done').slice(0, 15);
      for (const i of list) chrome.tabs.create({ url: i.url, active: false });
      return toast(`Opened ${list.length}`);
    }
    const tag = e.target.closest('[data-tag]');
    if (tag) { state.q = '#' + tag.dataset.tag.toLowerCase(); $('#q').value = state.q; return render(); }
    const row = e.target.closest('[data-id]'); if (!row) return;
    const it = all.find(x => x.id === row.dataset.id);
    if (!it) return;
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'status') await L.patch(it.id, { status: it.status === 'todo' ? 'doing' : it.status === 'doing' ? 'done' : 'todo' });
    else if (a === 'done') { await L.patch(it.id, { status: it.status === 'done' ? 'todo' : 'done' }); }
    else if (a === 'edit') edit(it);
    else if (a === 'focus') {
      await chrome.runtime.sendMessage({ type: 'timer', action: 'start', minutes: it.minutes || undefined, project: { type: 'later', id: it.id, title: it.title } });
      if (it.status === 'todo') await L.patch(it.id, { status: 'doing' });
      chrome.tabs.create({ url: it.url });
    }
    else if (a === 'del') { if (await confirmBox('Remove this item?', it.title, 'Remove')) await L.del(it.id); }
    else if (!e.target.closest('button, a')) { chrome.tabs.create({ url: it.url }); if (it.status === 'todo') await L.patch(it.id, { status: 'doing' }); }
  };
}

const tagsOf = i => (Array.isArray(i.tags) ? i.tags : []);
const prio = { high: 0, normal: 1, low: 2 };
const urgent = (a, b) => (a.status === 'done') - (b.status === 'done') || (a.due || Infinity) - (b.due || Infinity) || (prio[a.priority] ?? 1) - (prio[b.priority] ?? 1) || (b.created || 0) - (a.created || 0);
// [key, label, items] per group for the chosen "Group by"
function grouped(shown, now) {
  if (state.group === 'due') return L.BUCKETS.map(([k, label]) => [k, label, shown.filter(i => L.bucket(i, now) === k)
    .sort(k === 'done' ? (a, b) => (b.doneAt || 0) - (a.doneAt || 0) : urgent)]).filter(g => g[2].length);
  if (state.group === 'none') return [['all', 'Newest first', [...shown].sort((a, b) => (a.status === 'done') - (b.status === 'done') || (b.created || 0) - (a.created || 0))]];
  const keys = i => state.group === 'site' ? [domainOf(i.url) || 'other'] : state.group === 'kind' ? [L.KINDS[i.kind] ? i.kind : 'read'] : tagsOf(i).length ? tagsOf(i) : [''];
  const m = new Map();
  for (const i of shown) for (const k of keys(i)) { if (!m.has(k)) m.set(k, []); m.get(k).push(i); }
  const label = k => state.group === 'kind' ? L.KINDS[k] : state.group === 'tag' ? (k ? '#' + esc(k) : 'No tag') : esc(k);
  return [...m].sort((a, b) => (a[0] === '') - (b[0] === '') || b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([k, list]) => [k, label(k), list.sort(urgent)]);
}
const kindLabel = i => L.KINDS[i.kind] || L.KINDS.read;
const pct = i => { const p = Number(progress[i.id]?.pct); return Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : null; };

function itemHtml(i) {
  const due = i.due ? `<span class="due ${i.due < Date.now() && i.status !== 'done' ? 'over' : ''}" title="${new Date(i.due).toLocaleString()}">${i.status === 'done' ? new Date(i.due).toLocaleDateString() : L.relTime(i.due)}</span>` : '';
  const rem = i.remindAt && i.status !== 'done' ? `<span class="faint" title="Reminder ${new Date(i.remindAt).toLocaleString()}">🔔</span>` : '';
  const nag = i.nag?.every && i.status !== 'done' ? `<button class="ghost small nag" data-a="edit" title="${esc(L.nagLabel(i.nag.every))} until done · next ${new Date(i.nag.next).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}">↻ ${i.nag.every >= 1440 ? 'daily' : i.nag.every >= 60 ? i.nag.every / 60 + 'h' : i.nag.every + 'm'}</button>` : '';
  const st = L.STATUS[i.status] ? i.status : 'todo';
  const p = pct(i);
  return `<div class="litem ${st}" data-id="${esc(i.id)}">
    <button class="st ${st}" data-a="status" title="${L.STATUS[st]} - click to advance"></button>
    ${i.thumb ? `<img class="thumb" src="${esc(i.thumb)}" alt="" loading="lazy" data-fb="hide">` : `<img class="fav" src="${esc(favicon(i.url))}" alt="" data-fb="hide">`}
    <div class="lt"><div class="tt">${i.priority === 'high' ? '<span class="hi">!</span> ' : ''}${esc(i.title)}${i.playlist ? ' <span class="chip">playlist</span>' : ''}</div>
      <div class="dd"><span class="k k-${L.KINDS[i.kind] ? i.kind : 'read'}">${kindLabel(i)}</span> ${esc(i.author || domainOf(i.url) || '')}${i.minutes ? ` · ${Number(i.minutes)} min` : ''}${tagsOf(i).length ? ' · ' + tagsOf(i).map(t => `<a href="#later" data-tag="${esc(t)}" title="Show only #${esc(t)}">#${esc(t)}</a>`).join(' ') : ''}${i.note ? ` · ${esc(String(i.note).slice(0, 80))}` : ''}</div></div>
    ${p !== null && i.status !== 'done' ? `<span class="prog" title="${p}% read / watched"><i style="width:${p}%"></i></span>` : ''}${nag}${rem}${due}
    <div class="la"><button class="ghost small" data-a="focus" title="Start a focus session on this">▶ Focus</button><button class="ghost small" data-a="done">${i.status === 'done' ? 'Undo' : 'Done'}</button><button class="ghost icon" data-a="edit" title="Edit">✎</button><button class="ghost icon" data-a="del" title="Remove">✕</button></div>
  </div>`;
}

const toLocalInput = ts => { if (!ts) return ''; const d = new Date(ts); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
function pickDate() {
  return new Promise(resolve => {
    const d = h(`<dialog class="modal small"><form method="dialog"><h3>Deadline</h3><input type="datetime-local" name="d" value="${toLocalInput(L.presetDue('tomorrow'))}">
      <div class="row end"><button type="button" value="cancel" class="ghost">Cancel</button><button value="ok" class="primary">Set</button></div></form></dialog>`);
    document.body.appendChild(d);
    d.addEventListener('close', () => { const v = d.returnValue === 'ok' ? new Date(d.querySelector('input').value).getTime() || null : null; d.remove(); resolve(v); });
    d.showModal();
  });
}

function edit(it) {
  const remindOpts = [['', 'No reminder'], ['0', 'At the deadline'], ['15', '15 min before'], ['60', '1 hour before'], ['180', '3 hours before'], ['1440', '1 day before'], ['2880', '2 days before']];
  const d = h(`<dialog class="modal"><form method="dialog" class="lform">
    <h3>Edit</h3>
    <label>Title<input type="text" name="title" value="${esc(it.title)}"></label>
    <label>Link<input type="url" name="url" value="${esc(it.url)}"></label>
    <div class="row">
      <label>Type<select name="kind">${Object.entries(L.KINDS).map(([k, v]) => `<option value="${k}" ${k === it.kind ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Status<select name="status">${Object.entries(L.STATUS).map(([k, v]) => `<option value="${k}" ${k === it.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Priority<select name="priority">${['high', 'normal', 'low'].map(p => `<option ${p === it.priority ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
    </div>
    <div class="row">
      <label>Read / watch by<input type="datetime-local" name="due" value="${toLocalInput(it.due)}"></label>
      <label>Reminder<select name="remindBefore">${remindOpts.map(([v, l]) => `<option value="${v}" ${String(it.remindBefore ?? '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Minutes<input type="number" name="minutes" min="1" max="10000" step="1" value="${Number(it.minutes) || ''}" placeholder="est."></label>
    </div>
    <label>Keep reminding me until it's done<select name="nag"><option value="">Off</option>${L.NAG_EVERY.map(([v, l]) => `<option value="${v}" ${it.nag?.every === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <small class="faint">Notifications only inside the hours set in Settings → Later, never during a focus session.</small></label>
    <label>Tags (comma separated)<input type="text" name="tags" value="${esc(tagsOf(it).join(', '))}"></label>
    <label>Notes<textarea name="note" rows="3">${esc(it.note || '')}</textarea></label>
    <div class="row end"><button type="button" value="cancel" class="ghost">Cancel</button><button value="ok" class="primary">Save</button></div>
  </form></dialog>`);
  document.body.appendChild(d);
  d.addEventListener('close', async () => {
    if (d.returnValue === 'ok') {
      const f = d.querySelector('form').elements;
      const due = (f.due.value && new Date(f.due.value).getTime()) || null;
      const mins = Math.round(Number(f.minutes.value));
      const every = Number(f.nag.value) || 0;
      await L.patch(it.id, {
        title: f.title.value.trim() || it.url, url: f.url.value.trim() || it.url, kind: f.kind.value, status: f.status.value, priority: f.priority.value,
        due, remindBefore: f.remindBefore.value === '' ? null : Number(f.remindBefore.value), minutes: mins > 0 ? Math.min(mins, 10000) : null,
        ...(every !== (it.nag?.every || 0) ? { nag: L.nagOf(every) } : {}),
        tags: [...new Set(f.tags.value.split(',').map(t => t.trim().replace(/^#+/, '').replace(/\s+/g, '-')).filter(Boolean))], note: f.note.value.trim()
      });
      toast('Saved');
    }
    d.remove();
  });
  d.showModal();
}
