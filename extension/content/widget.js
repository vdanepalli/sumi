// Floating timer / stopwatch shown on every page while one is running or paused.
// Drag to move (position is shared by all tabs and windows), click the dot to
// minimise. Lives in a closed shadow root so pages cannot restyle it; reads only
// Sumi's own storage, never the page.
(() => {
  if (window.__sumiWidget || window.top !== window) return;
  window.__sumiWidget = true;

  const host = document.createElement('sumi-widget');
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; right: 20px; bottom: 20px; display: none;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
  <style>
    :host { all: initial; }
    .w { font: 500 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #e6e6e6;
      background: rgba(8, 8, 8, .92); border: 1px solid #2a2a2a; border-radius: 14px; box-shadow: 0 10px 30px rgba(0,0,0,.55);
      backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); padding: 6px; display: grid; gap: 4px; cursor: grab;
      user-select: none; -webkit-user-select: none; min-width: 150px; }
    .w.drag { cursor: grabbing; opacity: .9; }
    .row { display: flex; align-items: center; gap: 8px; padding: 3px 4px 3px 8px; border-radius: 10px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; cursor: pointer; }
    .lbl { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #8a8a8a; flex: none; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .t { font: 300 20px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-variant-numeric: tabular-nums; flex: 1; text-align: right; letter-spacing: -.01em; }
    .paused .t { color: #8a8a8a; }
    button { all: unset; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 7px; color: #bdbdbd; cursor: pointer; font-size: 12px; flex: none; }
    button:hover { background: #1f1f1f; color: #fff; }
    .min .row > :not(.dot):not(.t) { display: none; }
    .min { min-width: 0; }
    .min .t { font-size: 15px; }
  </style>
  <div class="w" part="w"></div>`;
  const box = root.querySelector('.w');

  let timer = null; let sw = null; let cfg = {}; let pos = null; let minimized = false;
  const act = (type, action) => chrome.runtime.sendMessage({ type, action }).catch(() => {});
  const fmt = ms => {
    const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
  };
  const tLeft = t => (t.running ? Math.max(0, t.endsAt - Date.now()) : t.remaining);
  const tActive = t => t && (t.running || t.remaining < t.total);
  const swMs = s => s.elapsed + (s.running ? Date.now() - s.startedAt : 0);
  const swActive = s => s && (s.running || s.elapsed > 0);
  const excluded = () => (cfg.widgetExcluded || []).some(d => location.hostname === d || location.hostname.endsWith('.' + d));

  function render() {
    const show = cfg.showWidget !== false && !excluded() && (tActive(timer) || swActive(sw));
    host.style.display = show ? 'block' : 'none';
    if (!show) return;
    const rows = [];
    if (tActive(timer)) {
      const color = timer.mode === 'focus' ? '#e5736b' : '#6cc28b';
      rows.push(`<div class="row ${timer.running ? '' : 'paused'}"><span class="dot" data-a="min" style="background:${color}" title="Minimise"></span>
        <span class="lbl" title="${timer.project ? String(timer.project.title).replace(/"/g, '') : ''}">${timer.mode === 'focus' ? (timer.project ? String(timer.project.title).replace(/[<>&"]/g, '').slice(0, 18) : 'Focus') : timer.mode === 'short' ? 'Break' : 'Long break'}</span>
        <span class="t" data-k="timer">${fmt(tLeft(timer))}</span>
        <button data-a="timer:toggle" title="${timer.running ? 'Pause' : 'Resume'}">${timer.running ? '❚❚' : '▶'}</button>
        <button data-a="timer:reset" title="Reset">↺</button>
        <button data-a="timer:skip" title="Skip to next">⏭</button></div>`);
    }
    if (swActive(sw)) {
      rows.push(`<div class="row ${sw.running ? '' : 'paused'}"><span class="dot" data-a="min" style="background:#8ab4f8" title="Minimise"></span>
        <span class="lbl">${sw.label ? sw.label.replace(/[<>&"]/g, '') : 'Stopwatch'}</span>
        <span class="t" data-k="sw">${fmt(swMs(sw))}</span>
        <button data-a="stopwatch:toggle" title="${sw.running ? 'Pause' : 'Resume'}">${sw.running ? '❚❚' : '▶'}</button>
        <button data-a="stopwatch:lap" title="Lap">⚑</button>
        <button data-a="stopwatch:discard" title="Reset (discard)">↺</button>
        <button data-a="stopwatch:reset" title="Stop and save to history">■</button></div>`);
    }
    box.innerHTML = rows.join('');
    box.classList.toggle('min', minimized);
  }
  // cheap per-second update of just the numbers
  setInterval(() => {
    if (host.style.display === 'none') return;
    const a = root.querySelector('[data-k=timer]'); if (a && timer) a.textContent = fmt(tLeft(timer));
    const b = root.querySelector('[data-k=sw]'); if (b && sw) b.textContent = fmt(swMs(sw));
  }, 250);

  function place() {
    if (!pos) return;
    const r = Math.min(Math.max(4, pos.right), window.innerWidth - 60);
    const b = Math.min(Math.max(4, pos.bottom), window.innerHeight - 40);
    host.style.right = r + 'px';
    host.style.bottom = b + 'px';
  }

  box.addEventListener('click', e => {
    const b = e.target.closest('[data-a]');
    if (!b || moved) return;
    if (b.dataset.a === 'min') { minimized = !minimized; chrome.storage.local.set({ widgetMin: minimized }); render(); return; }
    const [type, action] = b.dataset.a.split(':');
    act(type, action);
  });
  box.addEventListener('dblclick', e => { if (!e.target.closest('button')) act('open-app'); });

  // dragging
  let drag = null; let moved = false;
  box.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const r = host.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, right: window.innerWidth - r.right, bottom: window.innerHeight - r.bottom };
    moved = false;
    box.setPointerCapture(e.pointerId);
  });
  box.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) { moved = true; box.classList.add('drag'); }
    pos = { right: drag.right - dx, bottom: drag.bottom - dy };
    place();
  });
  box.addEventListener('pointerup', () => {
    if (drag && moved) chrome.storage.local.set({ widgetPos: pos });
    drag = null;
    box.classList.remove('drag');
    setTimeout(() => { moved = false; }, 0);
  });
  window.addEventListener('resize', place);

  chrome.storage.local.get(['timer', 'stopwatch', 'settings', 'widgetPos', 'widgetMin']).then(r => {
    timer = r.timer || null; sw = r.stopwatch || null; cfg = (r.settings && r.settings.value) || {};
    pos = r.widgetPos || null; minimized = !!r.widgetMin;
    (document.body || document.documentElement).appendChild(host);
    place();
    render();
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local') return;
    if (c.timer) timer = c.timer.newValue;
    if (c.stopwatch) sw = c.stopwatch.newValue;
    if (c.settings) cfg = (c.settings.newValue && c.settings.newValue.value) || {};
    if (c.widgetPos) { pos = c.widgetPos.newValue; place(); }
    if (c.widgetMin) minimized = !!c.widgetMin.newValue;
    if (c.timer || c.stopwatch || c.settings || c.widgetMin) render();
  });
})();
