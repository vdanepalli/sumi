// Pomodoro timer + stopwatch. State lives in storage.local ('timer', 'stopwatch')
// so every page, the popup and the floating widget show the same clock. Only the
// service worker changes it (pages send {type:'timer'|'stopwatch', action}).
// Nothing ticks: the clock is endsAt / startedAt timestamps, and a 'timer-end' alarm
// (which also fires late, after the computer wakes) moves to the next phase.
import { get, set, update, getSettings, dayKey } from './store.js';

const MODES = { focus: 'Focus', short: 'Short break', long: 'Long break' };
export const modeLabel = m => MODES[m] || m;

// one change at a time inside the service worker (double clicks, alarm vs. button)
let chain = Promise.resolve();
const serial = fn => (...a) => (chain = chain.then(() => fn(...a), () => fn(...a)));

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
  return Math.max(1, Number(mode === 'focus' ? c.focusMin : mode === 'short' ? c.shortMin : c.longMin) || 1) * 60000;
}
async function save(s) { await set('timer', s); await badge(); return s; }
async function run(s, endsAt) {
  s.endsAt = endsAt;
  s.remaining = Math.max(0, endsAt - Date.now());
  s.running = true;
  await chrome.alarms.create('timer-end', { when: endsAt });
  await chrome.alarms.create('badge', { periodInMinutes: 0.5 });
  return save(s);
}

// opts: { project: {type, id, title}, minutes } - start a focus session on something
async function _start(opts = {}) {
  let s = await state();
  if (opts.project !== undefined || opts.minutes) {
    if (s.running) s = await _pause();
    if (opts.project !== undefined) s.project = opts.project;
    if (opts.minutes > 0) { s.mode = 'focus'; s.remaining = s.total = Math.round(opts.minutes * 60000); }
  }
  if (s.running) return s;
  if (s.remaining <= 0) s.remaining = s.total = await lengthOf(s.mode);
  return run(s, Date.now() + s.remaining);
}
async function _pause() {
  const s = await state();
  if (!s.running) return s;
  s.remaining = Math.max(0, s.endsAt - Date.now());
  s.running = false;
  await chrome.alarms.clear('timer-end');
  return save(s);
}
async function _reset(mode) {
  const s = await state();
  s.mode = MODES[mode] ? mode : s.mode;
  s.running = false;
  s.remaining = s.total = await lengthOf(s.mode);
  await chrome.alarms.clear('timer-end');
  return save(s);
}

// a session ended (naturally, or skipped by the user)
async function _complete(skipped = false) {
  const s = await state();
  const now = Date.now();
  // a stale or early alarm (paused / reset / restarted since): nothing ended
  if (!skipped && (!s.running || s.endsAt > now + 1500)) return s;
  const cfg = await getSettings();
  const was = s.mode;
  // ended while the computer slept or Chrome was closed: the next phase began back then
  const endedAt = !skipped && s.running ? Math.min(now, s.endsAt) : now;
  if (was === 'focus' && !skipped) {
    s.cycle = (s.cycle || 0) + 1;
    const mins = Math.round(s.total / 60000);
    const d = dayKey(new Date(endedAt));
    if (s.project) {
      const pk = `${s.project.type}:${s.project.id}`;
      await update('projectLog', {}, log => {
        const day = { ...(log[d] || {}) };
        day[pk] = { title: s.project.title, type: s.project.type, minutes: (day[pk]?.minutes || 0) + mins };
        return { ...log, [d]: day };
      });
    }
    await update('focusLog', {}, log => {
      const e = log[d] || { count: 0, minutes: 0 };
      return { ...log, [d]: { count: e.count + 1, minutes: e.minutes + mins } };
    });
  }
  // a skipped focus never earns the long break (and cycle 0 is not "every 4th")
  s.mode = was === 'focus' ? (!skipped && s.cycle > 0 && s.cycle % cfg.longEvery === 0 ? 'long' : 'short') : 'focus';
  s.remaining = s.total = await lengthOf(s.mode);
  s.running = false;
  await chrome.alarms.clear('timer-end');
  const auto = !skipped && (s.mode === 'focus' ? cfg.autoStartFocus : cfg.autoStartBreak);
  const late = now - endedAt > 60000;
  let note = !skipped && {
    title: was === 'focus' ? 'Focus session complete' : 'Break is over',
    message: was === 'focus' ? `Take a ${modeLabel(s.mode).toLowerCase()}.` : 'Ready for the next focus session?'
  };
  if (auto && endedAt + s.total > now + 5000 && !(late && s.mode === 'focus')) await run(s, endedAt + s.total);
  else {
    // a break that also ran out while away: just be ready for the next focus session
    if (auto && s.mode !== 'focus') { s.mode = 'focus'; s.remaining = s.total = await lengthOf('focus'); note = { title: 'Focus session complete', message: 'Your break is over too. Ready for the next one?' }; }
    await save(s);
  }
  if (note) chrome.notifications.create('timer-' + now, { type: 'basic', iconUrl: '/icons/icon128.png', priority: 2, ...note });
  return s;
}

async function _setProject(project) { const s = await state(); s.project = project || null; return save(s); }

// on service-worker start: a timer that should have ended (alarm lost on browser restart) ends
// now; a running one gets its alarm back
async function _reconcile() {
  const s = await get('timer', null);
  if (!s?.running) return;
  if (s.endsAt <= Date.now()) return _complete(false);
  if (!(await chrome.alarms.get('timer-end'))) await chrome.alarms.create('timer-end', { when: s.endsAt });
  if (!(await chrome.alarms.get('badge'))) await chrome.alarms.create('badge', { periodInMinutes: 0.5 });
}
// session lengths changed in settings: an untouched (not started) timer takes the new length
async function _syncLengths() {
  const s = await get('timer', null);
  if (!s || s.running || s.remaining < s.total) return;
  const len = await lengthOf(s.mode);
  if (len !== s.total) { s.remaining = s.total = len; await save(s); }
}

export const start = serial(_start);
export const pause = serial(_pause);
export const reset = serial(_reset);
export const complete = serial(_complete);
export const setProject = serial(_setProject);
export const reconcile = serial(_reconcile);
export const syncLengths = serial(_syncLengths);
export const toggle = serial(async () => ((await state()).running ? _pause() : _start()));

export async function isFocusing() { const s = await state(); return s.running && s.mode === 'focus' && s.endsAt > Date.now(); }

// ---------------- stopwatch ----------------
const SW0 = { running: false, startedAt: 0, elapsed: 0, laps: [], label: '' };
export const swState = async () => ({ ...SW0, ...(await get('stopwatch', {})) });
export const swElapsed = s => s.elapsed + (s.running ? Math.max(0, Date.now() - s.startedAt) : 0);
export const swActive = s => !!s && (s.running || s.elapsed > 0);
async function swSave(s) { await set('stopwatch', s); await badge(); return s; }

async function _swStart(label, project) {
  const s = await swState();
  if (project !== undefined) s.project = project;
  if (label !== undefined) s.label = label;
  if (s.running) return swSave(s);
  s.running = true;
  s.startedAt = Date.now();
  await chrome.alarms.create('badge', { periodInMinutes: 0.5 });
  return swSave(s);
}
async function _swPause() {
  const s = await swState();
  if (!s.running) return s;
  s.elapsed = swElapsed(s);
  s.running = false;
  return swSave(s);
}
async function _swLap() {
  const s = await swState();
  const t = swElapsed(s);
  if (t > 0) s.laps = [...s.laps, t].slice(-50);
  return swSave(s);
}
// stop: log the time (like a focus session without a fixed length), then clear
async function _swReset(log = true) {
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
export const swStart = serial(_swStart);
export const swPause = serial(_swPause);
export const swLap = serial(_swLap);
export const swReset = serial(_swReset);
export const swToggle = serial(async () => ((await swState()).running ? _swPause() : _swStart()));

// ---------------- toolbar badge ----------------
export async function badge() {
  const t = await state();
  const w = await swState();
  let text = '';
  let color = '#555';
  if (isActive(t)) { text = String(Math.ceil(leftMs(t) / 60000)); color = t.mode === 'focus' ? '#c0392b' : '#2e8b57'; }
  else if (swActive(w)) { const m = Math.floor(swElapsed(w) / 60000); text = m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`; color = '#3b6fd6'; }
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  if (!t.running && !w.running) await chrome.alarms.clear('badge');
}
