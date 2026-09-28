// Command palette: one search over open tabs, favourites, saved tabs, collections,
// Later, tasks and actions. ↑/↓ to move, Enter to run, Esc to close.
import { esc, favicon, send, toast } from './ui.js';
import { all, put, uid, domainOf } from './store.js';
import * as C from './collections.js';
import * as Tabs from './tabs.js';
import * as L from './later.js';

const app = hash => ({ run: () => chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html' + hash) }) });
const ACTIONS = [
  ['Start / pause focus timer', 'timer', () => send({ type: 'timer', action: 'toggle' })],
  ['Start 50-minute focus', 'timer', () => send({ type: 'timer', action: 'start', minutes: 50 })],
  ['Start / pause stopwatch', 'timer', () => send({ type: 'stopwatch', action: 'toggle' })],
  ['Reset focus timer', 'timer', () => send({ type: 'timer', action: 'reset' })],
  ['Save this window as a collection', 'tabs', async () => {
    const tabs = (await chrome.tabs.query({ currentWindow: true })).filter(t => /^https?:/.test(t.url));
    const [space] = await C.spaces();
    await C.saveTabs(space.id, `Saved ${new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`, tabs);
    toast(`Saved ${tabs.length} tabs`);
  }],
  ['Save this page to Later', 'later', async () => {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (t && /^https?:/.test(t.url)) { await L.add({ url: t.url, title: t.title }); toast('Saved to Later'); }
  }],
  ['Close duplicate tabs', 'tabs', async () => toast(`Closed ${await Tabs.closeDuplicates()} duplicates`)],
  ['Group tabs by site', 'tabs', async () => toast(`Made ${await Tabs.groupByDomain()} groups`)],
  ['Sort tabs by site', 'tabs', async () => toast(`Sorted ${await Tabs.sortByDomain()} tabs`)],
  ['Put inactive tabs to sleep', 'tabs', async () => toast(`${await Tabs.sleepInactive()} tabs asleep`)],
  ['Merge all windows', 'tabs', async () => toast(`Moved ${await Tabs.mergeWindows()} tabs`)],
  ['Snapshot all windows now', 'tabs', async () => { await send({ type: 'snapshot' }); toast('Snapshot saved'); }],
  ['Go to Collections', 'nav', app('#collections').run], ['Go to Later', 'nav', app('#later').run], ['Go to Focus', 'nav', app('#focus').run],
  ['Go to Insights', 'nav', app('#insights').run], ['Go to Sessions (restore)', 'nav', app('#sessions').run], ['Go to Tasks', 'nav', app('#tasks').run],
  ['Go to Settings', 'nav', app('#settings').run]
].map(([t, k, run]) => ({ kind: 'action', group: k, title: t, run }));

async function index() {
  const [tabs, cards, cols, later, tasks] = await Promise.all([chrome.tabs.query({}), C.cards(), C.collections(), L.items(), all('tasks')]);
  const self = (await chrome.tabs.getCurrent?.())?.id;
  const colName = Object.fromEntries(cols.map(c => [c.id, c.name]));
  return [
    ...ACTIONS,
    ...tabs.filter(t => t.id !== self).map(t => ({ kind: 'tab', title: t.title || t.url, sub: domainOf(t.url) || t.url, icon: t.favIconUrl || favicon(t.url), run: () => Tabs.focusTab(t) })),
    ...cards.map(k => ({ kind: k.starred ? 'fav' : 'saved', title: k.title, sub: `${colName[k.collectionId] || ''} · ${domainOf(k.url) || ''}`, icon: k.fav || favicon(k.url), run: () => C.openCard(k, 'new') })),
    ...cols.map(c => ({ kind: 'collection', title: c.name, sub: 'Open all tabs', starred: c.starred, run: async () => C.openCards(await C.cards(c.id)) })),
    ...later.filter(i => i.status !== 'done').map(i => ({ kind: 'later', title: i.title, sub: `${L.KINDS[i.kind]}${i.due ? ' · ' + L.relTime(i.due) : ''}`, icon: favicon(i.url), run: async () => { chrome.tabs.create({ url: i.url }); if (i.status === 'todo') await L.patch(i.id, { status: 'doing' }); } })),
    ...tasks.filter(t => !t.done).map(t => ({ kind: 'task', title: t.text, sub: 'Task · Enter to complete', run: async () => { await put('tasks', { ...t, done: true, doneAt: Date.now() }); toast('Task completed'); } }))
  ];
}

const LABEL = { action: 'Action', tab: 'Open tab', fav: '★ Favourite', saved: 'Saved', collection: 'Collection', later: 'Later', task: 'Task' };
const WEIGHT = { fav: 0, tab: 1, action: 2, collection: 3, later: 4, saved: 5, task: 6 };

function score(item, words) {
  const hay = `${item.title} ${item.sub || ''} ${LABEL[item.kind]}`.toLowerCase();
  let s = 0;
  for (const w of words) { const i = hay.indexOf(w); if (i < 0) return -1; s += i === 0 ? 0 : hay[i - 1] === ' ' ? 1 : 3; }
  return s * 10 + WEIGHT[item.kind];
}

// items to show with an empty query: favourites, then open tabs, then actions
function initial(items) {
  return [...items.filter(i => i.kind === 'fav' || (i.kind === 'collection' && i.starred)), ...items.filter(i => i.kind === 'action').slice(0, 6), ...items.filter(i => i.kind === 'tab').slice(0, 8)];
}

export async function mountPalette(root, { onDone = () => {}, autofocus = true } = {}) {
  root.innerHTML = `<div class="pal"><input type="search" class="pal-q" placeholder="Search tabs, saved, later, tasks - or type a command…" autocomplete="off"><ul class="pal-list"></ul></div>`;
  const input = root.querySelector('.pal-q');
  const list = root.querySelector('.pal-list');
  let items = await index();
  let shown = []; let sel = 0;
  const render = () => {
    const words = input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    shown = words.length ? items.map(i => [i, score(i, words)]).filter(([, s]) => s >= 0).sort((a, b) => a[1] - b[1]).map(([i]) => i).slice(0, 40) : initial(items);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.innerHTML = shown.map((i, n) => `<li class="${n === sel ? 'sel' : ''}" data-n="${n}">
      ${i.icon ? `<img src="${esc(i.icon)}" alt="" data-fb="hide">` : `<span class="pi">${i.kind === 'action' ? '›' : i.kind === 'task' ? '☐' : '▦'}</span>`}
      <span class="pt">${esc(i.title)}${i.sub ? `<small>${esc(i.sub)}</small>` : ''}</span><span class="pk">${LABEL[i.kind]}</span></li>`).join('') || '<li class="muted">No matches</li>';
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };
  const run = async i => { if (!i) return; await i.run(); onDone(i); };
  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); render(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
    if (e.key === 'Enter') { e.preventDefault(); run(shown[sel]); }
    if (e.key === 'Escape') onDone(null);
  });
  list.addEventListener('click', e => { const li = e.target.closest('[data-n]'); if (li) run(shown[Number(li.dataset.n)]); });
  render();
  if (autofocus) setTimeout(() => input.focus(), 30);
  return { refresh: async () => { items = await index(); render(); } };
}
export { uid };
