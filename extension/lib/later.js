// "Later": things to read / watch / study, with deadlines and reminders.
import { all, one, put, remove, uid, domainOf, safeUrl } from './store.js';

export const KINDS = { read: 'Read', watch: 'Watch', paper: 'Paper', listen: 'Listen' };
export const STATUS = { todo: 'Not started', doing: 'In progress', done: 'Done' };

export function kindOf(url) {
  const d = domainOf(url) || '';
  if (/(^|\.)(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|loom\.com|ted\.com|coursera\.org|udemy\.com)$/.test(d)) return 'watch';
  if (/(^|\.)(open\.spotify\.com|podcasts\.apple\.com|overcast\.fm|soundcloud\.com)$/.test(d)) return 'listen';
  if (/(^|\.)(arxiv\.org|doi\.org|semanticscholar\.org|acm\.org|ieee\.org|springer\.com|sciencedirect\.com|nature\.com|biorxiv\.org|researchgate\.net|papers\.ssrn\.com|openreview\.net)$/.test(d) || /\.pdf($|\?)/i.test(url)) return 'paper';
  return 'read';
}
export const isYoutube = url => /(^|\.)(youtube\.com|youtu\.be)$/.test(domainOf(url) || '');
export const isPlaylist = url => isYoutube(url) && /[?&]list=/.test(url) && !/[?&]v=/.test(url);

// title + thumbnail for video links (oEmbed, no API key)
export async function enrich(url) {
  const endpoint = isYoutube(url) ? 'https://www.youtube.com/oembed?format=json&url='
    : /vimeo\.com/.test(url) ? 'https://vimeo.com/api/oembed.json?url=' : null;
  if (endpoint) {
    try {
      const r = await fetch(endpoint + encodeURIComponent(url));
      if (r.ok) { const j = await r.json(); if (j.title) return { title: j.title, author: j.author_name, thumb: j.thumbnail_url }; }
    } catch (e) { /* fall through */ }
  }
  return pageMeta(url);
}

// fallback for pasted links (articles, playlists): read <title> / og:title / og:image
async function pageMeta(url) {
  if (/\.pdf($|\?)/i.test(url)) return {};
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(url, { signal: ctl.signal, credentials: 'omit' });
    clearTimeout(t);
    if (!r.ok || !/html/.test(r.headers.get('content-type') || '')) return {};
    const html = (await r.text()).slice(0, 300000);
    const meta = p => (html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']+)`, 'i')) || [])[1];
    const decode = s => s && s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    const title = decode(meta('og:title') || (html.match(/<title[^>]*>([^<]+)/i) || [])[1]);
    return { title: title ? title.replace(/ - YouTube$/, '') : undefined, thumb: meta('og:image') || '', author: decode(meta('og:site_name') || meta('author')) || '' };
  } catch (e) { return {}; }
}

export async function items() { return all('later'); }
export async function find(url) { return (await items()).find(i => i.url === url && i.status !== 'done') || null; }

export async function add({ url, title, kind, due = null, remindBefore = null, remindAt = null, priority = 'normal', minutes = null, tags = [], note = '' }) {
  if (!safeUrl(url)) throw new Error('Only web links (http / https) can be saved');
  const existing = await find(url);
  if (existing) return existing;
  const meta = await enrich(url);
  const item = {
    id: uid(), url, title: meta.title || title || url, kind: kind || kindOf(url), playlist: isPlaylist(url),
    author: meta.author || '', thumb: meta.thumb || '',
    due, remindBefore, remindAt: remindAt || reminderTime(due, remindBefore),
    status: 'todo', priority, minutes, tags, note, created: Date.now(), doneAt: null
  };
  return put('later', item);
}
export async function patch(id, p) {
  const it = await one('later', id);
  if (!it) return null;
  if (p.url && !safeUrl(p.url)) delete p.url;
  const next = { ...it, ...p };
  if ('due' in p || 'remindBefore' in p) next.remindAt = p.remindAt ?? reminderTime(next.due, next.remindBefore);
  if ('due' in p || 'remindBefore' in p || 'remindAt' in p) next.reminded = false; // new time: remind again
  if (p.status === 'done' && it.status !== 'done') next.doneAt = Date.now();
  if (p.status && p.status !== 'done') next.doneAt = null;
  return put('later', next);
}
export const del = id => remove('later', id);

// remindBefore: minutes before the deadline (0 = at the deadline, null = no reminder)
export function reminderTime(due, remindBefore) {
  if (!due || remindBefore === null || remindBefore === undefined || remindBefore === '') return null;
  return due - Number(remindBefore) * 60000;
}

// deadline shortcuts
export function presetDue(key) {
  const d = new Date();
  const at = (days, h = 20) => { const x = new Date(d); x.setDate(x.getDate() + days); x.setHours(h, 0, 0, 0); return x.getTime(); };
  if (key === 'tonight') return at(0, 21);
  if (key === 'tomorrow') return at(1, 20);
  if (key === 'weekend') { const add = (6 - d.getDay() + 7) % 7 || 7; return at(add, 12); }
  if (key === 'week') return at(7, 20);
  if (key === 'month') return at(30, 20);
  return null;
}

export function bucket(it, now = Date.now()) {
  if (it.status === 'done') return 'done';
  if (!it.due) return 'nodate';
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const week = new Date(end); week.setDate(week.getDate() + 7);
  if (it.due < now) return 'overdue';
  if (it.due <= end.getTime()) return 'today';
  if (it.due <= week.getTime()) return 'week';
  return 'later';
}
export const BUCKETS = [['overdue', 'Overdue'], ['today', 'Today'], ['week', 'This week'], ['later', 'Later'], ['nodate', 'No deadline'], ['done', 'Done']];

export function relTime(ts) {
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000); const h = Math.round(abs / 3600000); const d = Math.round(abs / 86400000);
  const s = m < 60 ? `${m}m` : h < 36 ? `${h}h` : `${d}d`;
  return diff < 0 ? `${s} overdue` : `in ${s}`;
}
