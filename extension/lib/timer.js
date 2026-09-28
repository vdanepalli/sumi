// Pomodoro timer. State lives in storage.local ('timer') so the popup, the new-tab
// page and the service worker all see the same clock. Only the service worker
// calls these (pages send {type:'timer', action}).
import { get, set, update, getSettings, dayKey } from './store.js';

const MODES = { focus: 'Focus', short: 'Short break', long: 'Long break' };
export const modeLabel = m => MODES[m] || m;

export async function state() {
  const s = await get('timer', null);
  if (s) return s;
  const cfg = await getSettings();
  return { mode: 'focus', running: false, remaining: cfg.focusMin * 60000, total: cfg.focusMin * 60000, endsAt: 0, cycle: 0 };
}
export const leftMs = s => (s.running ? Math.max(0, s.endsAt - Date.now()) : s.remaining);

async function lengthOf(mode) {
  const c = await getSettings();
  return (mode === 'focus' ? c.focusMin : mode === 'short' ? c.shortMin : c.longMin) * 60000;
}

async function save(s) {
  await set('timer', s);
  await badge(s);
  return s;
}

export async function start() {
  const s = await state();
  if (s.running) return s;
  if (s.remaining <= 0) s.remaining = s.total = await lengthOf(s.mode);
  s.endsAt = Date.now() + s.remaining;
  s.running = true;
  await chrome.alarms.create('timer-end', { when: s.endsAt });
  await chrome.alarms.create('timer-badge', { periodInMinutes: 0.5 });
  return save(s);
}
export async function pause() {
  const s = await state();
  if (!s.running) return s;
  s.remaining = Math.max(0, s.endsAt - Date.now());
  s.running = false;
  await chrome.alarms.clear('timer-end');
  return save(s);
}
export const toggle = async () => ((await state()).running ? pause() : start());

export async function reset(mode) {
  const s = await state();
  s.mode = mode || s.mode;
  s.running = false;
  s.remaining = s.total = await lengthOf(s.mode);
  await chrome.alarms.clear('timer-end');
  return save(s);
}

// a session ended (naturally or skipped)
export async function complete(skipped = false) {
  const s = await state();
  const cfg = await getSettings();
  const was = s.mode;
  if (was === 'focus' && !skipped) {
    s.cycle += 1;
    const mins = Math.round(s.total / 60000);
    await update('focusLog', {}, log => {
      const d = dayKey();
      const e = log[d] || { count: 0, minutes: 0 };
      return { ...log, [d]: { count: e.count + 1, minutes: e.minutes + mins } };
    });
  }
  s.mode = was === 'focus' ? (s.cycle % cfg.longEvery === 0 ? 'long' : 'short') : 'focus';
  s.remaining = s.total = await lengthOf(s.mode);
  s.running = false;
  await chrome.alarms.clear('timer-end');
  await save(s);
  if (!skipped) {
    chrome.notifications.create('timer-' + Date.now(), {
      type: 'basic', iconUrl: '/icons/icon128.png', priority: 2,
      title: was === 'focus' ? 'Focus session complete' : 'Break is over',
      message: was === 'focus' ? `Take a ${modeLabel(s.mode).toLowerCase()}.` : 'Ready for the next focus session?'
    });
  }
  const auto = s.mode === 'focus' ? cfg.autoStartFocus : cfg.autoStartBreak;
  if (auto && !skipped) return start();
  return s;
}

export async function badge(s) {
  s = s || (await state());
  const running = s.running;
  const mins = Math.ceil(leftMs(s) / 60000);
  await chrome.action.setBadgeText({ text: running || s.remaining < s.total ? String(mins) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: s.mode === 'focus' ? '#c0392b' : '#2e8b57' });
  if (!running) await chrome.alarms.clear('timer-badge');
}

export async function isFocusing() {
  const s = await state();
  return s.running && s.mode === 'focus';
}
