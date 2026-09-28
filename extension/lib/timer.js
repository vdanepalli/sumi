// Pomodoro timer + stopwatch. State lives in storage.local ('timer', 'stopwatch')
// so every page, the popup and the floating widget show the same clock. Only the
// service worker changes it (pages send {type:'timer'|'stopwatch', action}).
import { get, set, update, getSettings, dayKey } from './store.js';

const MODES = { focus: 'Focus', short: 'Short break', long: 'Long break' };
export const modeLabel = m => MODES[m] || m;

// ---------------- pomodoro ----------------
export async function state() {
  const s = await get('timer', null);
  if (s) return s;
  const cfg = await getSettings();
  return { mode: 'focus', running: false, remaining: cfg.focusMin * 60000, total: cfg.focusMin * 60000, endsAt: 0, cycle: 0 };
}
export const leftMs = s => (s.running ? Math.max(0, s.endsAt - Date.now()) : s.remaining);
export const isActive = s => !!s && (s.running || s.remaining < s.total);

async function lengthOf(mode) {
  const c = await getSettings();
  return (mode === 'focus' ? c.focusMin : mode === 'short' ? c.shortMin : c.longMin) * 60000;
}
async function save(s) { await set('timer', s); await badge(); return s; }

// opts: { project: {type, id, title}, minutes } - start a focus session on something
export async function start(opts = {}) {
  let s = await state();
  if (opts.project !== undefined || opts.minutes) {
    if (s.running) await pause();
    s = await state();
    if (opts.project !== undefined) s.project = opts.project;
    if (opts.minutes) { s.mode = 'focus'; s.remaining = s.total = opts.minutes * 60000; }
  }
  if (s.running) return s;
  if (s.remaining <= 0) s.remaining = s.total = await lengthOf(s.mode);
  s.endsAt = Date.now() + s.remaining;
  s.running = true;
  await chrome.alarms.create('timer-end', { when: s.endsAt });
  await chrome.alarms.create('badge', { periodInMinutes: 0.5 });
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
    if (s.project) {
      const pk = `${s.project.type}:${s.project.id}`;
      await update('projectLog', {}, log => {
        const d = dayKey();
        const day = { ...(log[d] || {}) };
        day[pk] = { title: s.project.title, type: s.project.type, minutes: (day[pk]?.minutes || 0) + mins };
        return { ...log, [d]: day };
      });
    }
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

export async function setProject(project) { const s = await state(); s.project = project || null; return save(s); }

export async function isFocusing() { const s = await state(); return s.running && s.mode === 'focus'; }

// ---------------- stopwatch ----------------
const SW0 = { running: false, startedAt: 0, elapsed: 0, laps: [], label: '' };
export const swState = async () => ({ ...SW0, ...(await get('stopwatch', {})) });
export const swElapsed = s => s.elapsed + (s.running ? Date.now() - s.startedAt : 0);
export const swActive = s => !!s && (s.running || s.elapsed > 0);
async function swSave(s) { await set('stopwatch', s); await badge(); return s; }

export async function swStart(label, project) {
  const s = await swState();
  if (project !== undefined) s.project = project;
  if (s.running) return s;
  s.running = true;
  s.startedAt = Date.now();
  if (label !== undefined) s.label = label;
  await chrome.alarms.create('badge', { periodInMinutes: 0.5 });
  return swSave(s);
}
export async function swPause() {
  const s = await swState();
  if (!s.running) return s;
  s.elapsed = swElapsed(s);
  s.running = false;
  return swSave(s);
}
export const swToggle = async () => ((await swState()).running ? swPause() : swStart());
export async function swLap() {
  const s = await swState();
  const t = swElapsed(s);
  if (t > 0) s.laps = [...s.laps, t].slice(-50);
  return swSave(s);
}
// stop: log the time (like a focus session without a fixed length), then clear
export async function swReset(log = true) {
  const s = await swState();
  const t = swElapsed(s);
  if (log && t >= 60000) {
    await update('stopwatchLog', {}, l => {
      const d = dayKey();
      return { ...l, [d]: [...(l[d] || []), { ms: t, label: s.label || '', at: Date.now(), project: s.project || null }] };
    });
  }
  return swSave({ ...SW0 });
}

// ---------------- toolbar badge ----------------
export async function badge() {
  const t = await state();
  const w = await swState();
  let text = '';
  let color = '#555';
  if (t.running || isActive(t)) { text = String(Math.ceil(leftMs(t) / 60000)); color = t.mode === 'focus' ? '#c0392b' : '#2e8b57'; }
  else if (swActive(w)) { const m = Math.floor(swElapsed(w) / 60000); text = m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`; color = '#3b6fd6'; }
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  if (!t.running && !w.running) await chrome.alarms.clear('badge');
}
