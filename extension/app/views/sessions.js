// Sessions: automatic snapshots of every open window (every few minutes, when a
// window closes, at startup). Restore everything, one window, or save as a collection.
import { $, esc, toast, favicon, send } from '../../lib/ui.js';
import { get, set, getSettings } from '../../lib/store.js';
import { restoreSnapshot } from '../../lib/smart.js';
import * as C from '../../lib/collections.js';

export async function mount(el) {
  const cfg = await getSettings();
  el.innerHTML = `
    <header class="ins-h"><h2 class="page-h">Sessions</h2><span class="muted small">All windows are saved every ${cfg.snapshotMin} minutes, when a window closes and when Chrome starts. The last 30 are kept on this computer.</span>
      <span class="sp"></span><button id="now" class="primary">Snapshot now</button></header>
    <div id="snaps"></div>`;
  $('#now').onclick = async () => { await send({ type: 'snapshot' }); toast('Snapshot saved'); render(); };
  const onStore = (c, a) => { if (a === 'local' && c.snapshots) render(); };
  chrome.storage.onChanged.addListener(onStore);
  render();
  return () => chrome.storage.onChanged.removeListener(onStore);
}

async function render() {
  const snaps = await get('snapshots', []);
  $('#snaps').innerHTML = snaps.map((s, i) => `<section class="card snap" data-i="${i}">
    <div class="row"><b>${new Date(s.at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</b>
      <span class="chip">${esc(s.reason)}</span><span class="muted small">${s.count} tabs · ${s.windows.length} window${s.windows.length === 1 ? '' : 's'}</span><span class="sp"></span>
      <button data-a="all" class="primary small">Restore all</button><button data-a="save" class="small">Save as collections</button><button data-a="del" class="ghost icon" title="Delete">✕</button></div>
    ${s.windows.map((w, wi) => `<details><summary>Window ${wi + 1} · ${w.length} tabs <button class="ghost small" data-a="win" data-w="${wi}">Restore this window</button></summary>
      <ul class="snap-tabs">${w.map(t => `<li><img src="${esc(t.fav || favicon(t.url))}" alt="" onerror="this.style.visibility='hidden'"><a href="${esc(t.url)}" target="_blank">${esc(t.title || t.url)}</a></li>`).join('')}</ul></details>`).join('')}
  </section>`).join('') || '<div class="empty"><h3>No snapshots yet</h3><p class="muted">The first one is taken within a few minutes.</p></div>';
  $('#snaps').onclick = async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    e.preventDefault();
    const card = e.target.closest('[data-i]');
    const s = snaps[Number(card.dataset.i)];
    if (b.dataset.a === 'all') await restoreSnapshot(s);
    if (b.dataset.a === 'win') await restoreSnapshot(s, Number(b.dataset.w));
    if (b.dataset.a === 'save') {
      const [space] = await C.spaces();
      for (const [wi, w] of s.windows.entries()) await C.saveTabs(space.id, `Session ${new Date(s.at).toLocaleDateString()} · window ${wi + 1}`, w, { close: false });
      toast(`Saved ${s.windows.length} collection${s.windows.length === 1 ? '' : 's'}`);
    }
    if (b.dataset.a === 'del') { await set('snapshots', snaps.filter(x => x !== s)); }
  };
}
