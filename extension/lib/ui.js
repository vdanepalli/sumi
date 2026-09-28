// small shared UI helpers
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

let toastTimer;
export function toast(msg) {
  let t = $('#toast');
  if (!t) { t = h('<div class="toast" id="toast"></div>'); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = s % 60;
  return hh ? `${hh}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
export function dur(secs) {
  const m = Math.round(secs / 60);
  if (secs < 60) return `${Math.round(secs)}s`;
  if (m < 60) return `${m}m`;
  const hh = Math.floor(m / 60);
  return hh < 100 ? `${hh}h ${m % 60 ? (m % 60) + 'm' : ''}`.trim() : `${hh}h`;
}
export const favicon = url => {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url.includes('://') ? url : 'https://' + url).hostname}&sz=32`; } catch (e) { return ''; }
};
export const send = msg => new Promise(res => chrome.runtime.sendMessage(msg, r => res(r || { ok: false, error: chrome.runtime.lastError?.message })));
export function applyAccent(color) { if (color) document.documentElement.style.setProperty('--accent', color); }

// broken images: extension pages cannot use inline onerror="" (CSP), so fall back here
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.fb) return;
  if (img.dataset.fb === 'hide') img.style.visibility = 'hidden';
  else if (!img.src.endsWith(img.dataset.fb)) img.src = img.dataset.fb;
}, true);

// Cancel buttons are type="button" so Enter submits the OK button; close their dialog here
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('button[value="cancel"]');
  const d = b && b.closest('dialog');
  if (d) d.close('cancel');
});

// promise-based dialogs styled like the app
export function ask({ title, text = '', value, ok = 'OK', danger = false, cancel = 'Cancel' }) {
  return new Promise(resolve => {
    const d = h(`<dialog class="modal small"><form method="dialog">
      <h3>${esc(title)}</h3>${text ? `<p class="muted">${esc(text)}</p>` : ''}
      ${value !== undefined ? `<input type="text" name="v" value="${esc(value)}" autocomplete="off">` : ''}
      <div class="row end"><button type="button" value="cancel" class="ghost">${esc(cancel)}</button><button type="submit" value="ok" class="${danger ? 'danger-solid' : 'primary'}">${esc(ok)}</button></div>
    </form></dialog>`);
    document.body.appendChild(d);
    d.addEventListener('close', () => {
      const v = d.returnValue === 'ok' ? (value !== undefined ? d.querySelector('input').value.trim() : true) : null;
      d.remove();
      resolve(v);
    });
    d.showModal();
    const inp = d.querySelector('input');
    if (inp) { inp.focus(); inp.select(); }
  });
}
export const confirmBox = (title, text, ok = 'Delete') => ask({ title, text, ok, danger: true });

export function downloadJson(name, data) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.download = name;
  a.click();
}
export function pickFile(accept) {
  return new Promise(resolve => {
    const i = Object.assign(document.createElement('input'), { type: 'file', accept });
    i.onchange = async () => resolve(i.files[0] ? await i.files[0].text() : null);
    i.click();
  });
}
