import { $, esc, toast, clock, dur, send, applyAccent } from '../lib/ui.js';
import { getSettings, get, dayKey, domainOf } from '../lib/store.js';
import { leftMs, modeLabel, swElapsed } from '../lib/timer.js';
import * as C from '../lib/collections.js';
import * as Tabs from '../lib/tabs.js';
import * as L from '../lib/later.js';

const cfg = await getSettings();
applyAccent(cfg.accent);
let timer = (await send({ type: 'timer', action: 'state' })).data;
let sw = (await send({ type: 'stopwatch', action: 'state' })).data;
function render() {
  if (timer) {
    const l = leftMs(timer);
    $('#tv').textContent = clock(l);
    $('#tm').textContent = modeLabel(timer.mode);
    $('#t-toggle').textContent = timer.running ? 'Pause' : l < timer.total ? 'Resume' : 'Start';
  }
  if (sw) { $('#sv').textContent = clock(swElapsed(sw)); $('#s-toggle').textContent = sw.running ? 'Pause' : sw.elapsed ? 'Resume' : 'Start'; }
}
render();
setInterval(render, 250);
chrome.storage.onChanged.addListener(c => { if (c.timer) timer = c.timer.newValue; if (c.stopwatch) sw = c.stopwatch.newValue; render(); });
$('#t-toggle').onclick = () => send({ type: 'timer', action: 'toggle' });
$('#t-skip').onclick = () => send({ type: 'timer', action: 'skip' });
$('#s-toggle').onclick = () => send({ type: 'stopwatch', action: 'toggle' });
$('#s-stop').onclick = () => send({ type: 'stopwatch', action: 'reset' });

const log = await get('focusLog', {});
const t = log[dayKey()] || { count: 0, minutes: 0 };
$('#today').textContent = `Today: ${t.minutes}/${cfg.dailyGoalMin} min focused · ${t.count} session${t.count === 1 ? '' : 's'}`;

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
  if (cfg.closeAfterSave) { await chrome.tabs.create({}); await chrome.tabs.remove(tabs.filter(x => !x.pinned).map(x => x.id)); }
  toast(`Saved ${tabs.length} tabs`);
};
$('#save-later').onclick = async () => {
  if (!/^https?:/.test(tab?.url || '')) return toast('This page cannot be saved');
  const due = L.presetDue($('#ldue').value);
  const it = await L.add({ url: tab.url, title: tab.title, kind: $('#lkind').value || undefined, due, remindBefore: due ? 60 : null });
  toast(`Saved to ${L.KINDS[it.kind]} later${due ? ' · reminder 1h before' : ''}`);
};
if (tab && /^https?:/.test(tab.url)) { const k = L.kindOf(tab.url); $('#lkind').options[0].textContent = `Auto (${L.KINDS[k].toLowerCase()})`; }
$('#tools').onclick = async e => {
  const b = e.target.closest('[data-t]'); if (!b) return;
  if (b.dataset.t === 'dupes') toast(`Closed ${await Tabs.closeDuplicates()} duplicates`);
  if (b.dataset.t === 'sleep') toast(`${await Tabs.sleepInactive()} tabs asleep`);
};

await send({ type: 'flush' });
const dom = domainOf(tab?.url || '');
const usage = (await get('usage', {}))[dayKey()] || {};
$('#site').textContent = dom ? `${dom}: ${dur(usage[dom] || 0)} today` : '';
$('#open').onclick = () => chrome.tabs.create({ url: 'chrome://newtab' });
