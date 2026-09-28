import { $, esc, toast, mmss, dur, send, applyAccent, defHtml, wireAudio } from '../lib/ui.js';
import { getSettings, get, dayKey, domainOf } from '../lib/store.js';
import { leftMs, modeLabel } from '../lib/timer.js';
import * as Tabs from '../lib/tabs.js';
import * as Dict from '../lib/dict.js';

const cfg = await getSettings();
applyAccent(cfg.accent);
wireAudio(document.body);

let timer = (await send({ type: 'timer', action: 'state' })).data;
function render() {
  if (!timer) return;
  const left = leftMs(timer);
  $('#left').textContent = mmss(left);
  $('#mode').textContent = modeLabel(timer.mode);
  $('#toggle').textContent = timer.running ? 'Pause' : left < timer.total ? 'Resume' : 'Start';
}
render();
setInterval(render, 1000);
$('#toggle').onclick = async () => { timer = (await send({ type: 'timer', action: 'toggle' })).data; render(); };
$('#skip').onclick = async () => { timer = (await send({ type: 'timer', action: 'skip' })).data; render(); };
chrome.storage.onChanged.addListener(c => { if (c.timer) { timer = c.timer.newValue; render(); } });

const log = await get('focusLog', {});
const t = log[dayKey()] || { count: 0, minutes: 0 };
$('#today').textContent = `Today: ${t.minutes}/${cfg.dailyGoalMin} min focused · ${t.count} session${t.count === 1 ? '' : 's'}`;

// current site time today
await send({ type: 'flush' });
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const dom = domainOf(tab?.url || '');
const usage = (await get('usage', {}))[dayKey()] || {};
$('#site').innerHTML = dom ? `<span>${esc(dom)}</span><span class="sp"></span><span>${dur(usage[dom] || 0)} today</span>` : '';
const o = await Tabs.overview();
$('#tabs').textContent = `${o.count} tabs${o.dupes ? ` · ${o.dupes} duplicates` : ''}`;

let last = null;
$('#f').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('#q').value.trim();
  if (!q) return;
  $('#out').innerHTML = '<div class="small muted">Looking up…</div>';
  try {
    last = await Dict.lookup(q);
    $('#out').innerHTML = defHtml(last, { actions: '<button class="small" id="save">Save</button>', missing: 'You can still save it.' });
    $('#save').onclick = async () => { await Dict.saveTerm(last, { source: tab ? { url: tab.url, title: tab.title } : null }); toast(`Saved “${last.term}”`); $('#save').textContent = 'Saved ✓'; };
  } catch (err) { $('#out').innerHTML = `<div class="small muted">${esc(err.message)}</div>`; }
});

document.querySelector('.grid2').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const a = b.dataset.act;
  if (a === 'dupes') toast(`Closed ${await Tabs.closeDuplicates()} duplicates`);
  if (a === 'group') toast(`Made ${await Tabs.groupByDomain()} groups`);
  if (a === 'sleep') toast(`${await Tabs.sleepInactive()} tabs asleep`);
  if (a === 'save') toast((await Tabs.saveSession()) ? 'Window saved' : 'Nothing to save');
});
$('#dash').onclick = () => chrome.tabs.create({ url: 'chrome://newtab' });
