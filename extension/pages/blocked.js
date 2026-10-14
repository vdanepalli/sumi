import { $, clock as mmss, send } from '../lib/ui.js';
import { leftMs } from '../lib/timer.js';
import { overLimit } from '../lib/smart.js';
import { domainOf } from '../lib/store.js';

const q = new URLSearchParams(location.search);
// only ever send the tab back to an ordinary web page
const url = /^https?:/i.test(q.get('u') || '') ? q.get('u') : chrome.runtime.getURL('app/app.html');
const limit = q.get('limit');
const intent = q.get('intent');
let host = '';
try { host = new URL(url).hostname; } catch (e) { /* bad url */ }

if (intent) {
  // a pause before a distracting site: say why, then 5 or 15 minutes (asked again after that)
  document.title = 'A moment';
  $('h1').textContent = `Opening ${intent}`;
  $('#site').textContent = 'Take a breath. What are you here for?';
  $('#left').hidden = true;
  $('#intent').hidden = false;
  $('#end').textContent = 'Turn this off in Settings';
  $('#end').onclick = () => chrome.tabs.update({ url: chrome.runtime.getURL('app/app.html#settings') });
  const { intents = {} } = await chrome.storage.local.get('intents');
  const d = new Date(); const today = intents[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`] || [];
  const mine = today.filter(x => x.site === intent);
  if (mine.length) $('#today').textContent = `Today: ${mine.length} visit${mine.length === 1 ? '' : 's'}, ${mine.reduce((n, x) => n + (x.min || 0), 0)} min · ${[...new Set(mine.map(x => x.reason).filter(Boolean))].slice(-3).map(r => `“${r}”`).join(', ')}`;
  let min = 5;
  $('#intent').addEventListener('click', e => { if (e.target.value) min = Number(e.target.value); });
  $('#intent').onsubmit = async e => {
    e.preventDefault();
    const why = $('#why').value.trim();
    if (why.length < 3) { $('#why').focus(); $('#why').placeholder = 'A few words - what for?'; return; }
    await send({ type: 'intent', site: intent, minutes: min, reason: why });
    location.replace(url);
  };
  $('#why').focus();
} else if (limit) {
  // daily site limit: blocked until midnight
  $('h1').textContent = 'That is enough for today.';
  $('#site').textContent = `${host}: your ${limit}-minute daily limit is used up. It resets at midnight.`;
  const end = new Date(); end.setHours(24, 0, 0, 0);
  // the new day (or a raised limit in settings) lets the page through again
  const tick = () => { if (Date.now() >= end) return location.replace(url); $('#left').textContent = mmss(end - Date.now()); };
  chrome.storage.onChanged.addListener(async (c, a) => { if (a === 'local' && c.settings && !(await overLimit(domainOf(url)))) location.replace(url); });
  tick(); setInterval(tick, 1000);
  $('#end').textContent = 'Change limits in Sumi settings';
  $('#end').onclick = () => chrome.tabs.update({ url: chrome.runtime.getURL('app/app.html#settings') });
} else {
  $('#site').textContent = `${host} is blocked during focus time`;
  let timer = (await send({ type: 'timer', action: 'state' })).data;
  const render = () => {
    if (!timer) return;
    $('#left').textContent = mmss(leftMs(timer));
    if (!timer.running || timer.mode !== 'focus') location.replace(url); // session ended
  };
  render();
  setInterval(render, 1000);
  chrome.storage.onChanged.addListener(c => { if (c.timer) { timer = c.timer.newValue; render(); } });
  $('#end').onclick = async () => { await send({ type: 'timer', action: 'pause' }); location.replace(url); };
}
$('#back').onclick = () => (history.length > 2 ? history.go(-2) : chrome.tabs.update({ url: 'chrome://newtab' }));
