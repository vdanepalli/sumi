// Floating video progress: % watched, elapsed / total, time left (at the current
// speed) and when the video will end. Appears on its own for videos longer than
// Settings → "Video progress" minutes, or on demand (shortcut, popup, right-click).
// Drag to move, click the % to shrink, ✕ to hide for this video. Follows the
// player into full screen. Reads only the <video> element's time, nothing else.
(() => {
  if (window.__sumiVideo || window.top !== window) return;
  window.__sumiVideo = true;

  const host = document.createElement('sumi-video');
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; left: 20px; bottom: 20px; display: none;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
  <style>
    :host { all: initial; }
    .w { font: 500 12px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #e6e6e6;
      background: rgba(8, 8, 8, .86); border: 1px solid #2a2a2a; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.5);
      backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); padding: 8px 10px 9px; min-width: 210px;
      cursor: grab; user-select: none; -webkit-user-select: none; display: grid; gap: 6px; }
    .w.drag { cursor: grabbing; opacity: .9; }
    .top { display: flex; align-items: baseline; gap: 8px; }
    .pct { font: 300 22px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-variant-numeric: tabular-nums; cursor: pointer; }
    .left { flex: 1; color: #bdbdbd; font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
    .bar { height: 4px; border-radius: 4px; background: #262626; overflow: hidden; }
    .bar i { display: block; height: 100%; width: 0; background: var(--a, #8ab4f8); border-radius: 4px; }
    .sub { color: #8a8a8a; font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
    button { all: unset; cursor: pointer; color: #777; font-size: 11px; padding: 0 2px; }
    button:hover { color: #fff; }
    .min { min-width: 0; padding: 6px 9px; gap: 4px; }
    .min .left, .min .sub, .min button { display: none; }
    .min .pct { font-size: 15px; }
    .min .bar { height: 3px; }
  </style>
  <div class="w">
    <div class="top"><span class="pct" title="Click to shrink / expand">0%</span><span class="left"></span><button title="Hide for this video">✕</button></div>
    <div class="bar"><i></i></div>
    <div class="sub"></div>
  </div>`;
  const box = root.querySelector('.w');
  const $ = s => root.querySelector(s);

  let cfg = {}; let pos = null; let minimized = false;
  let video = null; let manual = null;      // manual: true = forced on, false = hidden for this video
  let videoKey = '';

  const fmt = s => {
    s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
  };
  const words = s => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
  const ok = v => v && Number.isFinite(v.duration) && v.duration > 0;

  // the main video: the largest one that has a real (not live) duration
  function pick() {
    let best = null; let area = 0;
    for (const v of document.querySelectorAll('video')) {
      if (!ok(v)) continue;
      const r = v.getBoundingClientRect(); const a = r.width * r.height;
      if (!best || a > area) { best = v; area = a; }
    }
    return best;
  }
  const keyOf = v => `${location.href}|${v ? Math.round(v.duration) : ''}`;

  function attach(v) {
    if (v === video) return;
    if (video) for (const ev of ['timeupdate', 'ratechange', 'pause', 'play']) video.removeEventListener(ev, render);
    video = v;
    if (video) for (const ev of ['timeupdate', 'ratechange', 'pause', 'play']) video.addEventListener(ev, render);
  }
  function check() {
    attach(pick());
    const k = keyOf(video);
    if (k !== videoKey) { videoKey = k; if (manual === false) manual = null; }  // new video: forget "hidden"
    render();
  }

  function shouldShow() {
    if (!ok(video) || manual === false) return false;
    if (manual === true) return true;
    const min = Number(cfg.videoAutoMin ?? 30);
    return cfg.videoProgress !== false && min > 0 && video.duration >= min * 60;
  }
  function render() {
    const show = shouldShow();
    host.style.display = show ? 'block' : 'none';
    if (!show) return;
    const t = video.currentTime; const d = video.duration; const rate = video.playbackRate || 1;
    const pct = Math.min(100, (100 * t) / d);
    const left = d - t;
    $('.pct').textContent = `${pct < 10 && pct > 0 ? pct.toFixed(1) : Math.floor(pct)}%`;
    $('.bar i').style.width = pct + '%';
    $('.left').textContent = `${fmt(left)} left`;
    const real = left / rate;
    const ends = new Date(Date.now() + real * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    $('.sub').textContent = `${fmt(t)} / ${fmt(d)}` + (rate !== 1 ? ` · ${words(real)} at ${rate}×` : '') + (video.paused ? ' · paused' : ` · ends ${ends}`);
    box.classList.toggle('min', minimized);
    if (cfg.accent) box.style.setProperty('--a', cfg.accent);
  }

  // follow the player into full screen (fixed elements outside it are hidden there)
  function mount() {
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    const parent = fs && fs.tagName !== 'VIDEO' ? fs : (document.body || document.documentElement);
    if (host.parentNode !== parent) parent.appendChild(host);
  }
  document.addEventListener('fullscreenchange', () => { mount(); place(); });
  document.addEventListener('webkitfullscreenchange', () => { mount(); place(); });

  function place() {
    // default: bottom-left of the page; top-left in full screen (clear of the player controls)
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (!pos) { Object.assign(host.style, fs ? { left: '24px', top: '24px', bottom: 'auto' } : { left: '20px', top: 'auto', bottom: '20px' }); return; }
    host.style.bottom = 'auto';
    host.style.left = Math.min(Math.max(4, pos.left), window.innerWidth - 80) + 'px';
    host.style.top = Math.min(Math.max(4, pos.top), window.innerHeight - 30) + 'px';
  }

  box.addEventListener('click', e => {
    if (moved) return;
    if (e.target.closest('button')) { manual = false; render(); return; }
    if (e.target.closest('.pct')) { minimized = !minimized; chrome.storage.local.set({ videoMin: minimized }); render(); }
  });

  // dragging (position shared by all tabs)
  let drag = null; let moved = false;
  box.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const r = host.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    moved = false;
  });
  box.addEventListener('pointermove', e => {
    if (!drag) return;
    if (!e.buttons) { drag = null; return; }   // button released outside before a drag began
    const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
    // capture only once dragging starts, so a plain click keeps its real target
    if (!moved && Math.abs(dx) + Math.abs(dy) > 3) { moved = true; box.classList.add('drag'); box.setPointerCapture(e.pointerId); }
    if (!moved) return;
    pos = { left: drag.left + dx, top: drag.top + dy };
    place();
  });
  box.addEventListener('pointerup', () => {
    if (drag && moved) chrome.storage.local.set({ videoPos: pos });
    drag = null;
    box.classList.remove('drag');
    setTimeout(() => { moved = false; }, 0);
  });
  window.addEventListener('resize', place);

  // manual toggle from the shortcut, popup or right-click menu
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type !== 'video-progress') return;
    check();
    if (!ok(video)) { reply({ ok: false, error: 'No video with a known length on this page' }); return; }
    manual = shouldShow() ? false : true;
    render();
    reply({ ok: true, shown: manual });
  });

  chrome.storage.local.get(['settings', 'videoPos', 'videoMin']).then(r => {
    cfg = (r.settings && r.settings.value) || {};
    pos = r.videoPos || null; minimized = !!r.videoMin;
    mount(); place();
    // videos appear late and change in place on sites like YouTube: listen for new
    // metadata anywhere on the page, and re-check now and then
    document.addEventListener('loadedmetadata', check, true);
    document.addEventListener('durationchange', check, true);
    setInterval(check, 3000);
    check();
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local') return;
    if (c.settings) { cfg = (c.settings.newValue && c.settings.newValue.value) || {}; render(); }
    if (c.videoPos) { pos = c.videoPos.newValue; place(); }
    if (c.videoMin) { minimized = !!c.videoMin.newValue; render(); }
  });
})();
