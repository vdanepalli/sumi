// small shared UI helpers
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

export const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export function dur(secs) {
  const m = Math.round(secs / 60);
  if (m < 1) return `${Math.round(secs)}s`;
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + 'm' : ''}`.trim();
}
export const favicon = url => {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url.includes('://') ? url : 'https://' + url).hostname}&sz=32`; } catch (e) { return ''; }
};

export const send = msg => new Promise(res => chrome.runtime.sendMessage(msg, r => res(r || { ok: false })));

export function applyAccent(color) { if (color) document.documentElement.style.setProperty('--accent', color); }

export function defHtml(r, opts = {}) {
  if (!r) return '';
  const head = `<div class="row"><span class="term">${esc(r.term)}</span>${r.phonetic ? `<span class="muted">${esc(r.phonetic)}</span>` : ''}
    ${r.audio ? `<button class="ghost small" data-audio="${esc(r.audio)}" title="Pronounce">🔊</button>` : ''}<span class="sp"></span>${opts.actions || ''}</div>`;
  if (!r.found && !(r.meanings || []).length) return `<div class="def">${head}<div class="muted small">No dictionary entry. ${opts.missing || ''}</div></div>`;
  const body = (r.meanings || []).map(m => `<div class="pos">${esc(m.pos)}</div><ol>${m.defs.map(d => `<li>${esc(d.d)}${d.e ? `<div class="ex">“${esc(d.e)}”</div>` : ''}</li>`).join('')}</ol>${m.syn?.length ? `<div class="syn">≈ ${m.syn.map(esc).join(', ')}</div>` : ''}`).join('');
  return `<div class="def">${head}${body}</div>`;
}
export function wireAudio(root) {
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-audio]');
    if (b) new Audio(b.dataset.audio).play().catch(() => {});
  });
}
