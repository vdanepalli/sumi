import { $, clock as mmss, send } from '../lib/ui.js';
import { leftMs } from '../lib/timer.js';

const q = new URLSearchParams(location.search);
const url = q.get('u') || '';
const limit = q.get('limit');
let host = '';
try { host = new URL(url).hostname; } catch (e) { /* bad url */ }

if (limit) {
  // daily site limit: blocked until midnight
  $('h1').textContent = 'That is enough for today.';
  $('#site').textContent = `${host}: your ${limit}-minute daily limit is used up. It resets at midnight.`;
  const tick = () => { const m = new Date(); m.setHours(24, 0, 0, 0); $('#left').textContent = mmss(m - Date.now()); };
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
