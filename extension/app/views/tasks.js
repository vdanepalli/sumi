// Tasks: a simple list for the day. Enter to add, click to complete, drag to reorder.
import { $, $$, esc, toast } from '../../lib/ui.js';
import { all, put, putMany, remove, uid } from '../../lib/store.js';

let filter = 'open';

export async function mount(el) {
  el.innerHTML = `
    <section class="card tasks-card">
      <h2>Tasks <span class="sp"></span>
        <span class="seg" id="tf"><button data-f="open">Open</button><button data-f="done">Done</button><button data-f="all">All</button></span></h2>
      <form id="add" class="row nowrap"><input type="text" id="t" placeholder="Add a task and press Enter…  (use !today, !high)" autocomplete="off"><button class="primary">Add</button></form>
      <ul class="tasks" id="list"></ul>
      <div class="row small muted"><span id="count"></span><span class="sp"></span><button class="ghost small" id="clear">Clear completed</button></div>
    </section>`;
  $('#add').onsubmit = async e => {
    e.preventDefault();
    let text = $('#t').value.trim();
    if (!text) return;
    const high = /!high\b/.test(text); const today = /!today\b/.test(text);
    text = text.replace(/!(high|today)\b/g, '').trim();
    const items = await all('tasks');
    await put('tasks', { id: uid(), text, done: false, high, today, created: Date.now(), order: items.length ? Math.min(...items.map(i => i.order ?? 0)) - 1 : 0 });
    $('#t').value = '';
  };
  $('#tf').onclick = e => { const b = e.target.closest('[data-f]'); if (b) { filter = b.dataset.f; render(); } };
  $('#clear').onclick = async () => { const done = (await all('tasks')).filter(t => t.done); await remove('tasks', done.map(t => t.id)); toast(`Cleared ${done.length}`); };
  const onStore = (c, a) => { if (a === 'local' && c.tasks) render(); };
  chrome.storage.onChanged.addListener(onStore);
  render();
  $('#t').focus();
  return () => chrome.storage.onChanged.removeListener(onStore);
}

async function render() {
  const items = (await all('tasks')).sort((a, b) => (a.done - b.done) || (b.high - a.high) || (a.order ?? 0) - (b.order ?? 0));
  const shown = items.filter(t => filter === 'all' || (filter === 'done' ? t.done : !t.done));
  $$('#tf button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === filter)));
  $('#count').textContent = `${items.filter(t => !t.done).length} open · ${items.filter(t => t.done).length} done`;
  $('#list').innerHTML = shown.map(t => `<li draggable="true" data-id="${t.id}" class="${t.done ? 'done' : ''}">
      <button class="check" data-a="done" aria-label="Complete"></button>
      <span class="tx" data-a="edit">${esc(t.text)}</span>
      ${t.high ? '<span class="chip warn">high</span>' : ''}${t.today ? '<span class="chip">today</span>' : ''}
      <button class="ghost small" data-a="focus" title="Start a focus session on this task">▶ Focus</button><button class="ghost icon" data-a="del" title="Delete">✕</button></li>`).join('') || `<li class="muted small">${filter === 'done' ? 'Nothing completed yet.' : 'All clear.'}</li>`;
  $('#list').onclick = async e => {
    const li = e.target.closest('li[data-id]'); if (!li) return;
    const t = items.find(x => x.id === li.dataset.id);
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'done') await put('tasks', { ...t, done: !t.done, doneAt: Date.now() });
    if (a === 'del') await remove('tasks', t.id);
    if (a === 'focus') { await chrome.runtime.sendMessage({ type: 'timer', action: 'start', project: { type: 'task', id: t.id, title: t.text } }); toast(`Focusing on “${t.text}”`); }
    if (a === 'edit') {
      const span = e.target.closest('.tx');
      span.contentEditable = 'true'; span.focus();
      const finish = async () => { span.contentEditable = 'false'; const v = span.textContent.trim(); if (v && v !== t.text) await put('tasks', { ...t, text: v }); };
      span.onblur = finish;
      span.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); span.blur(); } if (ev.key === 'Escape') { span.textContent = t.text; span.blur(); } };
    }
  };
  // drag to reorder
  let dragId = null;
  $$('#list li[data-id]').forEach(li => {
    li.ondragstart = () => { dragId = li.dataset.id; };
    li.ondragover = e => e.preventDefault();
    li.ondrop = async e => {
      e.preventDefault();
      if (!dragId || dragId === li.dataset.id) return;
      const ids = shown.map(t => t.id).filter(id => id !== dragId);
      ids.splice(ids.indexOf(li.dataset.id), 0, dragId);
      await putMany('tasks', ids.map((id, i) => ({ ...items.find(t => t.id === id), order: i })));
    };
  });
}
