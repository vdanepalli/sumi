// Command palette: one search over open tabs, favourites, saved tabs, collections,
// Later, tasks and actions. ↑/↓ to move, Enter to run, Esc to close.
// Developer extras: "ENG-421", "#482" / "pr 482", "acme/api" find that PR / ticket / repo
// (open tab first, else opens it); quicklinks "gh acme/api", "npm react" (Settings).
import { esc, favicon, send, toast } from './ui.js';
import { all, put, uid, domainOf, safeUrl, getSettings } from './store.js';
import * as D from './dev.js';
import * as C from './collections.js';
import * as Tabs from './tabs.js';
import * as L from './later.js';

const activeTab = async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
const copy = async (text, what) => { await navigator.clipboard.writeText(text); toast(`Copied ${what}`); };
// the tabs a "task" is: the active tab's group, else the tabs of the same repo / ticket, else the window
async function taskTabs() {
  const t = await activeTab();
  if (!t) return null;
  const web = list => list.filter(x => /^(https?|file):/.test(x.url || '') && !x.pinned);
  if (t.groupId > -1) {
    const g = await chrome.tabGroups.get(t.groupId).catch(() => null);
    return { tabs: web(await chrome.tabs.query({ groupId: t.groupId })), name: g?.title || 'Tab group', group: g ? { title: g.title, color: g.color } : null, what: 'tab group' };
  }
  const e = D.entity(t.url); const win = await chrome.tabs.query({ windowId: t.windowId });
  if (e && e.kind !== 'local') {
    const same = web(win.filter(x => { const f = D.entity(x.url); return f && (f.key === e.key || (e.repo && f.host === e.host && f.repo === e.repo)); }));
    return { tabs: same, name: (e.kind === 'pr' ? 'PR ' : e.kind === 'issue' ? 'Issue ' : '') + e.label, what: e.label };
  }
  return { tabs: web(win), name: `${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${t.title || 'window'}`.slice(0, 80), what: 'this window' };
}

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
  ['Save all windows as a new space (end of day)', 'tabs', async () => {
    const r = await C.saveAllWindows(`Saved ${new Date().toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`);
    toast(r ? `Saved ${r.tabs} tabs from ${r.windows} windows` : 'No web pages open');
  }],
  ['Save this page to Later', 'later', async () => {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (t && /^https?:/.test(t.url)) { await L.add({ url: t.url, title: t.title }); toast('Saved to Later'); }
  }],
  ['Park this task (save its tabs + a note, close them)', 'tabs', async () => {
    const k = await taskTabs();
    if (!k?.tabs.length) throw new Error('No web pages to park');
    return { ask: `Note for when you come back (optional) · Enter parks ${k.tabs.length} tab${k.tabs.length === 1 ? '' : 's'} of ${k.what}`,
      then: async note => { await C.park(k.tabs, k.name, note, k.group); toast(`Parked ${k.name}`); } };
  }],
  ['Copy this tab as a Markdown link', 'tabs', async () => { const t = await activeTab(); if (t) await copy(D.mdLink(t), 'link'); }],
  ['Copy tabs as Markdown (tab group or window)', 'tabs', async () => { const k = await taskTabs(); if (k?.tabs.length) await copy(D.mdList(k.tabs), `${k.tabs.length} links`); }],
  ['Close duplicate tabs (keeps one of each)', 'tabs', async () => toast(`Closed ${await Tabs.closeDuplicates()} duplicates`)],
  ['Group tabs by site', 'tabs', async () => toast(`Made ${await Tabs.groupByDomain()} groups`)],
  ['Sort tabs by site', 'tabs', async () => toast(`Sorted ${await Tabs.sortByDomain()} tabs`)],
  ['Put inactive tabs to sleep', 'tabs', async () => toast(`${await Tabs.sleepInactive()} tabs asleep`)],
  ['Merge all windows', 'tabs', async () => toast(`Moved ${await Tabs.mergeWindows()} tabs`)],
  ['Show / hide video progress on this page', 'tabs', async () => {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const r = (await send({ type: 'video-toggle', tabId: t?.id })).data;
    if (!r?.ok) throw new Error(r?.error || 'No video on this page');
  }],
  ['Snapshot all windows now', 'tabs', async () => { await send({ type: 'snapshot' }); toast('Snapshot saved'); }],
  ['Go to Collections', 'nav', app('#collections').run], ['Go to Later', 'nav', app('#later').run], ['Go to Focus', 'nav', app('#focus').run],
  ['Go to Insights', 'nav', app('#insights').run], ['Go to Sessions (restore)', 'nav', app('#sessions').run], ['Go to Tasks', 'nav', app('#tasks').run],
  ['Go to Settings', 'nav', app('#settings').run]
].map(([t, k, run]) => ({ kind: 'action', group: k, title: t, run }));

async function index() {
  const [tabs, cards, cols, later, tasks, { snoozed = {} }] = await Promise.all([chrome.tabs.query({}), C.cards(), C.collections(), L.items(), all('tasks'), chrome.storage.local.get('snoozed')]);
  const self = (await chrome.tabs.getCurrent?.())?.id;
  const colName = Object.fromEntries(cols.map(c => [c.id, c.name]));
  return [
    ...cols.filter(c => c.parked).map(c => ({ kind: 'parked', title: `Resume: ${c.name}`, sub: c.parked.note || 'Parked task', run: () => C.resume(c) })),
    ...ACTIONS,
    ...[['Plan today', '#plan'], ['Shut down for the day (review, save and close tabs)', '#shutdown']].map(([title, hash]) => ({ kind: 'action', group: 'plan', title, run: app(hash).run })),
    ...L.SNOOZE.map(([k, label]) => { const at = L.snoozeAt(k); return { kind: 'action', group: 'tabs', title: `Snooze this tab: ${label.toLowerCase()}`, sub: L.whenLabel(at),
      run: async () => { const t = await activeTab(); const r = await send({ type: 'snooze', tabId: t?.id, until: at }); if (!r.ok) throw new Error(r.error); toast(`Snoozed until ${L.whenLabel(at)}`); } }; }),
    ...Object.entries(snoozed).map(([id, s]) => ({ kind: 'snoozed', title: s.title, sub: `back ${L.whenLabel(s.until)} · Enter opens it now`, url: s.url, icon: favicon(s.url), run: () => send({ type: 'wake', id }) })),
    ...tabs.filter(t => t.id !== self).map(t => ({ kind: 'tab', title: t.title || t.url, sub: D.entity(t.url)?.label || domainOf(t.url) || t.url, url: t.url, ent: D.entity(t.url), icon: t.favIconUrl || favicon(t.url), run: () => Tabs.focusTab(t) })),
    ...cards.map(k => ({ kind: k.starred ? 'fav' : 'saved', title: k.title, sub: `${colName[k.collectionId] || ''} · ${domainOf(k.url) || ''}`, url: k.url, ent: D.entity(k.url), icon: k.fav || favicon(k.url), run: () => C.openCard(k, 'new') })),
    ...cols.filter(c => !c.parked).map(c => ({ kind: 'collection', title: c.name, sub: 'Open all tabs', starred: c.starred, run: async () => C.openCards(await C.cards(c.id)) })),
    ...later.filter(i => i.status !== 'done').map(i => ({ kind: 'later', title: i.title, minutes: Number(i.minutes) || 0, item: i, sub: `${L.KINDS[i.kind]}${i.minutes ? ` · ${i.minutes} min` : ''}${i.due ? ' · ' + L.relTime(i.due) : ''}`, icon: favicon(i.url), run: async () => { if (!safeUrl(i.url)) return; if (i.status === 'todo') await L.patch(i.id, { status: 'doing' }); await chrome.tabs.create({ url: i.url }); } })),
    ...tasks.filter(t => !t.done).map(t => ({ kind: 'task', title: t.text, sub: 'Task · Enter to complete', run: async () => { await put('tasks', { ...t, done: true, doneAt: Date.now() }); toast('Task completed'); } }))
  ];
}

const LABEL = { snoozed: 'Snoozed', parked: 'Parked', link: 'Open', action: 'Action', tab: 'Open tab', fav: '★ Favourite', saved: 'Saved', collection: 'Collection', later: 'Later', task: 'Task' };
const WEIGHT = { snoozed: 3, parked: 0, link: 0, fav: 0, tab: 1, action: 2, collection: 3, later: 4, saved: 5, task: 6 };

function score(item, words) {
  const hay = `${item.title} ${item.sub || ''} ${LABEL[item.kind]}`.toLowerCase();
  let s = 0;
  for (const w of words) { const i = hay.indexOf(w); if (i < 0) return -1; s += i === 0 ? 0 : hay[i - 1] === ' ' ? 1 : 3; }
  return s * 10 + WEIGHT[item.kind];
}

// items to show with an empty query: favourites, then open tabs, then actions
function initial(items) {
  return [...items.filter(i => i.kind === 'parked'), ...items.filter(i => i.kind === 'fav' || (i.kind === 'collection' && i.starred)), ...items.filter(i => i.kind === 'action').slice(0, 6), ...items.filter(i => i.kind === 'tab').slice(0, 8)];
}

// exact developer matches for a query, best first: quicklink, then the open / saved PR / ticket / repo,
// else a row that opens it (ticket bases and the repo are learned from your tabs)
function devMatches(raw, items, links, ctx) {
  const q = raw.trim(); const out = [];
  // "+ call the dentist !today": add a task (optionally with this page's link)
  if (q.startsWith('+') && q.slice(1).trim()) {
    const text0 = q.slice(1).trim();
    const add = withPage => async () => {
      const high = /(^|\s)!high\b/i.test(text0); const today = /(^|\s)!today\b/i.test(text0);
      const text = text0.replace(/(^|\s)!(high|today)\b/gi, ' ').replace(/\s+/g, ' ').trim();
      if (!text) throw new Error('Type the task after +');
      const t = withPage ? await activeTab() : null;
      await put('tasks', { id: uid(), text, done: false, high, today, created: Date.now(), order: -Date.now() / 1000, ...(t && /^https?:/.test(t.url) ? { url: t.url, urlTitle: t.title || '' } : {}) });
      toast('Task added');
    };
    return [{ kind: 'action', title: `Add task: ${text0}`, sub: '!high / !today work too', run: add(false) },
      { kind: 'action', title: `Add task with this page: ${text0}`, sub: 'links the current tab', run: add(true) }];
  }
  // "20 min": Later items that fit in the time you have (in progress first, then by deadline)
  const gap = Number((/^(\d{1,3})\s*m(in(ute)?s?)?$/i.exec(q) || [])[1]);
  if (gap) {
    const fits = items.filter(i => i.kind === 'later' && i.minutes && i.minutes <= gap)
      .sort((a, b) => (b.item.status === 'doing') - (a.item.status === 'doing') || (a.item.due || Infinity) - (b.item.due || Infinity) || b.minutes - a.minutes);
    return fits.length ? fits : [{ kind: 'action', title: `Nothing in Later fits ${gap} min`, sub: 'times are estimated when you save a page', run: () => {} }];
  }
  const [w0, ...rest] = q.split(/\s+/); const arg = rest.join(' ');
  if (links[w0?.toLowerCase()] && arg) { const url = D.fillLink(links[w0.toLowerCase()], arg); out.push({ kind: 'link', title: `${w0.toLowerCase()} ${arg}`, sub: url, run: () => chrome.tabs.create({ url }) }); }
  const uniq = list => { const seen = new Set(); return list.filter(i => !seen.has(i.ent.key) && seen.add(i.ent.key)); };
  const withEnt = items.filter(i => i.ent);
  if (D.isTicketKey(q)) {
    const k = q.toUpperCase();
    const hits = uniq(withEnt.filter(i => i.ent.key === 'ticket:' + k));
    out.push(...hits);
    if (!hits.length) {
      const bases = withEnt.filter(i => i.ent.base);
      const base = (bases.find(i => i.ent.n.split('-')[0] === k.split('-')[0]) || bases[0])?.ent.base;
      if (base) out.push({ kind: 'link', title: k, sub: base + k, run: () => chrome.tabs.create({ url: base + k }) });
    }
  }
  const num = (/^(?:#|!|pr\s*|mr\s*|issue\s*)(\d{1,7})$/i.exec(q) || [])[1];
  if (num) {
    const hits = uniq(withEnt.filter(i => (i.ent.kind === 'pr' || i.ent.kind === 'issue') && i.ent.n === num).sort((a, b) => (b.ent.repo === ctx?.repo) - (a.ent.repo === ctx?.repo)));
    out.push(...hits);
    if (!hits.some(i => i.ent.repo === ctx?.repo) && ctx?.repo) {
      const pr = /^(pr|mr|!)/i.test(q);
      const url = ctx.host === 'gh' ? `https://github.com/${ctx.repo}/${pr ? 'pull' : 'issues'}/${num}`
        : ctx.host === 'bb' ? `https://bitbucket.org/${ctx.repo}/${pr ? 'pull-requests' : 'issues'}/${num}`
          : `${ctx.canonical}/-/${pr ? 'merge_requests' : 'issues'}/${num}`;
      out.push({ kind: 'link', title: `${ctx.repo}${pr && ctx.host.startsWith('gl') ? '!' : '#'}${num}`, sub: url, run: () => chrome.tabs.create({ url }) });
    }
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(q)) out.push(...uniq(withEnt.filter(i => i.ent.kind === 'repo' && i.ent.repo.toLowerCase() === q.toLowerCase())));
  return out;
}
// the repo you are working in: the active tab's, else the one most open tabs belong to
function repoContext(items, active) {
  const a = D.entity(active?.url || '');
  if (a?.repo) return { host: a.host, repo: a.repo, canonical: a.canonical.split('/-/')[0] };
  const n = {};
  for (const i of items) if (i.kind === 'tab' && i.ent?.repo) n[i.ent.host + ' ' + i.ent.repo] = (n[i.ent.host + ' ' + i.ent.repo] || 0) + 1;
  const top = Object.entries(n).sort((x, y) => y[1] - x[1])[0]?.[0];
  if (!top) return null;
  const e = items.find(i => i.ent && i.ent.host + ' ' + i.ent.repo === top).ent;
  return { host: e.host, repo: e.repo, canonical: e.canonical.split('/-/')[0].replace(/\/(pull|issues|commit|actions|pull-requests|pipelines)(\/.*)?$/, '') };
}

export async function mountPalette(root, { onDone = () => {}, autofocus = true } = {}) {
  root.innerHTML = `<div class="pal"><input type="search" class="pal-q" placeholder="Search tabs, saved, later, actions…" autocomplete="off"><ul class="pal-list"></ul></div>`;
  const input = root.querySelector('.pal-q');
  const list = root.querySelector('.pal-list');
  let items = await index();
  const links = D.quicklinks((await getSettings()).quicklinks);
  const ctx = repoContext(items, await activeTab().catch(() => null));
  let shown = []; let sel = 0;
  let ask = null; // an action waiting for text (e.g. the note when parking a task)
  const placeholder = input.placeholder;
  const render = () => {
    if (ask) { list.innerHTML = `<li class="muted">${esc(ask.ask)} · Esc to cancel</li>`; return; }
    const words = input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const dev = words.length ? devMatches(input.value, items, links, ctx) : [];
    shown = words.length ? [...dev, ...items.map(i => [i, score(i, words)]).filter(([i, s]) => s >= 0 && !dev.includes(i)).sort((a, b) => a[1] - b[1]).map(([i]) => i)].slice(0, 40) : initial(items);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.innerHTML = shown.map((i, n) => `<li class="${n === sel ? 'sel' : ''}" data-n="${n}">
      ${i.icon ? `<img src="${esc(i.icon)}" alt="" data-fb="hide">` : `<span class="pi">${i.kind === 'action' ? '›' : i.kind === 'task' ? '☐' : i.kind === 'link' ? '↗' : i.kind === 'parked' ? '⏸' : '▦'}</span>`}
      <span class="pt">${esc(i.title)}${i.sub ? `<small>${esc(i.sub)}</small>` : ''}</span><span class="pk">${LABEL[i.kind]}</span></li>`).join('') || '<li class="muted">No matches</li>';
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };
  const endAsk = () => { ask = null; input.value = ''; input.placeholder = placeholder; render(); };
  const run = async i => {
    if (!i) return;
    try {
      const r = await i.run();
      if (r?.ask) { ask = r; input.value = ''; input.placeholder = r.ask; render(); input.focus(); return; }
    } catch (e) { toast(e.message || 'That did not work'); return; }
    onDone(i);
  };
  const answer = async () => { const a = ask; try { await a.then(input.value); } catch (e) { toast(e.message || 'That did not work'); } endAsk(); onDone(a); };
  input.addEventListener('input', () => { if (!ask) { sel = 0; render(); } });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); render(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
    if (e.key === 'Enter' && ask) { e.preventDefault(); answer(); return; }
    if (e.key === 'Escape' && ask) { e.preventDefault(); endAsk(); return; }
    if (e.key === 'Enter') { e.preventDefault(); run(shown[sel]); }
    if (e.key === 'Escape') { e.preventDefault(); if (input.value) { input.value = ''; sel = 0; render(); } else onDone(null); }
  });
  list.addEventListener('click', e => { const li = e.target.closest('[data-n]'); if (li) run(shown[Number(li.dataset.n)]); });
  render();
  if (autofocus) setTimeout(() => input.focus(), 30);
  return { refresh: async () => { items = await index(); render(); } };
}
export { uid };
