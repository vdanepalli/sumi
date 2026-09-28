// Dictionary lookups (free, key-less https://dictionaryapi.dev) and the vocabulary
// store with spaced repetition (Leitner boxes).
import { list, put, get, uid } from './store.js';

const API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
// days until the next review for each box; box 5+ counts as mastered
export const INTERVALS = [0, 1, 3, 7, 16, 35, 90];
export const MASTERED_BOX = 5;
const DAY = 86400000;

export const normalize = t => t.trim().replace(/\s+/g, ' ').replace(/^["'“”‘’(]+|["'“”‘’).,;:!?]+$/g, '').toLowerCase();
export const kindOf = t => (t.includes(' ') ? 'phrase' : 'word');

// Wiktionary (free, key-less) - good coverage of idioms and phrases
const WIKT = 'https://en.wiktionary.org/api/rest_v1/page/definition/';
const strip = h => String(h || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
async function lookupWiktionary(term) {
  const res = await fetch(WIKT + encodeURIComponent(term.replace(/ /g, '_'))).catch(() => null);
  if (!res) return undefined;                 // network problem
  if (res.status === 404) return null;        // definitely not in Wiktionary
  if (!res.ok) return undefined;
  const data = await res.json();
  const meanings = (data.en || []).slice(0, 4).map(e => ({
    pos: (e.partOfSpeech || '').toLowerCase(),
    defs: (e.definitions || []).map(d => ({ d: strip(d.definition), e: strip((d.parsedExamples?.[0]?.example) || d.examples?.[0] || '') })).filter(d => d.d).slice(0, 3),
    syn: []
  })).filter(m => m.defs.length);
  return meanings.length ? { term, found: true, phonetic: '', audio: '', meanings, source: 'wiktionary' } : null;
}

export async function lookup(term) {
  term = normalize(term);
  if (!term) return null;
  // phrases/idioms: Wiktionary first; words: dictionaryapi.dev first, Wiktionary as fallback
  if (term.includes(' ')) {
    const w = await lookupWiktionary(term);
    if (w) return w;
  }
  try {
    const r = await lookupDictApi(term);
    if (r.found) return r;
  } catch (e) {
    const w = await lookupWiktionary(term);
    if (w) return w;
    if (w === null) return { term, found: false, meanings: [] }; // unknown word, not an outage
    throw e;
  }
  return (await lookupWiktionary(term)) || { term, found: false, meanings: [] };
}

async function lookupDictApi(term) {
  // the free service has occasional gateway errors (5xx): retry a couple of times
  let res;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    res = await fetch(API + encodeURIComponent(term)).catch(() => null);
    if (res && res.status < 500) break;
    await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
  }
  if (!res) throw new Error('Dictionary is unreachable - check your connection');
  if (res.status === 404) return { term, found: false, meanings: [] };
  if (!res.ok) throw new Error(`Dictionary service is busy (${res.status}) - try again in a moment`);
  const data = await res.json();
  const first = data[0] || {};
  const phon = (data.flatMap(e => e.phonetics || []).find(p => p.text && p.audio) || data.flatMap(e => e.phonetics || []).find(p => p.text) || {});
  const audio = data.flatMap(e => e.phonetics || []).map(p => p.audio).find(Boolean) || '';
  const meanings = [];
  for (const e of data) {
    for (const m of e.meanings || []) {
      let slot = meanings.find(x => x.pos === m.partOfSpeech);
      if (!slot) meanings.push((slot = { pos: m.partOfSpeech, defs: [], syn: [] }));
      for (const d of m.definitions || []) if (slot.defs.length < 3) slot.defs.push({ d: d.definition, e: d.example || '' });
      slot.syn = [...new Set([...slot.syn, ...(m.synonyms || [])])].slice(0, 6);
    }
  }
  return { term: first.word || term, found: true, phonetic: phon.text || first.phonetic || '', audio, meanings: meanings.slice(0, 4) };
}

export async function findTerm(term) {
  const n = normalize(term);
  return (await list('vocab')).find(v => v.term === n) || null;
}

// save (or bump) a term; `info` is a lookup() result
export async function saveTerm(info, extra = {}) {
  const term = normalize(info.term);
  const existing = await findTerm(term);
  if (existing) {
    existing.lookups = (existing.lookups || 1) + 1;
    // looking it up again is a sign it is not known yet: bring it back for review
    existing.box = Math.min(existing.box, 1);
    existing.due = Date.now();
    if (info.found && !existing.meanings.length) Object.assign(existing, { phonetic: info.phonetic, audio: info.audio, meanings: info.meanings });
    return put('vocab', existing);
  }
  return put('vocab', {
    id: uid(), term, kind: extra.kind || kindOf(term),
    phonetic: info.phonetic || '', audio: info.audio || '', meanings: info.meanings || [],
    note: extra.note || '', source: extra.source || null,
    created: Date.now(), box: 0, due: Date.now(), reviews: 0, lapses: 0, lookups: 1
  });
}

// grade: 0 again, 1 hard, 2 good, 3 easy
export async function review(item, grade) {
  item.reviews = (item.reviews || 0) + 1;
  if (grade === 0) { item.box = 0; item.lapses = (item.lapses || 0) + 1; }
  else if (grade === 1) item.box = Math.max(1, item.box);
  else item.box = Math.min(INTERVALS.length - 1, item.box + grade - 1);
  const days = grade === 0 ? 0 : INTERVALS[item.box] || 1;
  item.due = grade === 0 ? Date.now() + 10 * 60000 : Date.now() + days * DAY;
  item.lastReview = Date.now();
  return put('vocab', item);
}

export async function stats() {
  const all = await list('vocab');
  const now = Date.now();
  return {
    total: all.length,
    mastered: all.filter(v => v.box >= MASTERED_BOX).length,
    learning: all.filter(v => v.box > 0 && v.box < MASTERED_BOX).length,
    fresh: all.filter(v => v.box === 0).length,
    due: all.filter(v => v.due <= now).length,
    words: all.filter(v => v.kind === 'word').length,
    phrases: all.filter(v => v.kind !== 'word').length
  };
}

export async function dueItems(limit = 30) {
  const now = Date.now();
  return (await list('vocab')).filter(v => v.due <= now).sort((a, b) => a.due - b.due).slice(0, limit);
}

// same word all day, changes daily
export async function wordOfDay() {
  const all = (await list('vocab')).filter(v => v.meanings.length);
  if (!all.length) return null;
  const d = new Date();
  const seed = d.getFullYear() * 400 + d.getMonth() * 31 + d.getDate();
  const pool = all.filter(v => v.box < MASTERED_BOX);
  const from = pool.length ? pool : all;
  return from.sort((a, b) => a.id.localeCompare(b.id))[seed % from.length];
}

export const firstDef = v => (v.meanings[0] && v.meanings[0].defs[0] ? v.meanings[0].defs[0].d : v.note || '');
export { get };
