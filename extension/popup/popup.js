import { $, esc, toast, clock, dur, send, applyAccent } from '../lib/ui.js';
import { getSettings, get, dayKey, domainOf } from '../lib/store.js';
import { leftMs, modeLabel, swElapsed } from '../lib/timer.js';
import * as C from '../lib/collections.js';
import * as Tabs from '../lib/tabs.js';
import * as L from '../lib/later.js';
import { mountPalette } from '../lib/palette.js';
mountPalette($('#palette'), { onDone: () => window.close() });

const cfg = await getSettings();
applyAccent(cfg.accent);
let timer = (await send({ type: 'timer', action: 'state' })).data;
let sw = (await send({ type: 'stopwatch', action: 'state' })).data;
function render() {
  if (timer) {
    const l = leftMs(timer);
    $('#t-toggle').textContent = `${timer.running ? '❚❚' : '▶'} ${clock(l)}`;
    $('#t-toggle').title = `${modeLabel(timer.mode)}: ${timer.running ? 'pause' : 'start'} (Alt+Shift+P)`;
  }
  const swOn = !!(sw && (sw.running || sw.elapsed));
  $('#s-toggle').hidden = $('#s-stop').hidden = !swOn;
  if (swOn) $('#s-toggle').textContent = `${sw.running ? '❚❚' : '▶'} ${clock(swElapsed(sw))}`;
}
render();
setInterval(render, 250);
chrome.storage.onChanged.addListener(c => { if (c.timer) timer = c.timer.newValue; if (c.stopwatch) sw = c.stopwatch.newValue; render(); });
$('#t-toggle').onclick = () => send({ type: 'timer', action: 'toggle' });
$('#s-toggle').onclick = () => send({ type: 'stopwatch', action: 'toggle' });
$('#s-stop').onclick = () => send({ type: 'stopwatch', action: 'reset' });

const log = await get('focusLog', {});
const t = log[dayKey()] || { count: 0, minutes: 0 };

// collection picker: "New collection" or an existing one, grouped by space
const spaces = await C.spaces();
const cols = await C.collections();
const last = await get('popupTarget', 'new');
$('#target').innerHTML = `<option value="new">＋ New collection</option>` + spaces.map(s =>
  `<optgroup label="${esc(s.name)}">${cols.filter(c => c.spaceId === s.id).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
$('#target').value = cols.find(c => c.id === last) ? last : 'new';
$('#target').onchange = e => chrome.storage.local.set({ popupTarget: e.target.value });

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
async function targetCollection(defaultName) {
  const v = $('#target').value;
  if (v !== 'new') return v;
  const lastSpace = (await get('lastSpace', null)) || spaces[0].id;
  return (await C.addCollection(spaces.find(s => s.id === lastSpace)?.id || spaces[0].id, defaultName)).id;
}
$('#save-tab').onclick = async () => {
  if (!/^(https?|file):/.test(tab?.url || '')) return toast('This page cannot be saved');
  await C.addCards(await targetCollection(domainOf(tab.url) || 'Saved'), [tab]);
  toast('Tab saved');
};
$('#save-win').onclick = async () => {
  const tabs = (await chrome.tabs.query({ currentWindow: true })).filter(x => /^(https?|file):/.test(x.url));
  if (!tabs.length) return toast('No web pages in this window');
  const id = await targetCollection(`${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${tabs.length} tabs`);
  await C.addCards(id, tabs);
  if (cfg.closeAfterSave) await C.closeSaved(tabs);
  toast(`Saved ${tabs.length} tabs`);
};
$('#save-later').onclick = async () => {
  if (!/^https?:/.test(tab?.url || '')) return toast('This page cannot be saved');
  const it = await L.add({ url: tab.url, title: tab.title, minutes: await L.estimateTab(tab.id) });
  toast(it.existed ? 'Already in Later' : `Saved to ${L.KINDS[it.kind]} later`);
};

await send({ type: 'flush' });
const dom = domainOf(tab?.url || '');
const usage = (await get('usage', {}))[dayKey()] || {};
$('#site').textContent = [dom && `${dom} ${dur(usage[dom] || 0)} today`, `${t.minutes}/${cfg.dailyGoalMin} min focused`].filter(Boolean).join(' · ');
$('#open').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html') });
