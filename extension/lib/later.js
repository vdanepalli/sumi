// "Later": things to read / watch / study, with deadlines and reminders.
import { all, one, put, remove, uid, domainOf, safeUrl } from './store.js';

export const KINDS = { read: 'Read', watch: 'Watch', paper: 'Paper', listen: 'Listen' };
export const STATUS = { todo: 'Not started', doing: 'In progress', done: 'Done' };

const onDomain = (d, list) => new RegExp(`(^|\\.)(${list.map(x => x.replace(/\./g, '\\.')).join('|')})$`).test(d);
const LISTEN = ['open.spotify.com', 'podcasts.apple.com', 'music.apple.com', 'overcast.fm', 'soundcloud.com', 'pocketcasts.com', 'pca.st', 'castro.fm', 'castbox.fm', 'podbean.com', 'music.youtube.com', 'audible.com'];
const WATCH = ['youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv', 'loom.com', 'ted.com', 'coursera.org', 'udemy.com', 'dailymotion.com', 'nebula.tv'];
const PAPER = ['arxiv.org', 'doi.org', 'semanticscholar.org', 'acm.org', 'ieee.org', 'springer.com', 'sciencedirect.com', 'nature.com', 'biorxiv.org', 'medrxiv.org',
  'researchgate.net', 'ssrn.com', 'openreview.net', 'aclanthology.org', 'ncbi.nlm.nih.gov', 'jstor.org', 'plos.org', 'pnas.org', 'science.org', 'wiley.com',
  'mdpi.com', 'frontiersin.org', 'neurips.cc', 'mlr.press', 'scholar.archive.org'];
const pathOf = url => { try { return new URL(url).pathname; } catch (e) { return ''; } };

export function kindOf(url) {
  const d = domainOf(url) || '';
  if (onDomain(d, LISTEN)) return 'listen'; // before Watch: music.youtube.com
  if (onDomain(d, WATCH)) return 'watch';
  if (onDomain(d, PAPER) || /\.pdf$/i.test(pathOf(url))) return 'paper';
  return 'read';
}
export const isYoutube = url => onDomain(domainOf(url) || '', ['youtube.com', 'youtu.be']);
export const isPlaylist = url => isYoutube(url) && /[?&]list=/.test(url) && !/[?&]v=/.test(url);
const isVimeo = url => onDomain(domainOf(url) || '', ['vimeo.com']);

// same thing saved twice? (YouTube by video id, tracking params and #hash ignored)
export function urlKey(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    if (isYoutube(u)) {
      const v = x.searchParams.get('v') || (x.hostname.endsWith('youtu.be') ? x.pathname.slice(1) : (x.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]+)/) || [])[1]);
      if (v) return 'yt:' + v;
      if (x.searchParams.get('list')) return 'ytl:' + x.searchParams.get('list');
    }
    for (const p of [...x.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_[ce]id$|ref_src$)/.test(p)) x.searchParams.delete(p);
    return x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/$/, '') + x.search;
  } catch (e) { return u; }
}

// tab titles carry noise: "(3) Some video - YouTube"
const cleanTitle = t => (t || '').replace(/^\(\d+\+?\)\s*/, '').replace(/ - YouTube$/, '').trim();
const webImg = (u, base) => { try { const x = new URL(u, base); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (e) { return ''; } };

// fetch with a hard timeout that also covers reading the body; never sends cookies
async function fetchWithin(url, ms, read) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await read(await fetch(url, { signal: ctl.signal, credentials: 'omit' })); } finally { clearTimeout(t); }
}

// title + thumbnail for video links (oEmbed, no API key), else the page's own meta tags
export async function enrich(url) {
  const endpoint = isYoutube(url) ? 'https://www.youtube.com/oembed?format=json&url='
    : isVimeo(url) ? 'https://vimeo.com/api/oembed.json?url=' : null;
  if (endpoint) {
    try {
      const j = await fetchWithin(endpoint + encodeURIComponent(url), 4000, r => (r.ok ? r.json() : null));
      if (j?.title) return { title: String(j.title), author: String(j.author_name || ''), thumb: webImg(j.thumbnail_url || '') };
    } catch (e) { /* fall through */ }
    if (!isPlaylist(url)) return {}; // a YouTube / Vimeo page itself says no more (and is heavy)
  }
  return pageMeta(url);
}

// read at most `max` characters of a response body
async function readCapped(r, max) {
  const cs = (/charset=([\w-]+)/i.exec(r.headers.get('content-type') || '') || [])[1];
  let dec; try { dec = new TextDecoder(cs || 'utf-8'); } catch (e) { dec = new TextDecoder(); }
  const rd = r.body?.getReader();
  if (!rd) return (await r.text()).slice(0, max);
  let s = '';
  while (s.length < max) { const { done, value } = await rd.read(); if (done) break; s += dec.decode(value, { stream: true }); }
  rd.cancel().catch(() => {});
  return s;
}
const decode = s => s && s.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16) || 32)).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n) || 32))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// fallback for other links: <title> / og:title / og:image (6s max, first 300 KB)
async function pageMeta(url) {
  if (!/^https?:/i.test(url) || /\.pdf$/i.test(pathOf(url))) return {};
  try {
    return await fetchWithin(url, 6000, async r => {
      if (!r.ok || !/html/.test(r.headers.get('content-type') || '')) return {};
      // bounced to a sign-in page on another host: its title is not this page's
      if (r.url && domainOf(r.url) !== domainOf(url)) return {};
      const html = await readCapped(r, 300000);
      const metas = {};
      for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
        const at = {};
        for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) at[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4];
        const k = (at.property || at.name || '').toLowerCase();
        if (k && at.content && !(k in metas)) metas[k] = at.content;
      }
      const title = decode(metas['og:title'] || metas['twitter:title'] || (html.match(/<title[^>]*>([^<]+)/i) || [])[1]);
      return { title: title ? cleanTitle(title) : undefined, thumb: webImg(decode(metas['og:image'] || metas['twitter:image'] || ''), r.url || url), author: decode(metas['og:site_name'] || metas.author || '') || '' };
    });
  } catch (e) { return {}; }
}

export async function items() { return all('later'); }
export async function find(url) { const k = urlKey(url); return (await items()).find(i => i.status !== 'done' && urlKey(i.url) === k) || null; }

export async function add({ url, title, kind, due = null, remindBefore = null, remindAt = null, priority = 'normal', minutes = null, tags = [], note = '' }) {
  if (!safeUrl(url)) throw new Error('Only web links (http / https) can be saved');
  const existing = await find(url);
  if (existing) return { ...existing, existed: true };
  const given = title && title !== url ? cleanTitle(title) : '';
  const meta = await enrich(url);
  const again = await find(url); // saved meanwhile (double press / several tabs)
  if (again) return { ...again, existed: true };
  const item = {
    id: uid(), url, title: ((isYoutube(url) || isVimeo(url)) && meta.title) || given || meta.title || url, kind: KINDS[kind] ? kind : kindOf(url), playlist: isPlaylist(url),
    author: meta.author || '', thumb: meta.thumb || '',
    due: Number(due) || null, remindBefore, remindAt: remindAt || reminderTime(due, remindBefore),
    status: 'todo', priority, minutes, tags, note, created: Date.now(), doneAt: null
  };
  return put('later', item);
}
export async function patch(id, p) {
  const it = await one('later', id);
  if (!it) return null;
  if ('url' in p && !safeUrl(p.url)) delete p.url;
  const next = { ...it, ...p };
  // only a real change of deadline / reminder re-arms the reminder (and drops a snooze)
  const timing = ('due' in p && (p.due || null) !== (it.due || null)) || ('remindBefore' in p && (p.remindBefore ?? null) !== (it.remindBefore ?? null));
  if (timing) next.remindAt = 'remindAt' in p ? p.remindAt : reminderTime(next.due, next.remindBefore);
  if (timing || ('remindAt' in p && p.remindAt !== it.remindAt)) next.reminded = false; // new time: remind again
  if (p.status === 'done' && it.status !== 'done') next.doneAt = Date.now();
  if (p.status && p.status !== 'done') next.doneAt = null;
  return put('later', next);
}
export const del = id => remove('later', id);

// "Keep reminding me until it's done" (opt in per item): nag = { every: minutes, next: time, sent: count }
export const NAG_EVERY = [[30, 'Every 30 min'], [60, 'Every hour'], [120, 'Every 2 hours'], [240, 'Every 4 hours'], [1440, 'Once a day']];
export const nagLabel = m => (NAG_EVERY.find(([v]) => v === m) || [0, `Every ${m} min`])[1];
export const nagOf = (every, now = Date.now()) => (every > 0 ? { every, next: now + every * 60000, sent: 0 } : null);
export const inHours = (h, from, to) => from === to || (from < to ? h >= from && h < to : h >= from || h < to);
// the next nudge: `every` minutes from now, moved to the start of the allowed hours if it falls outside them
export function nagNext(every, from = 9, to = 21, now = Date.now()) {
  const t = new Date(now + every * 60000);
  if (inHours(t.getHours(), from, to)) return t.getTime();
  if (from < to && t.getHours() >= to) t.setDate(t.getDate() + 1);
  t.setHours(from, 0, 0, 0);
  return t.getTime();
}

// remindBefore: minutes before the deadline (0 = at the deadline, null = no reminder)
export function reminderTime(due, remindBefore) {
  if (!due || remindBefore === null || remindBefore === undefined || remindBefore === '') return null;
  return due - Number(remindBefore) * 60000;
}

// deadline shortcuts (local time)
export function presetDue(key) {
  const d = new Date();
  const at = (days, h = 20, m = 0) => { const x = new Date(d); x.setDate(x.getDate() + days); x.setHours(h, m, 0, 0); return x.getTime(); };
  const soon = d.getTime() + 3600000;
  if (key === 'tonight') return at(0, 21) >= soon ? at(0, 21) : at(0, 23, 59) >= soon ? at(0, 23, 59) : soon; // late at night: an hour from now
  if (key === 'tomorrow') return at(1, 20);
  if (key === 'weekend') { const add = (7 - d.getDay()) % 7; return at(add === 0 && at(0, 20) < soon ? 7 : add, 20); } // Sunday evening
  if (key === 'week') return at(7, 20);
  if (key === 'month') return at(30, 20);
  return null;
}

export function bucket(it, now = Date.now()) {
  if (it.status === 'done') return 'done';
  if (!it.due) return 'nodate';
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  const week = new Date(end); week.setDate(week.getDate() + 7);
  if (it.due < now) return 'overdue';
  if (it.due <= end.getTime()) return 'today';
  if (it.due <= week.getTime()) return 'week';
  return 'later';
}
export const BUCKETS = [['overdue', 'Overdue'], ['today', 'Today'], ['week', 'Next 7 days'], ['later', 'Later'], ['nodate', 'No deadline'], ['done', 'Done']];

export function relTime(ts) {
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000); const h = Math.round(abs / 3600000); const d = Math.round(abs / 86400000);
  const s = m < 60 ? `${m}m` : h < 36 ? `${h}h` : `${d}d`;
  return diff < 0 ? `${s} overdue` : `in ${s}`;
}

// reading / watching time of an open page in minutes: its longest video, else words / 230
export async function estimateTab(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const v = [...document.querySelectorAll('video')].filter(x => isFinite(x.duration) && x.duration > 60).sort((a, b) => b.duration - a.duration)[0];
      if (v) return v.duration / 60;
      const el = document.querySelector('article') || document.querySelector('main') || document.body;
      return (el?.innerText || '').split(/\s+/).filter(Boolean).length / 230;
    } });
    const m = Math.round(r?.result || 0);
    return m >= 1 ? Math.min(m, 10000) : null;
  } catch (e) { return null; }
}

// snooze a tab: closed now, back at one of these times (local)
export const SNOOZE = [['3h', 'In 3 hours'], ['evening', 'This evening'], ['tomorrow', 'Tomorrow morning'], ['weekend', 'This weekend'], ['week', 'Next week']];
export function snoozeAt(key, now = new Date()) {
  const at = (days, h) => { const x = new Date(now); x.setDate(x.getDate() + days); x.setHours(h, 0, 0, 0); return x.getTime(); };
  if (key === '3h') return now.getTime() + 3 * 3600000;
  if (key === 'evening') return now.getHours() < 17 ? at(0, 18) : at(1, 18);
  if (key === 'tomorrow') return at(1, 9);
  if (key === 'weekend') { const d = (6 - now.getDay() + 7) % 7 || 7; return at(d, 10); } // Saturday 10:00 (next one if today is Saturday)
  if (key === 'week') return at(((8 - now.getDay()) % 7) || 7, 9); // next Monday 9:00
  return null;
}
export const whenLabel = ts => new Date(ts).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
