import { $, clock as mmss, send } from '../lib/ui.js';
import { leftMs } from '../lib/timer.js';

const url = new URLSearchParams(location.search).get('u') || '';
try { $('#site').textContent = `${new URL(url).hostname} is blocked during focus time`; } catch (e) { /* bad url */ }
let timer = (await send({ type: 'timer', action: 'state' })).data;
const render = () => {
  if (!timer) return;
  $('#left').textContent = mmss(leftMs(timer));
  if (!timer.running || timer.mode !== 'focus') location.replace(url); // session ended
};
render();
setInterval(render, 1000);
chrome.storage.onChanged.addListener(c => { if (c.timer) { timer = c.timer.newValue; render(); } });
$('#back').onclick = () => (history.length > 2 ? history.go(-2) : chrome.tabs.create({ url: 'chrome://newtab' }));
$('#end').onclick = async () => { await send({ type: 'timer', action: 'pause' }); location.replace(url); };
