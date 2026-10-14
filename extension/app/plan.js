// Plan the day and shut down. The first new tab of the day asks for a few things that would
// make today good (unfinished ones from the last plan, parked tasks, Later items due or in
// progress, open tasks) and a focus goal; a thin "Today" strip keeps them in sight. In the
// evening, Shut down shows what got done and saves + closes every tab for tomorrow.
// Plans are records ("plans", one per day) so they sync like everything else.
import { esc, h, toast } from '../lib/ui.js';
import { all, one, put, get, uid, dayKey, getSettings } from '../lib/store.js';
import * as L from '../lib/later.js';
import * as C from '../lib/collections.js';

const KIND = { task: 'Task', later: 'Later', parked: 'Parked', text: '' };
const kindOf = ref => KIND[ref.split(':')[0]] ?? '';
export const todayPlan = () => one('plans', dayKey());

async function candidates() {
  const [tasks, later, cols, plans] = await Promise.all([all('tasks'), L.items(), C.collections(), all('plans')]);
  const prev = plans.filter(p => p.id < dayKey()).sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const list = [
    ...(prev?.items || []).filter(i => !i.done).map(i => ({ ...i, carry: true })),
    ...cols.filter(c => c.parked).map(c => ({ ref: 'parked:' + c.id, title: c.name })),
    ...later.filter(i => i.status !== 'done' && (i.status === 'doing' || (i.due && i.due <= end.getTime()))).map(i => ({ ref: 'later:' + i.id, title: i.title })),
    ...tasks.filter(t => !t.done).sort((a, b) => (b.today === true) - (a.today === true) || (b.high === true) - (a.high === true) || (a.order ?? 0) - (b.order ?? 0)).map(t => ({ ref: 'task:' + t.id, title: t.text }))
  ];
  const seen = new Set();
  return list.filter(i => !seen.has(i.ref) && seen.add(i.ref)).slice(0, 12);
}

// first new tab of the day (once per browser session if dismissed with Esc)
export async function maybePlan() {
  const cfg = await getSettings();
  if (!cfg.dailyPlan || new Date().getHours() < 4 || await todayPlan()) return;
  const { planAsked } = await chrome.storage.session.get('planAsked');
  if (planAsked === dayKey()) return;
  await chrome.storage.session.set({ planAsked: dayKey() });
  openPlanner();
}

export async function openPlanner() {
  const cfg = await getSettings();
  const cur = await todayPlan();
  const cands = await candidates();
  const titles = new Map([...cands, ...(cur?.items || [])].map(i => [i.ref, i]));
  const chosen = new Set(cur?.items?.length ? cur.items.map(i => i.ref) : cands.filter(c => c.carry).map(c => c.ref));
  const opts = [...(cur?.items || []).filter(i => !cands.some(c => c.ref === i.ref)), ...cands];
  const row = (o, on) => `<label class="ck"><input type="checkbox" name="i" value="${esc(o.ref)}" ${on ? 'checked' : ''}><span>${esc(o.title)}</span>
    ${o.carry ? '<span class="chip">not finished</span>' : ''}<span class="faint small">${kindOf(o.ref)}</span></label>`;
  const d = h(`<dialog class="modal plan-dlg"><form method="dialog">
    <h3>Plan today</h3><p class="small muted">Pick up to 3 things that would make today a good day.</p>
    <div class="plan-opts">${opts.map(o => row(o, chosen.has(o.ref))).join('') || '<p class="faint small">Nothing open in Tasks or Later yet: add something below.</p>'}</div>
    <input type="text" name="new" placeholder="Something else… (Enter to add)" autocomplete="off">
    <label class="small muted">Focus goal <input type="number" name="goal" min="0" max="960" step="5" value="${cur?.goalMin ?? cfg.dailyGoalMin}"> min</label>
    <div class="row end"><button value="skip" class="ghost">Skip today</button><button value="ok" class="primary">Start the day</button></div>
  </form></dialog>`);
  document.body.appendChild(d);
  const f = d.querySelector('form');
  f.elements.new.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const t = e.target.value.trim(); if (!t) return;
    const o = { ref: 'text:' + uid(), title: t.slice(0, 200) };
    titles.set(o.ref, o);
    d.querySelector('.plan-opts').insertAdjacentHTML('afterbegin', row(o, true));
    d.querySelector('.plan-opts > p')?.remove();
    e.target.value = '';
  });
  d.addEventListener('close', async () => {
    const v = d.returnValue;
    if (v === 'ok') {
      const prev = new Map((cur?.items || []).map(i => [i.ref, i]));
      const items = [...f.querySelectorAll('input[name=i]:checked')].map(x => ({ ref: x.value, title: titles.get(x.value)?.title || '', done: !!prev.get(x.value)?.done }));
      const goal = Math.max(0, Math.min(960, Math.round(Number(f.elements.goal.value)) || cfg.dailyGoalMin));
      await put('plans', { ...(cur || {}), id: dayKey(), items, goalMin: goal, skipped: false });
      toast(items.length ? 'Have a good day' : 'Plan saved');
    } else if (v === 'skip') await put('plans', { ...(cur || {}), id: dayKey(), items: cur?.items || [], skipped: true });
    d.remove();
  });
  d.showModal();
}

// the "Today" strip on the new tab: plan items to tick off, focus vs goal, Edit / Shut down
export async function renderStrip(el) {
  const [cfg, p] = await Promise.all([getSettings(), todayPlan()]);
  if (!cfg.dailyPlan || !p?.items?.length) { el.hidden = true; el.innerHTML = ''; return; }
  const mins = ((await get('focusLog', {}))[dayKey()] || {}).minutes || 0;
  el.hidden = false;
  el.innerHTML = `<span class="k">Today</span>
    ${p.items.map((i, n) => `<label class="pi ${i.done ? 'done' : ''}"><input type="checkbox" data-n="${n}" ${i.done ? 'checked' : ''}><span data-open="${n}" title="${esc(kindOf(i.ref) ? kindOf(i.ref) + ': ' : '')}${esc(i.title)}">${esc(i.title)}</span></label>`).join('')}
    <span class="sp"></span><span class="faint small">Focus ${mins}/${p.goalMin ?? cfg.dailyGoalMin} min</span>
    <button class="ghost small" data-a="plan">Edit</button><button class="ghost small" data-a="shut">${p.shutdownAt ? 'Shut down ✓' : 'Shut down'}</button>`;
  el.onchange = async e => {
    const n = Number(e.target.dataset.n); if (!Number.isInteger(n)) return;
    const done = e.target.checked;
    const plan = await todayPlan(); if (!plan?.items[n]) return;
    plan.items[n] = { ...plan.items[n], done };
    await put('plans', plan);
    const [type, id] = plan.items[n].ref.split(':');
    if (type === 'task') { const t = await one('tasks', id); if (t) await put('tasks', { ...t, done, doneAt: done ? Date.now() : null }); }
    if (type === 'later') await L.patch(id, { status: done ? 'done' : 'doing' });
    if (done && plan.items.every(i => i.done)) toast('Everything on today\'s plan is done');
  };
  el.onclick = async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'plan') return openPlanner();
    if (a === 'shut') return openShutdown();
    const o = e.target.closest('[data-open]'); if (!o) return;
    e.preventDefault();
    const [type, id] = p.items[Number(o.dataset.open)].ref.split(':');
    if (type === 'task') location.hash = '#tasks';
    if (type === 'later') { const it = await one('later', id); if (it && /^https?:/.test(it.url)) chrome.tabs.create({ url: it.url }); }
    if (type === 'parked') { const c = await one('collections', id); if (c && !c.deleted) await C.resume(c); }
  };
}

// evening: what got done, a note for tomorrow, and every tab saved + closed (Resume brings them back)
export async function openShutdown() {
  const p = (await todayPlan()) || { id: dayKey(), items: [] };
  const cfg = await getSettings();
  const mins = ((await get('focusLog', {}))[dayKey()] || {}).minutes || 0;
  const top = Object.entries((await get('usage', {}))[dayKey()] || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const tabs = (await chrome.tabs.query({})).filter(t => /^(https?|file):/.test(t.url || '') && !t.pinned && !t.incognito);
  const done = p.items.filter(i => i.done);
  const d = h(`<dialog class="modal plan-dlg"><form method="dialog">
    <h3>Shut down for the day</h3>
    ${p.items.length ? `<p class="small muted">${done.length} of ${p.items.length} planned things done${done.length < p.items.length ? ' · the rest is offered again tomorrow' : ''}</p>
      <ul class="plan-done">${p.items.map(i => `<li class="${i.done ? 'done' : ''}">${i.done ? '✓' : '○'} ${esc(i.title)}</li>`).join('')}</ul>` : '<p class="small muted">No plan today.</p>'}
    <p class="small muted">Focus ${mins} of ${p.goalMin ?? cfg.dailyGoalMin} min${top.length ? ` · most time on ${top.map(([dom, s]) => `${esc(dom)} (${Math.round(s / 60)} min)`).join(', ')}` : ''}</p>
    <label class="ck"><input type="checkbox" name="close" ${tabs.length ? 'checked' : 'disabled'}> Save and close ${tabs.length} open tab${tabs.length === 1 ? '' : 's'} (Resume them tomorrow)</label>
    <input type="text" name="note" placeholder="Note for tomorrow (optional)" maxlength="300" autocomplete="off">
    <div class="row end"><button value="cancel" class="ghost">Cancel</button><button value="ok" class="primary">Shut down</button></div>
  </form></dialog>`);
  document.body.appendChild(d);
  d.addEventListener('close', async () => {
    if (d.returnValue === 'ok') {
      const f = d.querySelector('form').elements;
      const note = f.note.value.trim() || p.items.filter(i => !i.done).map(i => i.title).join(' · ');
      await put('plans', { ...p, shutdownAt: Date.now(), note: f.note.value.trim() });
      if (f.close.checked && tabs.length) await closeForTheDay(tabs, note);
      toast('Done for today. Good night');
    }
    d.remove();
  });
  d.showModal();
}

// one parked collection with every tab; other windows close, this one keeps only Sumi
async function closeForTheDay(tabs, note) {
  const name = `End of day · ${new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`;
  const col = await C.addCollection((await C.parkedSpace()).id, name);
  await put('collections', { ...col, parked: { note: note.slice(0, 500), at: Date.now(), group: null } });
  await C.addCards(col.id, tabs);
  const ids = new Set(tabs.map(t => t.id));
  const me = (await chrome.tabs.getCurrent())?.windowId;
  for (const w of await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] })) {
    if (w.incognito) continue;
    if (w.id !== me && w.tabs.every(t => ids.has(t.id))) await chrome.windows.remove(w.id).catch(() => {});
    else await chrome.tabs.remove(w.tabs.filter(t => ids.has(t.id)).map(t => t.id)).catch(() => {});
  }
}
