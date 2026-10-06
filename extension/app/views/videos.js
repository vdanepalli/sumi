// Videos: watch stats for videos you chose to track from the floating video
// overlay (◉ Track). Real time spent, how much of the video you have actually seen,
// pauses, rewinds, skips, speed, sittings, and a timeline of what happened.
import { $, esc, dur, favicon, toast, confirmBox } from '../../lib/ui.js';
import { all, put, remove, daysAgo, safeUrl } from '../../lib/store.js';

let state = { filter: 'active', q: '' };
const open = new Set();   // ids with details expanded

const clock = s => {
  s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};
const when = t => {
  const d = new Date(t); const days = Math.floor((Date.now() - t) / 86400000);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (new Date().toDateString() === d.toDateString()) return `today ${time}`;
  if (days < 6) return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};
const seenOf = v => Math.min(100, Math.round((100 * (v.covered || 0)) / (v.duration || 1)));
const resumeUrl = v => (v.yt ? `https://www.youtube.com/watch?v=${encodeURIComponent(v.yt)}${v.position > 5 ? `&t=${Math.round(v.position)}s` : ''}` : safeUrl(v.url) ? v.url : '#');

export async function mount(el) {
  el.innerHTML = `
    <header class="vid-h">
      <div class="seg" id="filters"><button data-f="active">In progress</button><button data-f="done">Finished</button><button data-f="all">All</button></div>
      <input type="search" id="q" placeholder="Search videos…" autocomplete="off">
    </header>
    <div class="kpis big" id="kpis"></div>
    <div id="list"></div>`;
  $('#filters').onclick = e => { const b = e.target.closest('[data-f]'); if (b) { state.filter = b.dataset.f; render(); } };
  $('#q').oninput = e => { state.q = e.target.value.toLowerCase(); render(); };
  $('#list').onclick = onClick;
  await render();
  const onChange = (c, area) => { if (area === 'local' && c.videos) render(); };
  chrome.storage.onChanged.addListener(onChange);
  return () => chrome.storage.onChanged.removeListener(onChange);
}

async function render() {
  const vids = (await all('videos')).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  for (const b of document.querySelectorAll('#filters button')) b.setAttribute('aria-pressed', b.dataset.f === state.filter);

  const week = new Set(Array.from({ length: 7 }, (_, i) => daysAgo(i)));
  const weekSec = vids.reduce((n, v) => n + Object.entries(v.days || {}).filter(([d]) => week.has(d)).reduce((m, [, s]) => m + s, 0), 0);
  const totalSec = vids.reduce((n, v) => n + (v.watchedSec || 0), 0);
  const played = vids.reduce((n, v) => n + (v.playedSec || 0), 0);
  $('#kpis').innerHTML = `
    <div class="kpi"><span>Watched this week</span><b>${dur(weekSec)}</b><small>${dur(totalSec)} all time</small></div>
    <div class="kpi"><span>Videos tracked</span><b>${vids.length}</b><small>${vids.filter(v => v.tracking && !v.completedAt).length} in progress</small></div>
    <div class="kpi"><span>Finished</span><b>${vids.filter(v => v.completedAt).length}</b><small>95% or more seen</small></div>
    <div class="kpi"><span>Average speed</span><b>${totalSec ? (played / totalSec).toFixed(2) + '×' : '–'}</b><small>${played > totalSec ? dur(played - totalSec) + ' saved' : 'video time / real time'}</small></div>`;

  const list = vids.filter(v => (state.filter === 'all' || (state.filter === 'done' ? v.completedAt : !v.completedAt))
    && (!state.q || `${v.title} ${v.site}`.toLowerCase().includes(state.q)));
  $('#list').innerHTML = list.map(card).join('') || `<div class="empty"><h3>${vids.length ? 'Nothing here' : 'No tracked videos yet'}</h3>
    <p class="muted">${vids.length ? 'Try another filter.' : 'Open a video (YouTube or any site), and on the Sumi progress overlay click <b>◉ Track this video</b>.<br>Sumi then records real time watched, pauses, rewinds, skips and what you have seen.'}</p></div>`;
}

function card(v) {
  const seen = seenOf(v);
  const thumb = v.yt ? `https://i.ytimg.com/vi/${encodeURIComponent(v.yt)}/mqdefault.jpg` : favicon(v.url);
  const speed = v.watchedSec > 30 ? v.playedSec / v.watchedSec : 1;
  const rewatched = Math.max(0, (v.playedSec || 0) - (v.covered || 0));
  const stat = (label, val, sub = '') => `<div><span>${label}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  return `<section class="card vid" data-id="${esc(v.id)}">
    <div class="vid-top">
      <a class="thumb${v.yt ? '' : ' fav'}" href="${esc(resumeUrl(v))}" target="_blank" title="Resume at ${clock(v.position || 0)}"><img src="${esc(thumb)}" alt="" data-fb="hide"><i>▶</i></a>
      <div class="vid-main">
        <a class="vt" href="${esc(resumeUrl(v))}" target="_blank">${esc(v.title || v.url)}</a>
        <div class="small muted">${esc(v.site || '')} · ${clock(v.duration)} · last watched ${when(v.lastAt || v.created)}
          ${v.completedAt ? '<span class="chip good">Finished</span>' : v.tracking ? '<span class="chip">Tracking</span>' : '<span class="chip">Not tracking</span>'}</div>
        <div class="cover" title="Parts you have seen · white line = where you are">
          ${(v.segs || []).map(([a, b]) => `<i style="left:${(100 * a) / v.duration}%;width:${Math.max(0.3, (100 * (b - a)) / v.duration)}%"></i>`).join('')}
          <b style="left:${(100 * (v.position || 0)) / v.duration}%"></b>
        </div>
        <div class="small faint">At ${clock(v.position || 0)} of ${clock(v.duration)} · ${seen}% seen · ${clock(Math.max(0, v.duration - (v.covered || 0)))} not seen yet</div>
      </div>
      <div class="vid-act">
        <button data-a="details" class="ghost small">${open.has(v.id) ? 'Hide details' : 'Details'}</button>
        <button data-a="track" class="ghost small">${v.tracking ? 'Stop tracking' : 'Track again'}</button>
        <button data-a="del" class="ghost icon" title="Delete this video's stats">✕</button>
      </div>
    </div>
    <div class="vid-stats">
      ${stat('Time spent', dur(v.watchedSec || 0), `${v.sittings || 0} sitting${v.sittings === 1 ? '' : 's'}`)}
      ${stat('Seen', seen + '%', `${dur(v.covered || 0)} of ${dur(v.duration)}`)}
      ${stat('Paused', v.pauses || 0, `${dur(v.pausedSec || 0)} in total`)}
      ${stat('Rewinds', v.rewinds || 0, `${dur(v.rewindSec || 0)} back`)}
      ${stat('Skips', v.skips || 0, `${dur(v.skipSec || 0)} ahead`)}
      ${stat('Speed', speed.toFixed(2) + '×', rewatched > 60 ? `${dur(rewatched)} rewatched` : 'average')}
    </div>
    ${open.has(v.id) ? details(v) : ''}
  </section>`;
}

function details(v) {
  const days = Object.entries(v.days || {}).sort((a, b) => b[0].localeCompare(a[0]));
  const max = Math.max(1, ...days.map(([, s]) => s));
  const label = e => e.k === 'pause' ? `Paused at <b>${clock(e.t)}</b>${e.dur ? ` for ${dur(e.dur)}` : ''}`
    : e.k === 'rewind' ? `Rewound <b>${clock(e.from)} → ${clock(e.to)}</b> (${dur(e.from - e.to)} back)`
      : e.k === 'skip' ? `Skipped <b>${clock(e.from)} → ${clock(e.to)}</b> (${dur(e.to - e.from)} ahead)`
        : 'Finished (95% seen)';
  const ev = (v.events || []).slice(-80).reverse();
  return `<div class="vid-more">
    <div><h4>By day</h4>${days.map(([d, s]) => `<div class="vday"><span>${new Date(d + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span><i style="width:${(100 * s) / max}%"></i><b>${dur(s)}</b></div>`).join('') || '<p class="faint small">Nothing yet</p>'}</div>
    <div><h4>What happened <span class="faint small">(newest first; pauses over 30 min count as breaks)</span></h4>
      <ul class="vev">${ev.map(e => `<li class="${e.k}"><span>${label(e)}</span><time>${when(e.at)}</time></li>`).join('') || '<li class="faint">No pauses, rewinds or skips yet</li>'}</ul></div>
  </div>`;
}

async function onClick(e) {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const id = b.closest('[data-id]').dataset.id;
  const v = (await all('videos')).find(x => x.id === id);
  if (!v) return;
  if (b.dataset.a === 'details') { open.has(id) ? open.delete(id) : open.add(id); render(); }
  if (b.dataset.a === 'track') { await put('videos', { ...v, tracking: !v.tracking }); toast(v.tracking ? 'Stopped tracking - stats kept' : 'Tracking again next time you watch it'); }
  if (b.dataset.a === 'del' && await confirmBox('Delete this video\'s stats?', v.title)) { await remove('videos', id); toast('Deleted'); }
}
