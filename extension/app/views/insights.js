// Insights: time per website, kept for as long as you use Sumi (all devices when
// signed in). Ranges from today to all time, per-day / week / month chart, a year
// heatmap, a full per-site table, CSV export and per-site deletion.
import { $, $$, esc, dur, favicon, send, toast, confirmBox } from '../../lib/ui.js';
import { update, dayKey, daysAgo, deviceId } from '../../lib/store.js';
import { allDevices } from '../../lib/sync.js';

const RANGES = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['year', 'This year'], ['all', 'All time'], ['custom', 'Custom']];
let state = { range: '7', from: daysAgo(6), to: dayKey(), device: 'all', q: '', show: 25 };
let data = {}; // day -> {domain: secs} (merged over selected devices)

export async function mount(el) {
  el.innerHTML = `
    <header class="ins-h">
      <div class="seg" id="ranges">${RANGES.map(([k, l]) => `<button data-r="${k}">${l}</button>`).join('')}</div>
      <span class="custom" id="custom" hidden><input type="date" id="from"> – <input type="date" id="to"></span>
      <span class="sp"></span>
      <select id="device"><option value="all">All devices</option><option value="this">This device</option></select>
      <button id="csv" class="ghost">Export CSV</button>
    </header>
    <div class="kpis big" id="kpis"></div>
    <section class="card"><h2>Time per <span id="bucket">day</span></h2><div class="chart" id="chart"></div></section>
    <section class="card"><h2>Last 12 months</h2><div class="heat" id="heat"></div><div class="small faint" id="heat-cap"></div></section>
    <section class="card">
      <h2>Sites <span class="sp"></span><input type="search" id="site-q" placeholder="Filter sites…"></h2>
      <table class="sites"><thead><tr><th></th><th>Site</th><th class="barcol"></th><th>Time</th><th>Share</th><th>Days</th><th>Avg/day</th><th></th></tr></thead><tbody id="sites"></tbody></table>
      <div class="center-t"><button class="ghost" id="more" hidden>Show more</button></div>
    </section>`;

  $('#ranges').onclick = e => { const b = e.target.closest('[data-r]'); if (b) { setRange(b.dataset.r); render(); } };
  $('#from').onchange = $('#to').onchange = () => { state.from = $('#from').value; state.to = $('#to').value; render(); };
  $('#device').onchange = async e => { state.device = e.target.value; await load(); render(); };
  $('#site-q').oninput = e => { state.q = e.target.value.toLowerCase(); state.show = 25; renderSites(); };
  $('#more').onclick = () => { state.show += 50; renderSites(); };
  $('#csv').onclick = exportCsv;
  $('#sites').onclick = async e => {
    const b = e.target.closest('[data-del]');
    if (b && await confirmBox(`Delete all history for ${b.dataset.del}?`, 'This removes it from every day on this device.')) {
      await update('usage', {}, u => { for (const d of Object.keys(u)) { if (u[d][b.dataset.del]) { u[d] = { ...u[d] }; delete u[d][b.dataset.del]; } } return u; });
      toast('Deleted'); await load(); render();
    }
  };
  await send({ type: 'flush' });
  setRange(state.range);
  await load();
  render();
  const iv = setInterval(async () => { await send({ type: 'flush' }); await load(); render(); }, 60000);
  return () => clearInterval(iv);
}

function setRange(r) {
  state.range = r;
  const t = dayKey();
  const map = { today: [t, t], yesterday: [daysAgo(1), daysAgo(1)], 7: [daysAgo(6), t], 30: [daysAgo(29), t], 90: [daysAgo(89), t], year: [`${new Date().getFullYear()}-01-01`, t] };
  if (map[r]) [state.from, state.to] = map[r];
  if (r === 'all') { const ks = Object.keys(data).sort(); state.from = ks[0] || t; state.to = t; }
  $$('#ranges button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.r === r)));
  $('#custom').hidden = r !== 'custom';
  $('#from').value = state.from; $('#to').value = state.to;
}

async function load() {
  const devs = await allDevices('usage');
  const me = await deviceId();
  data = {};
  for (const [dev, days] of Object.entries(devs)) {
    if (state.device === 'this' && dev !== me) continue;
    for (const [d, sites] of Object.entries(days)) {
      const tgt = (data[d] = data[d] || {});
      for (const [dom, s] of Object.entries(sites)) tgt[dom] = (tgt[dom] || 0) + s;
    }
  }
  if (state.range === 'all') setRange('all');
}

const inRange = d => d >= state.from && d <= state.to;
function daysBetween(a, b) {
  const out = [];
  const d = new Date(a + 'T12:00');
  const end = new Date(b + 'T12:00');
  while (d <= end && out.length < 4000) { out.push(dayKey(d)); d.setDate(d.getDate() + 1); }
  return out;
}

function render() { renderKpis(); renderChart(); renderHeat(); renderSites(); }

function totals() {
  const t = {}; const days = {};
  for (const [d, sites] of Object.entries(data)) {
    if (!inRange(d)) continue;
    for (const [dom, s] of Object.entries(sites)) { t[dom] = (t[dom] || 0) + s; (days[dom] = days[dom] || new Set()).add(d); }
  }
  return { t, days };
}

function renderKpis() {
  const { t } = totals();
  const total = Object.values(t).reduce((a, b) => a + b, 0);
  const span = daysBetween(state.from, state.to);
  const active = span.filter(d => data[d] && Object.keys(data[d]).length).length;
  const top = Object.entries(t).sort((a, b) => b[1] - a[1])[0];
  // compare with the previous period of the same length
  const prev = daysBetween(shift(state.from, -span.length), shift(state.from, -1)).reduce((a, d) => a + Object.values(data[d] || {}).reduce((x, y) => x + y, 0), 0);
  const change = prev ? Math.round(((total - prev) / prev) * 100) : null;
  $('#kpis').innerHTML = [
    ['Total', dur(total), change === null ? '' : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}% vs previous`],
    ['Daily average', dur(active ? total / active : 0), `${active} active day${active === 1 ? '' : 's'}`],
    ['Top site', top ? esc(top[0]) : '—', top ? dur(top[1]) : ''],
    ['Sites', Object.keys(t).length, `${Object.keys(data).length} days of history`]
  ].map(([k, v, s]) => `<div class="card kpi"><span>${k}</span><b>${v}</b><small>${s}</small></div>`).join('');
}
function shift(day, n) { const d = new Date(day + 'T12:00'); d.setDate(d.getDate() + n); return dayKey(d); }

function renderChart() {
  const span = daysBetween(state.from, state.to);
  // day bars up to 62 days, then weeks, then months
  const bucket = span.length <= 62 ? 'day' : span.length <= 400 ? 'week' : 'month';
  $('#bucket').textContent = bucket;
  const groups = [];
  for (const d of span) {
    const date = new Date(d + 'T12:00');
    let key = d; let label = date.toLocaleDateString([], span.length <= 8 ? { weekday: 'short' } : { month: 'numeric', day: 'numeric' });
    if (bucket === 'week') { const s = new Date(date); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); key = dayKey(s); label = s.toLocaleDateString([], { month: 'short', day: 'numeric' }); }
    if (bucket === 'month') { key = d.slice(0, 7); label = date.toLocaleDateString([], { month: 'short', year: '2-digit' }); }
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) groups.push((g = { key, label, secs: 0 }));
    g.secs += Object.values(data[d] || {}).reduce((a, b) => a + b, 0);
  }
  const max = Math.max(1, ...groups.map(g => g.secs));
  const every = Math.ceil(groups.length / 16);
  $('#chart').innerHTML = groups.map((g, i) => `<div title="${g.label}: ${dur(g.secs)}"><i style="height:${Math.max(2, (150 * g.secs) / max)}px"></i><span>${i % every === 0 ? g.label : ''}</span></div>`).join('');
}

function renderHeat() {
  const end = new Date();
  const start = new Date(); start.setDate(start.getDate() - 364 - start.getDay());
  const days = daysBetween(dayKey(start), dayKey(end));
  const vals = days.map(d => Object.values(data[d] || {}).reduce((a, b) => a + b, 0));
  // shade by quartile of the days that have any time, so contrast is visible at every usage level
  const sorted = vals.filter(v => v > 0).sort((x, y) => x - y);
  const q = f => sorted[Math.floor(f * (sorted.length - 1))] || 0;
  const cuts = [q(0.25), q(0.5), q(0.75)];
  $('#heat').innerHTML = days.map((d, i) => {
    const v = vals[i]; const lvl = v <= 0 ? 0 : 1 + cuts.filter(c => v > c).length;
    return `<i class="l${lvl}${d === dayKey() ? ' today' : ''}" title="${d}: ${dur(v)}"></i>`;
  }).join('');
  const total = vals.reduce((a, b) => a + b, 0);
  $('#heat-cap').textContent = `${dur(total)} in the last 12 months · darker = more time`;
}

function renderSites() {
  const { t, days } = totals();
  const total = Object.values(t).reduce((a, b) => a + b, 0) || 1;
  const rows = Object.entries(t).filter(([d]) => !state.q || d.includes(state.q)).sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] || 1;
  $('#sites').innerHTML = rows.slice(0, state.show).map(([d, s]) => `<tr>
    <td><img src="${favicon(d)}" alt=""></td><td class="dom">${esc(d)}</td>
    <td class="barcol"><div class="bar"><i style="width:${(100 * s) / max}%"></i></div></td>
    <td>${dur(s)}</td><td class="muted">${((100 * s) / total).toFixed(1)}%</td><td class="muted">${days[d].size}</td><td class="muted">${dur(s / days[d].size)}</td>
    <td><button class="ghost icon" data-del="${esc(d)}" title="Delete this site's history">✕</button></td></tr>`).join('')
    || '<tr><td colspan="8" class="muted">Nothing tracked in this range yet.</td></tr>';
  $('#more').hidden = rows.length <= state.show;
}

function exportCsv() {
  const lines = ['date,site,seconds'];
  for (const d of Object.keys(data).sort()) if (inRange(d)) for (const [dom, s] of Object.entries(data[d])) lines.push(`${d},${dom},${s}`);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  a.download = `sumi-time-${state.from}_${state.to}.csv`;
  a.click();
}
