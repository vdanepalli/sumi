// Floating video progress: % watched, elapsed / total, time left (at the current
// speed) and when the video will end. Appears on its own for videos longer than
// Settings → "Video progress" minutes, or on demand (shortcut, popup, right-click).
// Drag to move, click the % to shrink, ✕ to hide for this video. Follows the
// player into full screen. Reads only the <video> element's time, nothing else.
//
// Opt-in tracking (◉ Track on the pill): for that video Sumi records real time spent
// watching, paused time, pauses, rewinds, skips, speed, sittings and which parts were
// seen, into the "videos" records (synced like everything else). Once a video is
// tracked, it keeps being tracked whenever you come back to it.
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
    .trk { display: flex; align-items: center; gap: 8px; color: #8a8a8a; font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .trk .st { flex: 1; cursor: pointer; }
    .trk .st:hover { color: #e6e6e6; }
    .rec { width: 7px; height: 7px; border-radius: 50%; background: #e5736b; flex: none; }
    .paused .rec { background: #666; }
    button { all: unset; cursor: pointer; color: #777; font-size: 11px; padding: 0 2px; }
    button:hover { color: #fff; }
    button.tb { border: 1px solid #333; border-radius: 6px; padding: 1px 7px; color: #bdbdbd; }
    button.tb:hover { border-color: #555; }
    .min { min-width: 0; padding: 6px 9px; gap: 4px; }
    .min .left, .min .sub, .min button, .min .trk { display: none; }
    .min .pct { font-size: 15px; }
    .min .bar { height: 3px; }
  </style>
  <div class="w">
    <div class="top"><span class="pct" title="Click to shrink / expand">0%</span><span class="left"></span><button class="x" title="Hide for this video">✕</button></div>
    <div class="bar"><i></i></div>
    <div class="sub"></div>
    <div class="trk"></div>
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
  const words = s => { if (s < 60) return `${Math.round(s)}s`; const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
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

  const EVENTS = ['timeupdate', 'ratechange', 'pause', 'play', 'seeked', 'ended'];
  function attach(v) {
    if (v === video) return;
    if (video) for (const ev of EVENTS) video.removeEventListener(ev, onMedia);
    video = v;
    if (video) for (const ev of EVENTS) video.addEventListener(ev, onMedia);
  }
  function onMedia(e) { track(e.type); render(); }

  function check() {
    attach(pick());
    const k = keyOf(video);
    if (k !== videoKey) { videoKey = k; if (manual === false) manual = null; loadTracking(); }  // new video: forget "hidden"
    render();
  }

  // ---------------- tracking ----------------
  // one id per video: YouTube by video id, anything else by its address without time / tracking params
  function videoId() {
    try {
      const u = new URL(location.href);
      const host2 = u.hostname.replace(/^(www|m|music)\./, '');
      if (host2 === 'youtube.com') {
        const v = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{6,})/) || [])[1];
        if (v) return { id: 'yt:' + v, url: `https://www.youtube.com/watch?v=${v}`, yt: v };
      }
      if (host2 === 'youtu.be') { const v = u.pathname.slice(1); return { id: 'yt:' + v, url: `https://www.youtube.com/watch?v=${v}`, yt: v }; }
      u.hash = '';
      for (const p of [...u.searchParams.keys()]) if (/^(t|start|time_continue|utm_.*|si|fbclid|gclid)$/.test(p)) u.searchParams.delete(p);
      return { id: 'url:' + u.href, url: u.href };
    } catch (e) { return null; }
  }
  const cleanTitle = () => (document.title || location.hostname).replace(/^\(\d+\)\s*/, '').replace(/\s*[-|–]\s*YouTube$/, '').trim();
  const adShowing = () => !!document.querySelector('.ad-showing, .ad-interrupting');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  let rec = null;           // the tracked record, or null
  let last = null;          // { t, wall, playing } from the previous media event
  let pauseMark = 0;        // paused time is counted up to here (while the page is open)
  let pauseStart = 0; let pauseEv = null;
  const PAUSE_CAP = 30 * 60 * 1000;   // a pause longer than this counts as a break, not paused time
  let dirty = false;
  const SITTING_GAP = 30 * 60 * 1000;

  async function loadTracking() {
    await save();
    rec = null; last = null; pauseMark = 0; pauseStart = 0; pauseEv = null;
    const vid = videoId();
    if (!ok(video) || !vid) return render();
    const { videos = {} } = await chrome.storage.local.get('videos');
    const r = videos[vid.id];
    if (r && !r.deleted && r.tracking) rec = r;
    else if (!r && cfg.videoAutoTrack && autoLength()) rec = newRecord(vid);
    render();
  }
  function newRecord(vid) {
    return {
      id: vid.id, url: vid.url, yt: vid.yt || null, site: location.hostname.replace(/^www\./, ''), title: cleanTitle(),
      duration: Math.round(video.duration), tracking: true, created: Date.now(), lastAt: Date.now(),
      watchedSec: 0, playedSec: 0, pausedSec: 0, pauses: 0, rewinds: 0, rewindSec: 0, skips: 0, skipSec: 0,
      sittings: 0, position: 0, segs: [], days: {}, events: [], completedAt: null
    };
  }
  async function startTracking() {
    const vid = videoId();
    if (!ok(video) || !vid) return;
    const { videos = {} } = await chrome.storage.local.get('videos');
    const r = videos[vid.id];
    rec = r && !r.deleted ? { ...r, tracking: true } : newRecord(vid);
    last = null; pauseMark = 0; pauseStart = 0; pauseEv = null;
    dirty = true; save(); render();
  }
  async function stopTracking() {
    if (!rec) return;
    flushPause();
    rec.tracking = false; dirty = true; await save();
    rec = null; render();
  }

  // merge [a, b] (video seconds) into the sorted list of watched ranges
  function addSeg(a, b) {
    if (b - a < 0.2) return;
    const segs = [...rec.segs, [Math.floor(a), Math.ceil(b)]].sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const s of segs) {
      const p = out[out.length - 1];
      if (p && s[0] <= p[1] + 1) p[1] = Math.max(p[1], s[1]); else out.push([s[0], s[1]]);
    }
    rec.segs = out;
  }
  const covered = () => rec.segs.reduce((n, [a, b]) => n + (b - a), 0);
  function event(e) { rec.events.push(e); if (rec.events.length > 400) rec.events.splice(0, rec.events.length - 400); }

  // a jump in the video's position: rewind or skip. Rapid jumps (dragging the
  // scrubber, tapping ← several times) are merged into one.
  function seek(from, to, now) {
    const prev = rec.events[rec.events.length - 1];
    if (prev && (prev.k === 'rewind' || prev.k === 'skip') && now - prev.at < 2500) {
      if (prev.k === 'rewind') { rec.rewinds -= 1; rec.rewindSec -= prev.from - prev.to; } else { rec.skips -= 1; rec.skipSec -= prev.to - prev.from; }
      rec.events.pop();
      from = prev.from;
    }
    if (Math.abs(to - from) < 1.5) return;
    if (to < from) { rec.rewinds += 1; rec.rewindSec += from - to; event({ k: 'rewind', from: Math.round(from), to: Math.round(to), at: now }); }
    else { rec.skips += 1; rec.skipSec += to - from; event({ k: 'skip', from: Math.round(from), to: Math.round(to), at: now }); }
  }
  function flushPause() {
    if (!rec || !pauseMark) return;
    const now = Math.min(Date.now(), pauseStart + PAUSE_CAP);
    if (now <= pauseMark) return;
    rec.pausedSec += (now - pauseMark) / 1000;
    if (pauseEv) pauseEv.dur = Math.round((pauseEv.dur || 0) + (now - pauseMark) / 1000);
    pauseMark = now;
  }

  function track(type) {
    if (!rec || !ok(video)) return;
    if (adShowing() || Math.abs(video.duration - rec.duration) > 3) { last = null; return; }   // an ad, or another video
    const now = Date.now(); const t = video.currentTime; const rate = video.playbackRate || 1;
    const playing = !video.paused && !video.ended;
    if (last) {
      const wallDt = (now - last.wall) / 1000; const dt = t - last.t;
      if (last.playing) {
        const expected = wallDt * rate;
        const normal = wallDt < 30 && Math.abs(dt - expected) <= Math.max(2, expected * 0.5);
        if (normal) {
          rec.watchedSec += wallDt; rec.playedSec += Math.max(0, dt);
          rec.days[today()] = (rec.days[today()] || 0) + wallDt;
          addSeg(last.t, t);
        } else seek(last.t, t, now);
      } else if (Math.abs(dt) > 1.5) seek(last.t, t, now);
    }
    if (type === 'play' || (playing && last && !last.playing)) { flushPause(); pauseMark = 0; pauseStart = 0; pauseEv = null; }
    if (playing && now - (rec.lastPlayAt || 0) > SITTING_GAP) rec.sittings += 1;   // back after 30+ min = a new sitting
    if (type === 'pause' && !video.ended && !adShowing() && (!last || last.playing)) {
      rec.pauses += 1; pauseMark = pauseStart = now;
      pauseEv = { k: 'pause', t: Math.round(t), at: now, dur: 0 }; event(pauseEv);
    }
    if (playing) rec.lastPlayAt = now;
    rec.position = Math.round(t); rec.lastAt = now;
    if (!rec.completedAt && covered() >= rec.duration * 0.95) { rec.completedAt = now; event({ k: 'done', at: now }); }
    last = { t, wall: now, playing };
    dirty = true;
    if (type === 'pause' || type === 'ended') save();
  }

  async function save() {
    if (!rec || !dirty) return;
    dirty = false;
    flushPause();
    const out = { ...rec, covered: covered(), updatedAt: Date.now() };
    for (const k of ['watchedSec', 'playedSec', 'pausedSec', 'rewindSec', 'skipSec']) out[k] = Math.round(out[k]);
    out.days = Object.fromEntries(Object.entries(out.days).map(([d, s]) => [d, Math.round(s)]));
    const { videos = {} } = await chrome.storage.local.get('videos');
    await chrome.storage.local.set({ videos: { ...videos, [out.id]: out } });
  }
  setInterval(() => { if (rec && !video?.paused) track('tick'); save(); }, 5000);
  addEventListener('pagehide', () => { save(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

  // ---------------- overlay ----------------
  const autoLength = () => { const min = Number(cfg.videoAutoMin ?? 30); return cfg.videoProgress !== false && min > 0 && video.duration >= min * 60; };
  function shouldShow() {
    if (!ok(video) || manual === false) return false;
    return manual === true || !!rec || autoLength();
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
    const trk = $('.trk');
    if (rec) {
      const seen = Math.min(100, Math.round((100 * covered()) / rec.duration));
      const txt = `${words(rec.watchedSec)} watched · ${seen}% seen · ${rec.pauses} pause${rec.pauses === 1 ? '' : 's'} · ${rec.rewinds} rewind${rec.rewinds === 1 ? '' : 's'}`;
      if (trk.dataset.s !== txt) {
        trk.dataset.s = txt;
        trk.innerHTML = '<span class="rec"></span><span class="st" title="Open in Sumi → Videos"></span><button class="tb" data-a="untrack" title="Stop tracking this video (keeps its stats)">Stop</button>';
        trk.querySelector('.st').textContent = txt;
      }
      trk.classList.toggle('paused', video.paused);
    } else if (trk.dataset.s !== '') {
      trk.dataset.s = '';
      trk.innerHTML = '<button class="tb" data-a="track" title="Record time watched, pauses, rewinds and what you have seen of this video">◉ Track this video</button>';
    }
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
    const a = e.target.closest('[data-a]');
    if (a && a.dataset.a === 'track') return startTracking();
    if (a && a.dataset.a === 'untrack') return stopTracking();
    if (e.target.closest('.st')) { save(); chrome.runtime.sendMessage({ type: 'open-app', hash: '#videos' }).catch(() => {}); return; }
    if (e.target.closest('.x')) { manual = false; render(); return; }
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
    // stopped or deleted from Sumi's Videos page
    if (c.videos && rec) { const r = (c.videos.newValue || {})[rec.id]; if (!r || r.deleted || !r.tracking) { rec = null; render(); } }
  });
})();
