// Reading / watching progress for pages saved in Sumi Later: remembers how far you
// scrolled (or where a video was) and offers to resume. Runs only on pages whose
// URL is in your Later list; stores only a percentage / position in Sumi's storage.
(async () => {
  if (window.__sumiProgress || window.top !== window) return;
  window.__sumiProgress = true;
  const norm = u => { try { const x = new URL(u); x.hash = ''; ['utm_source', 'utm_medium', 'utm_campaign', 't'].forEach(p => x.searchParams.delete(p)); return x.href; } catch (e) { return u; } };
  const { later = {}, laterProgress = {} } = await chrome.storage.local.get(['later', 'laterProgress']);
  const here = norm(location.href);
  const item = Object.values(later).find(i => !i.deleted && i.status !== 'done' && norm(i.url) === here);
  if (!item) return;

  const video = () => document.querySelector('video');
  const saved = laterProgress[item.id];
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const v = video();
      const max = document.documentElement.scrollHeight - innerHeight;
      const p = v && v.duration ? { t: v.currentTime, pct: Math.round((100 * v.currentTime) / v.duration) } : { y: scrollY, pct: max > 0 ? Math.min(100, Math.round((100 * scrollY) / max)) : 0 };
      chrome.storage.local.get('laterProgress').then(r => chrome.storage.local.set({ laterProgress: { ...(r.laterProgress || {}), [item.id]: { ...p, at: Date.now() } } }));
    }, 1200);
  };
  addEventListener('scroll', save, { passive: true });
  setInterval(() => { const v = video(); if (v && !v.paused) save(); }, 10000);

  // offer to resume
  if (saved && ((saved.y || 0) > 400 || (saved.t || 0) > 20)) {
    const bar = document.createElement('sumi-resume');
    bar.style.cssText = 'all: initial; position: fixed; z-index: 2147483646; left: 50%; top: 16px; transform: translateX(-50%);';
    const r = bar.attachShadow({ mode: 'closed' });
    const label = saved.t ? `at ${Math.floor(saved.t / 60)}:${String(Math.floor(saved.t % 60)).padStart(2, '0')}` : `at ${saved.pct}%`;
    r.innerHTML = `<style>div{font:500 13px -apple-system,BlinkMacSystemFont,sans-serif;background:rgba(8,8,8,.94);color:#e6e6e6;border:1px solid #2a2a2a;border-radius:12px;padding:8px 8px 8px 14px;display:flex;gap:10px;align-items:center;box-shadow:0 10px 30px rgba(0,0,0,.5)}
      button{all:unset;cursor:pointer;padding:5px 10px;border-radius:8px;background:#8ab4f8;color:#000;font-weight:600}button.x{background:transparent;color:#999}</style>
      <div>Sumi: you left off ${label}<button id="go">Resume</button><button class="x" id="x">✕</button></div>`;
    r.getElementById('go').onclick = () => {
      const v = video();
      if (saved.t && v) v.currentTime = saved.t; else scrollTo({ top: saved.y, behavior: 'smooth' });
      bar.remove();
    };
    r.getElementById('x').onclick = () => bar.remove();
    (document.body || document.documentElement).appendChild(bar);
    setTimeout(() => bar.remove(), 15000);
  }
})();
