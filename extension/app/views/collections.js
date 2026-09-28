// Collections board (Toby-style): spaces on the left, collections of saved tabs in
// the middle, open tabs on the right. Drag open tabs into collections, drag cards
// between collections, drag collection headers to reorder.
import { $, $$, esc, h, toast, favicon, ask, confirmBox, downloadJson, pickFile } from '../../lib/ui.js';
import { get, set, getSettings, domainOf } from '../../lib/store.js';
import * as C from '../../lib/collections.js';
import * as Tabs from '../../lib/tabs.js';

const MIME = 'application/x-sumi';
let root; let space = null; let query = ''; let renderTimer = null;

export async function mount(el) {
  root = el;
  el.innerHTML = `
    <aside class="spaces">
      <div class="sec-h">Spaces <button class="ghost icon" id="add-space" title="New space">＋</button></div>
      <ul class="space-list" id="space-list"></ul>
    </aside>
    <section class="board">
      <header class="board-h">
        <input type="search" id="q" placeholder="Search saved tabs in every space…  ( / )" autocomplete="off">
        <button id="new-col">＋ Collection</button>
        <button id="save-win" class="primary" title="Save all tabs in this window as a collection (Alt+Shift+K)">Save window</button>
        <div class="menu-wrap"><button id="more" class="ghost">⋯</button>
          <div class="menu" id="more-menu" hidden>
            <button data-m="expand">Expand all</button><button data-m="collapse">Collapse all</button>
            <button data-m="import-toby">Import from Toby (.json)</button><button data-m="import-onetab">Import from OneTab (.txt)</button>
            <button data-m="export">Export this space (Toby format)</button>
          </div></div>
      </header>
      <div class="dropzone" id="dropzone">Drop a tab here to start a new collection</div>
      <div id="cols"></div>
    </section>
    <aside class="open-tabs">
      <div class="sec-h">Open tabs <span class="faint small" id="tab-count"></span></div>
      <div class="tools">
        <button data-t="dupes" title="Close duplicate tabs">Duplicates <b id="n-dupes"></b></button>
        <button data-t="group" title="Group this window's tabs by site">Group</button>
        <button data-t="sort" title="Sort this window's tabs by site">Sort</button>
        <button data-t="sleep" title="Unload inactive tabs to free memory">Sleep</button>
        <button data-t="stale" title="Save and close tabs you have not opened for days">Stale <b id="n-stale"></b></button>
        <button data-t="merge" title="Move all tabs into this window">Merge</button>
      </div>
      <input type="search" id="tq" placeholder="Filter open tabs…" autocomplete="off">
      <div id="wins"></div>
    </aside>`;

  const cfgSpace = await get('lastSpace', null);
  const sp = await C.spaces();
  space = sp.find(s => s.id === cfgSpace) || sp[0];

  $('#add-space').onclick = async () => { const n = await ask({ title: 'New space', value: '' }); if (n) { space = await C.addSpace(n); await set('lastSpace', space.id); render(); } };
  $('#new-col').onclick = async () => { const n = await ask({ title: 'New collection', value: '' }); if (n) { await C.addCollection(space.id, n); render(); } };
  $('#save-win').onclick = saveWindow;
  $('#q').addEventListener('input', e => { query = e.target.value; renderBoard(); });
  $('#tq').addEventListener('input', renderTabs);
  $('#more').onclick = () => { $('#more-menu').hidden = !$('#more-menu').hidden; };
  $('#more-menu').onclick = e => { const b = e.target.closest('[data-m]'); if (b) { $('#more-menu').hidden = true; menu(b.dataset.m); } };
  document.addEventListener('click', closeMenu);
  $('.tools').onclick = e => { const b = e.target.closest('[data-t]'); if (b) tool(b.dataset.t); };
  wireDrops();

  const onKey = e => {
    if (e.target.closest('input, textarea, dialog')) return;
    if (e.key === '/') { e.preventDefault(); $('#q').focus(); }
  };
  document.addEventListener('keydown', onKey);
  const onStore = (c, area) => { if (area === 'local' && (c.collections || c.cards || c.spaces)) schedule(); };
  chrome.storage.onChanged.addListener(onStore);
  const tabEvents = [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onMoved, chrome.tabs.onAttached];
  const onTabs = () => { clearTimeout(onTabs.t); onTabs.t = setTimeout(renderTabs, 250); };
  tabEvents.forEach(ev => ev.addListener(onTabs));

  await render();
  return () => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('click', closeMenu);
    chrome.storage.onChanged.removeListener(onStore);
    tabEvents.forEach(ev => ev.removeListener(onTabs));
  };
}
function closeMenu(e) { const m = $('#more-menu'); if (m && !e.target.closest('.menu-wrap')) m.hidden = true; }
const schedule = () => { clearTimeout(renderTimer); renderTimer = setTimeout(() => { renderSpaces(); renderBoard(); }, 80); };
async function render() { await renderSpaces(); await renderBoard(); await renderTabs(); }

// ---------------- spaces ----------------
async function renderSpaces() {
  const sp = await C.spaces();
  if (!sp.find(s => s.id === space?.id)) space = sp[0];
  const cols = await C.collections();
  $('#space-list').innerHTML = sp.map(s => `<li data-id="${s.id}" class="${s.id === space.id ? 'on' : ''}">
      <span class="t">${esc(s.name)}</span><span class="n">${cols.filter(c => c.spaceId === s.id).length}</span>
      <button class="ghost icon" data-a="rename" title="Rename">✎</button><button class="ghost icon" data-a="del" title="Delete">✕</button></li>`).join('');
  $('#space-list').onclick = async e => {
    const li = e.target.closest('li'); if (!li) return;
    const s = sp.find(x => x.id === li.dataset.id);
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'rename') { const n = await ask({ title: 'Rename space', value: s.name }); if (n) await C.renameSpace(s.id, n); }
    else if (a === 'del') {
      if (sp.length === 1) return toast('Keep at least one space');
      if (await confirmBox(`Delete space “${s.name}”?`, 'All its collections and saved tabs are deleted.')) await C.deleteSpace(s.id);
    } else { space = s; await set('lastSpace', s.id); }
    render();
  };
  // drop a collection on a space to move it there
  $$('#space-list li').forEach(li => {
    li.addEventListener('dragover', e => { if (isKind(e, 'collection')) { e.preventDefault(); li.classList.add('over'); } });
    li.addEventListener('dragleave', () => li.classList.remove('over'));
    li.addEventListener('drop', async e => {
      li.classList.remove('over');
      const d = data(e);
      if (d?.kind === 'collection') { e.preventDefault(); await C.patchCollection(d.id, { spaceId: li.dataset.id }); toast('Moved to space'); render(); }
    });
  });
}

// ---------------- board ----------------
async function renderBoard() {
  const box = $('#cols');
  if (!box) return;
  if (query.trim()) return renderSearch(box);
  $('#dropzone').hidden = false;
  const cols = await C.collections(space.id);
  const allCards = await C.cards();
  if (!cols.length) {
    box.innerHTML = `<div class="empty"><h3>${esc(space.name)} is empty</h3><p class="muted">Drag tabs from the right, click “Save window”, or import from Toby.</p></div>`;
    return;
  }
  box.innerHTML = cols.map(c => {
    const cs = allCards.filter(k => k.collectionId === c.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return `<article class="col ${c.collapsed ? 'collapsed' : ''}" data-col="${c.id}">
      <header draggable="true" data-drag-col="${c.id}">
        <button class="ghost icon chev" data-a="collapse" title="Collapse">${c.collapsed ? '▸' : '▾'}</button>
        <h3 data-a="rename" title="Click to rename">${esc(c.name)}</h3><span class="n">${cs.length}</span>
        <span class="sp"></span>
        <button class="ghost small" data-a="open" title="Open all tabs">Open ${cs.length > 1 ? 'all' : ''}</button>
        <button class="ghost small" data-a="window" title="Open all in a new window">New window</button>
        <button class="ghost small" data-a="add-current" title="Add the current tab">＋ Tab</button>
        <button class="ghost icon" data-a="del" title="Delete collection">✕</button>
      </header>
      <div class="cards" data-cards="${c.id}">
        ${cs.map(cardHtml).join('') || '<div class="hint">Drop tabs here</div>'}
      </div>
    </article>`;
  }).join('');
  wireBoard(cols, allCards);
}

function cardHtml(k) {
  const dom = domainOf(k.url) || k.url.split('/')[0];
  return `<div class="card-t" draggable="true" data-card="${k.id}" title="${esc(k.url)}">
    <img src="${esc(k.fav || favicon(k.url))}" alt="" loading="lazy" onerror="this.src='/icons/icon16.png'">
    <div class="ct"><div class="tt">${esc(k.title)}</div><div class="dd">${esc(k.note || dom)}</div></div>
    <div class="ca"><button class="ghost icon" data-ca="edit" title="Edit">✎</button><button class="ghost icon" data-ca="del" title="Remove">✕</button></div>
  </div>`;
}

function wireBoard(cols, allCards) {
  $('#cols').onclick = async e => {
    const card = e.target.closest('[data-card]');
    const colEl = e.target.closest('[data-col]');
    if (card) {
      const k = allCards.find(x => x.id === card.dataset.card);
      const a = e.target.closest('[data-ca]')?.dataset.ca;
      if (a === 'del') { await C.deleteCards(k.id); return; }
      if (a === 'edit') return editCard(k);
      return C.openCard(k, e.metaKey || e.ctrlKey ? 'new' : undefined);
    }
    if (!colEl) return;
    const c = cols.find(x => x.id === colEl.dataset.col);
    const a = e.target.closest('[data-a]')?.dataset.a;
    const cs = allCards.filter(k => k.collectionId === c.id).sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
    if (a === 'collapse') await C.patchCollection(c.id, { collapsed: !c.collapsed });
    if (a === 'rename') { const n = await ask({ title: 'Rename collection', value: c.name }); if (n) await C.patchCollection(c.id, { name: n }); }
    if (a === 'open') await C.openCards(cs);
    if (a === 'window') await C.openCards(cs, { newWindow: true });
    if (a === 'add-current') {
      const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const [other] = t && !/^chrome/.test(t.url) ? [t] : (await chrome.tabs.query({ lastFocusedWindow: true })).filter(x => !/^chrome/.test(x.url)).slice(-1);
      if (other) { await C.addCards(c.id, [other]); toast('Tab added'); } else toast('No web page to add');
    }
    if (a === 'del' && await confirmBox(`Delete “${c.name}”?`, `${cs.length} saved tab${cs.length === 1 ? '' : 's'} will be deleted.`)) await C.deleteCollection(c.id);
  };

  // drag sources
  $$('#cols [data-card]').forEach(el => el.addEventListener('dragstart', e => setData(e, { kind: 'card', id: el.dataset.card })));
  $$('#cols [data-drag-col]').forEach(el => el.addEventListener('dragstart', e => setData(e, { kind: 'collection', id: el.dataset.dragCol })));

  // drop targets: card grids (insert before the card under the pointer)
  $$('#cols [data-cards]').forEach(grid => {
    grid.addEventListener('dragover', e => { if (isKind(e, 'card', 'tab')) { e.preventDefault(); grid.classList.add('over'); marker(grid, e); } });
    grid.addEventListener('dragleave', e => { if (!grid.contains(e.relatedTarget)) { grid.classList.remove('over'); clearMarker(); } });
    grid.addEventListener('drop', async e => {
      e.preventDefault();
      grid.classList.remove('over');
      const index = dropIndex(grid, e);
      clearMarker();
      const d = data(e);
      if (!d) return;
      if (d.kind === 'card') await C.moveCard(d.id, grid.dataset.cards, index);
      if (d.kind === 'tab') { await C.addCards(grid.dataset.cards, [d.tab], index); if (e.altKey) chrome.tabs.remove(d.tab.id); }
    });
  });
  // collection reorder: drop a collection header on another collection
  $$('#cols .col').forEach(colEl => {
    colEl.addEventListener('dragover', e => { if (isKind(e, 'collection')) { e.preventDefault(); colEl.classList.add('col-over'); } });
    colEl.addEventListener('dragleave', e => { if (!colEl.contains(e.relatedTarget)) colEl.classList.remove('col-over'); });
    colEl.addEventListener('drop', async e => {
      const d = data(e);
      colEl.classList.remove('col-over');
      if (d?.kind !== 'collection' || d.id === colEl.dataset.col) return;
      e.preventDefault();
      const ids = cols.map(c => c.id).filter(id => id !== d.id);
      ids.splice(ids.indexOf(colEl.dataset.col), 0, d.id);
      await C.reorderCollections(ids);
    });
  });
}

async function renderSearch(box) {
  $('#dropzone').hidden = true;
  const res = await C.search(query);
  const sp = Object.fromEntries((await C.spaces()).map(s => [s.id, s.name]));
  box.innerHTML = `<div class="search-res"><div class="muted small">${res.length} saved tab${res.length === 1 ? '' : 's'} match</div>
    ${res.map(k => `<div class="card-t wide" data-card="${k.id}" title="${esc(k.url)}"><img src="${esc(k.fav || favicon(k.url))}" alt="" onerror="this.src='/icons/icon16.png'">
      <div class="ct"><div class="tt">${esc(k.title)}</div><div class="dd">${esc(domainOf(k.url) || '')} · ${esc(sp[k.collection.spaceId] || '')} › ${esc(k.collection.name)}</div></div></div>`).join('')}</div>`;
  box.onclick = async e => { const c = e.target.closest('[data-card]'); if (c) C.openCard(res.find(x => x.id === c.dataset.card)); };
}

async function editCard(k) {
  const d = h(`<dialog class="modal small"><form method="dialog">
    <h3>Edit saved tab</h3>
    <label class="small muted">Title</label><input type="text" name="t" value="${esc(k.title)}">
    <label class="small muted">URL</label><input type="text" name="u" value="${esc(k.url)}">
    <label class="small muted">Note</label><textarea name="n" rows="3">${esc(k.note || '')}</textarea>
    <div class="row end"><button value="cancel" class="ghost">Cancel</button><button value="ok" class="primary">Save</button></div></form></dialog>`);
  document.body.appendChild(d);
  d.addEventListener('close', async () => {
    if (d.returnValue === 'ok') await C.patchCard(k.id, { title: d.querySelector('[name=t]').value.trim() || k.url, url: d.querySelector('[name=u]').value.trim(), note: d.querySelector('[name=n]').value.trim() });
    d.remove();
  });
  d.showModal();
}

// ---------------- open tabs ----------------
async function renderTabs() {
  const wrap = $('#wins');
  if (!wrap) return;
  const q = ($('#tq').value || '').toLowerCase();
  const tabs = await chrome.tabs.query({});
  const me = (await chrome.tabs.getCurrent())?.id;
  const cur = (await chrome.windows.getCurrent()).id;
  const o = await Tabs.overview();
  $('#tab-count').textContent = `${o.count} in ${o.windows} window${o.windows === 1 ? '' : 's'}`;
  $('#n-dupes').textContent = o.dupes || '';
  $('#n-stale').textContent = o.stale || '';
  const wins = [...new Set(tabs.map(t => t.windowId))].sort((a, b) => (b === cur) - (a === cur));
  wrap.innerHTML = wins.map((w, i) => {
    const list = tabs.filter(t => t.windowId === w && t.id !== me && (!q || `${t.title} ${t.url}`.toLowerCase().includes(q)));
    if (!list.length) return '';
    return `<div class="win"><div class="win-h"><span>${w === cur ? 'This window' : `Window ${i + 1}`} · ${list.length}</span><span class="sp"></span>
      <button class="ghost small" data-save-win="${w}" title="Save these tabs as a collection">Save</button></div>
      ${list.map(t => `<div class="otab ${t.active ? 'act' : ''} ${t.discarded ? 'zz' : ''}" draggable="true" data-tab="${t.id}" title="${esc(t.url)}">
        <img src="${esc(t.favIconUrl || favicon(t.url))}" alt="" onerror="this.src='/icons/icon16.png'"><span class="t">${esc(t.title || t.url)}</span>
        <button class="ghost icon x" data-close="${t.id}" title="Close tab">✕</button></div>`).join('')}</div>`;
  }).join('');
  wrap.onclick = async e => {
    const x = e.target.closest('[data-close]'); if (x) { await chrome.tabs.remove(Number(x.dataset.close)); return; }
    const sw = e.target.closest('[data-save-win]'); if (sw) return saveWindow(Number(sw.dataset.saveWin));
    const t = e.target.closest('[data-tab]'); if (t) { const tab = tabs.find(y => y.id === Number(t.dataset.tab)); Tabs.focusTab(tab); }
  };
  $$('#wins [data-tab]').forEach(el => el.addEventListener('dragstart', e => {
    const t = tabs.find(y => y.id === Number(el.dataset.tab));
    setData(e, { kind: 'tab', tab: { id: t.id, url: t.url, title: t.title, favIconUrl: t.favIconUrl } });
  }));
}

async function saveWindow(windowId) {
  const w = typeof windowId === 'number' ? windowId : (await chrome.windows.getCurrent()).id;
  const tabs = (await chrome.tabs.query({ windowId: w })).filter(t => /^(https?|file):/.test(t.url));
  if (!tabs.length) return toast('No web pages in this window');
  const name = await ask({ title: `Save ${tabs.length} tabs`, text: 'Name for the new collection', value: `${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${domainOf(tabs[0].url) || 'tabs'}` });
  if (!name) return;
  const cfg = await getSettings();
  await C.saveTabs(space.id, name, tabs, { close: cfg.closeAfterSave });
  toast(`Saved ${tabs.length} tabs${cfg.closeAfterSave ? ' and closed them' : ''}`);
}

async function tool(t) {
  if (t === 'dupes') toast(`Closed ${await Tabs.closeDuplicates()} duplicate tabs`);
  if (t === 'group') toast(`Made ${await Tabs.groupByDomain()} tab groups`);
  if (t === 'sort') toast(`Sorted ${await Tabs.sortByDomain()} tabs`);
  if (t === 'sleep') toast(`${await Tabs.sleepInactive()} tabs put to sleep`);
  if (t === 'merge') toast(`Moved ${await Tabs.mergeWindows()} tabs into this window`);
  if (t === 'stale') {
    const n = (await Tabs.staleTabs()).length;
    const days = (await getSettings()).staleDays;
    if (!n) return toast(`No tabs untouched for ${days}+ days`);
    if (await ask({ title: `Close ${n} stale tabs?`, text: `Tabs not opened for ${days}+ days are saved to a collection first.`, ok: 'Save & close' })) toast(`Saved and closed ${await Tabs.closeStale()} tabs`);
  }
  renderTabs();
}

async function menu(m) {
  if (m === 'expand' || m === 'collapse') for (const c of await C.collections(space.id)) await C.patchCollection(c.id, { collapsed: m === 'collapse' });
  if (m === 'import-toby') {
    const text = await pickFile('.json,application/json');
    if (!text) return;
    try { const r = await C.importToby(JSON.parse(text), space.id); toast(`Imported ${r.collections} collections, ${r.cards} tabs`); } catch (e) { toast(e.message); }
  }
  if (m === 'import-onetab') {
    const text = await pickFile('.txt,text/plain');
    if (text) { const r = await C.importOneTab(text, space.id); toast(`Imported ${r.cards} tabs`); }
  }
  if (m === 'export') downloadJson(`sumi-${space.name}.json`, await C.exportToby(space.id));
}

// ---------------- drag & drop helpers ----------------
function setData(e, d) { e.dataTransfer.setData(MIME, JSON.stringify(d)); e.dataTransfer.setData(`${MIME}-${d.kind}`, '1'); e.dataTransfer.effectAllowed = 'copyMove'; document.body.classList.add('dragging'); }
document.addEventListener('dragend', () => { document.body.classList.remove('dragging'); clearMarker(); });
const isKind = (e, ...kinds) => kinds.some(k => e.dataTransfer.types.includes(`${MIME}-${k}`));
const data = e => { try { return JSON.parse(e.dataTransfer.getData(MIME)); } catch (err) { return null; } };
function dropIndex(grid, e) {
  const cards = $$('[data-card]', grid);
  for (let i = 0; i < cards.length; i += 1) {
    const r = cards[i].getBoundingClientRect();
    if (e.clientY < r.top) return i;                                          // pointer is on an earlier row
    if (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2) return i;   // same row, left half of the card
  }
  return cards.length;
}
function marker(grid, e) {
  clearMarker();
  const cards = $$('[data-card]', grid);
  const i = dropIndex(grid, e);
  const m = h('<div class="drop-marker"></div>');
  if (cards[i]) grid.insertBefore(m, cards[i]); else grid.appendChild(m);
}
function clearMarker() { $$('.drop-marker').forEach(m => m.remove()); }
function wireDrops() {
  const z = $('#dropzone');
  z.addEventListener('dragover', e => { if (isKind(e, 'tab', 'card')) { e.preventDefault(); z.classList.add('over'); } });
  z.addEventListener('dragleave', () => z.classList.remove('over'));
  z.addEventListener('drop', async e => {
    e.preventDefault();
    z.classList.remove('over');
    const d = data(e);
    const col = await C.addCollection(space.id, `New collection`);
    if (d?.kind === 'tab') await C.addCards(col.id, [d.tab]);
    if (d?.kind === 'card') await C.moveCard(d.id, col.id, 0);
  });
}
