// Focus: Pomodoro timer + stopwatch (both float on every page while active) and
// focus history.
import { $, $$, esc, clock, dur, send, toast } from '../../lib/ui.js';
import { get, getSettings, setSettings, dayKey, daysAgo } from '../../lib/store.js';
import { leftMs, modeLabel, swElapsed } from '../../lib/timer.js';
import { allDevices } from '../../lib/sync.js';
import { all } from '../../lib/store.js';
import { items as laterItems } from '../../lib/later.js';

const CIRC = 2 * Math.PI * 88;
let timer; let sw; let cfg;

export async function mount(el) {
  cfg = await getSettings();
  timer = (await send({ type: 'timer', action: 'state' })).data;
  sw = (await send({ type: 'stopwatch', action: 'state' })).data;
  el.innerHTML = `
    <div class="focus-grid">
      <section class="card pomo" id="pomo">
        <h2>Pomodoro <span class="sp"></span><span class="small faint" id="cycle"></span></h2>
        <div class="proj"><span class="muted">Focus on</span><select id="project"><option value="">Nothing in particular</option></select></div>
        <div class="ring-wrap big">
          <svg viewBox="0 0 200 200" class="ring"><circle class="bg" cx="100" cy="100" r="88"/><circle class="fg" id="ring" cx="100" cy="100" r="88"/></svg>
          <div class="ring-center"><div class="mode" id="mode"></div><div class="left" id="left"></div></div>
        </div>
        <div class="row center"><button class="primary" id="t-toggle">Start</button><button id="t-reset">Reset</button><button id="t-skip">Skip</button></div>
        <div class="row center modes">${['focus', 'short', 'long'].map(m => `<button class="ghost" data-mode="${m}">${modeLabel(m)}</button>`).join('')}</div>
        <div class="row center small muted">
          <label class="ck"><input type="checkbox" id="block"> Block distracting sites during focus</label>
        </div>
        <p class="small faint center-t">Shortcut: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> · the timer floats on every page while it runs</p>
      </section>

      <section class="card swc">
        <h2>Stopwatch</h2>
        <input type="text" id="sw-label" placeholder="What are you working on? (optional)" maxlength="40">
        <div class="sw-time" id="sw-time">0:00</div>
        <div class="row center"><button class="primary" id="sw-toggle">Start</button><button id="sw-lap">Lap</button><button id="sw-stop" title="Stop and save to history">Stop &amp; save</button><button class="ghost" id="sw-discard">Discard</button></div>
        <ol class="laps" id="laps"></ol>
        <p class="small faint center-t">Shortcut: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>W</kbd></p>
      </section>

      <section class="card fhist">
        <h2>Focus history <span class="sp"></span><span class="small muted" id="goal"></span></h2>
        <div class="bar goal-bar"><i id="goal-bar"></i></div>
        <div class="chart30" id="chart30"></div>
        <div class="kpis" id="kpis"></div>
        <h3 class="sub">Time per project · last 30 days</h3>
        <ul class="list" id="projects"></ul>
        <h3 class="sub">Stopwatch today</h3>
        <ul class="list" id="swlog"></ul>
      </section>
    </div>`;

  $('#block').checked = cfg.blockDuringFocus;
  $('#block').onchange = async e => { cfg = await setSettings({ blockDuringFocus: e.target.checked }); toast(e.target.checked ? 'Sites in Settings → Focus are blocked while focusing' : 'Blocking off'); };
  const act = (type, action, extra = {}) => send({ type, action, ...extra }).then(r => { if (!r.ok) toast(r.error); });
  $('#t-toggle').onclick = () => act('timer', 'toggle');
  $('#t-reset').onclick = () => act('timer', 'reset');
  $('#t-skip').onclick = () => act('timer', 'skip');
  $$('.modes button').forEach(b => { b.onclick = () => act('timer', 'reset', { mode: b.dataset.mode }); });
  $('#sw-label').value = sw.label || '';
  $('#sw-toggle').onclick = () => (sw.running ? act('stopwatch', 'pause') : act('stopwatch', 'start', { label: $('#sw-label').value.trim() }));
  $('#sw-lap').onclick = () => act('stopwatch', 'lap');
  $('#sw-stop').onclick = () => act('stopwatch', 'reset');
  $('#sw-discard').onclick = () => act('stopwatch', 'discard');

  // project picker: open tasks and Later items
  const tasks = (await all('tasks')).filter(t => !t.done);
  const later = (await laterItems()).filter(i => i.status !== 'done');
  $('#project').innerHTML += `<optgroup label="Tasks">${tasks.map(t => `<option value="task:${t.id}">${esc(t.text)}</option>`).join('')}</optgroup>
    <optgroup label="Later">${later.map(i => `<option value="later:${i.id}">${esc(i.title.slice(0, 60))}</option>`).join('')}</optgroup>`;
  const cur = timer?.project;
  if (cur) { if (![...$('#project').options].some(o => o.value === `${cur.type}:${cur.id}`)) $('#project').add(new Option(cur.title, `${cur.type}:${cur.id}`)); $('#project').value = `${cur.type}:${cur.id}`; }
  $('#project').onchange = e => {
    const v = e.target.value;
    const opt = e.target.selectedOptions[0];
    const project = v ? { type: v.split(':')[0], id: v.split(':').slice(1).join(':'), title: opt.textContent } : null;
    act('timer', 'setProject', { project });
    toast(project ? `Focus sessions now count toward “${project.title}”` : 'No project');
  };

  const onStore = (c, area) => {
    if (area !== 'local') return;
    if (c.timer) timer = c.timer.newValue;
    if (c.stopwatch) sw = c.stopwatch.newValue || sw;
    if (c.focusLog || c.stopwatchLog) history();
    renderT(); renderSw();
  };
  chrome.storage.onChanged.addListener(onStore);
  const iv = setInterval(() => { renderT(); renderSw(true); }, 250);
  renderT(); renderSw(); history();
  return () => { clearInterval(iv); chrome.storage.onChanged.removeListener(onStore); };
}

function renderT() {
  if (!timer || !$('#left')) return;
  const left = leftMs(timer);
  $('#left').textContent = clock(left);
  $('#mode').textContent = modeLabel(timer.mode);
  $('#t-toggle').textContent = timer.running ? 'Pause' : left < timer.total ? 'Resume' : 'Start';
  // full ring that empties as time runs out
  $('#ring').style.strokeDashoffset = String(CIRC * (1 - (timer.total ? left / timer.total : 1)));
  $('#pomo').classList.toggle('break', timer.mode !== 'focus');
  $$('.modes button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === timer.mode)));
  $('#cycle').textContent = timer.cycle ? `${timer.cycle} this round` : '';
}
function renderSw(fast) {
  if (!sw || !$('#sw-time')) return;
  const t = swElapsed(sw);
  const s = Math.floor(t / 1000);
  $('#sw-time').innerHTML = `${clock(t)}<small>.${String(Math.floor((t % 1000) / 100))}</small>`;
  if (fast) return;
  $('#sw-toggle').textContent = sw.running ? 'Pause' : s ? 'Resume' : 'Start';
  const laps = sw.laps || [];
  $('#laps').innerHTML = laps.map((l, i) => `<li><span>Lap ${i + 1}</span><span>+${clock(l - (laps[i - 1] || 0))}</span><span class="muted">${clock(l)}</span></li>`).reverse().join('');
}

async function history() {
  const devs = await allDevices('focusLog');
  const byDay = {};
  for (const log of Object.values(devs)) for (const [d, v] of Object.entries(log)) { byDay[d] = byDay[d] || { count: 0, minutes: 0 }; byDay[d].count += v.count; byDay[d].minutes += v.minutes; }
  const today = byDay[dayKey()] || { count: 0, minutes: 0 };
  $('#goal').textContent = `Today ${today.minutes} / ${cfg.dailyGoalMin} min · ${today.count} session${today.count === 1 ? '' : 's'}`;
  $('#goal-bar').style.width = `${Math.min(100, (100 * today.minutes) / cfg.dailyGoalMin)}%`;
  const days = [...Array(30)].map((_, i) => daysAgo(29 - i));
  const max = Math.max(cfg.dailyGoalMin, ...days.map(d => byDay[d]?.minutes || 0));
  $('#chart30').innerHTML = days.map(d => {
    const m = byDay[d]?.minutes || 0;
    return `<div title="${d}: ${m} min"><i class="${m >= cfg.dailyGoalMin ? 'on' : ''}" style="height:${Math.max(2, (90 * m) / max)}px"></i></div>`;
  }).join('');
  let streak = 0;
  for (let i = byDay[dayKey()]?.count ? 0 : 1; ; i += 1) { if (byDay[daysAgo(i)]?.count) streak += 1; else break; }
  const totalMin = Object.values(byDay).reduce((a, v) => a + v.minutes, 0);
  const week = [...Array(7)].reduce((a, _, i) => a + (byDay[daysAgo(i)]?.minutes || 0), 0);
  $('#kpis').innerHTML = [['Streak', `${streak} day${streak === 1 ? '' : 's'}`], ['This week', dur(week * 60)], ['All time', dur(totalMin * 60)], ['Sessions', Object.values(byDay).reduce((a, v) => a + v.count, 0)]]
    .map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
  const pDevs = await allDevices('projectLog');
  const proj = {};
  for (const log of Object.values(pDevs)) for (const [d, v] of Object.entries(log)) if (d >= daysAgo(29)) for (const [k, p] of Object.entries(v)) { proj[k] = proj[k] || { title: p.title, type: p.type, minutes: 0 }; proj[k].minutes += p.minutes; }
  const swAll = await allDevices('stopwatchLog');
  for (const log of Object.values(swAll)) for (const [d, list] of Object.entries(log)) if (d >= daysAgo(29)) for (const x of list) if (x.project) { const k = `${x.project.type}:${x.project.id}`; proj[k] = proj[k] || { title: x.project.title, type: x.project.type, minutes: 0 }; proj[k].minutes += Math.round(x.ms / 60000); }
  const prows = Object.values(proj).sort((a, b) => b.minutes - a.minutes);
  const pmax = prows[0]?.minutes || 1;
  $('#projects').innerHTML = prows.slice(0, 10).map(p => `<li><span class="t">${esc(p.title)} <span class="faint small">${p.type}</span></span><div class="bar" style="width:30%"><i style="width:${(100 * p.minutes) / pmax}%"></i></div><b>${dur(p.minutes * 60)}</b></li>`).join('')
    || '<li class="muted small">Pick something in “Focus on”, or press ▶ Focus on a task or Later item.</li>';
  const swDevs = await allDevices('stopwatchLog');
  const todays = Object.values(swDevs).flatMap(l => l[dayKey()] || []).sort((a, b) => b.at - a.at);
  $('#swlog').innerHTML = todays.map(x => `<li><span class="t">${esc(x.label || 'Stopwatch')}</span><span class="muted">${new Date(x.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><b>${clock(x.ms)}</b></li>`).join('') || '<li class="muted small">Stopped sessions of a minute or more appear here.</li>';
}
