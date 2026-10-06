// Dev-only stand-in for chrome.* so pages can be previewed in a normal browser:
//   python3 -m http.server -d extension 8820  ->  http://localhost:8820/dev/preview.html
(function () {
  const now = Date.now(), day = 86400000;
  const dk = n => { const d = new Date(now - n * day); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const sites = ['github.com','stackoverflow.com','youtube.com','docs.python.org','claude.ai','mail.google.com','news.ycombinator.com','notion.so','figma.com','linkedin.com'];
  const usage = {}; for (let i = 0; i < 120; i++) { if (i % 9 === 8) continue; usage[dk(i)] = {}; sites.forEach((s, k) => { usage[dk(i)][s] = Math.round((5 - k / 2.5) * 600 * (0.5 + ((i * 7 + k * 13) % 10) / 10)); }); }
  const focusLog = {}; for (let i = 0; i < 30; i++) if (i % 4 !== 3) focusLog[dk(i)] = { count: 2 + i % 4, minutes: 50 + (i * 17) % 110 };
  const rec = (o) => ({ ...o, updatedAt: now });
  const spaces = { s1: rec({ id: 's1', name: 'Work', order: 0 }), s2: rec({ id: 's2', name: 'Learning', order: 1 }), s3: rec({ id: 's3', name: 'Personal', order: 2 }) };
  const cols = [['c1','s1','Sprint 42 — API redesign'],['c2','s1','Code review queue'],['c3','s1','Design references'],['c4','s2','Rust async']];
  const collections = {}; cols.forEach(([id, sp, name], i) => collections[id] = rec({ id, spaceId: sp, name, order: i, collapsed: false, starred: i === 1 }));
  const cardData = { c1: [['OpenAPI spec draft','https://github.com/acme/api/pull/412'],['REST vs gRPC tradeoffs','https://cloud.google.com/blog/products/api-management'],['Pagination patterns','https://stackoverflow.com/questions/13872273'],['Rate limiting design','https://stripe.com/blog/rate-limiters'],['Idempotency keys','https://brandur.org/idempotency-keys']],
    c2: [['PR #418 auth middleware','https://github.com/acme/api/pull/418'],['PR #421 retries','https://github.com/acme/api/pull/421']],
    c3: [['Linear changelog','https://linear.app/changelog'],['Vercel dashboard','https://vercel.com/dashboard'],['Raycast','https://www.raycast.com/']],
    c4: [['Async book','https://rust-lang.github.io/async-book/'],['Tokio tutorial','https://tokio.rs/tokio/tutorial']] };
  const cards = {}; Object.entries(cardData).forEach(([c, list]) => list.forEach(([title, url], i) => { const id = c + i; cards[id] = rec({ id, collectionId: c, title, url, note: i === 0 && c === 'c1' ? 'Discuss Thursday' : '', order: i, starred: (c === 'c1' && i < 2) || (c === 'c3' && i === 0) }); }));
  const tasks = {}; [['Review PR #418', false, true], ['Write API migration notes', false, false], ['Book dentist', true, false]].forEach(([text, done, high], i) => tasks['t' + i] = rec({ id: 't' + i, text, done, high, order: i }));
  const L = (id, title, url, kind, dueH, status, extra = {}) => rec({ id, title, url, kind, due: dueH === null ? null : now + dueH * 3600000, remindAt: dueH === null ? null : now + (dueH - 1) * 3600000, status, priority: 'normal', minutes: null, tags: [], note: '', created: now - 86400000, thumb: '', author: '', playlist: false, ...extra });
  const later = Object.fromEntries([
    L('l1', 'Attention Is All You Need', 'https://arxiv.org/abs/1706.03762', 'paper', -5, 'doing', { author: 'arXiv.org', minutes: 45, tags: ['ml'] }),
    L('l2', 'Stanford CS229: Machine Learning (full course)', 'https://www.youtube.com/playlist?list=PLoROMvodv4rMiGQp3WXShtMGgzqpfVfbU', 'watch', 6, 'todo', { playlist: true, author: 'Stanford Online' }),
    L('l3', 'Microservices - Martin Fowler', 'https://martinfowler.com/articles/microservices.html', 'read', 30, 'todo', { priority: 'high', minutes: 25 }),
    L('l4', 'Designing Data-Intensive Applications - talk', 'https://www.youtube.com/watch?v=PdtlXdse7pw', 'watch', 100, 'todo', { author: 'GOTO Conferences', thumb: 'https://i.ytimg.com/vi/PdtlXdse7pw/hqdefault.jpg' }),
    L('l5', 'Lex Fridman Podcast #400', 'https://open.spotify.com/episode/x', 'listen', null, 'todo')
  ].map(x => [x.id, x]));
  const local = { later, usage, focusLog, spaces, collections, cards, tasks, account: { email: 'you@gmail.com', name: 'You' }, deviceId: 'dev1', lastSpace: 's1',
    timer: { mode: 'focus', running: true, remaining: 0, total: 25*60000, endsAt: now + 14*60000 + 37000, cycle: 2 },
    stopwatch: { running: true, startedAt: now - 47*60000, elapsed: 0, laps: [12*60000, 31*60000], label: 'API design' }, stopwatchLog: { [dk(0)]: [{ ms: 52*60000, label: 'Reading', at: now - 3*3600000 }] } };
  const tabs = ['GitHub - acme/api|https://github.com/acme/api','PR #418 · acme/api|https://github.com/acme/api/pull/418','How to paginate - Stack Overflow|https://stackoverflow.com/q/1','YouTube|https://www.youtube.com/','YouTube|https://www.youtube.com/','Gmail|https://mail.google.com/','Hacker News|https://news.ycombinator.com/','Claude|https://claude.ai/new']
    .map((s, i) => { const [title, url] = s.split('|'); return { id: i + 1, windowId: i < 5 ? 1 : 2, title, url, active: i === 0, pinned: false, lastAccessed: now - i * day, discarded: i === 6, groupId: -1, favIconUrl: '' }; });
  const store = obj => ({ get: async k => k == null ? { ...obj } : Array.isArray(k) ? Object.fromEntries(k.filter(x => x in obj).map(x => [x, obj[x]])) : (k in obj ? { [k]: obj[k] } : {}), set: async o => Object.assign(obj, o), remove: async k => { delete obj[k]; } });
  const ev = { addListener() {}, removeListener() {} };
  window.chrome = {
    storage: { local: store(local), sync: store({}), session: store({}), onChanged: ev },
    runtime: { onMessage: { addListener: f => (window.__sumiMsg = window.__sumiMsg || []).push(f) }, sendMessage: (m, cb) => cb({ ok: true, data: m.type === 'timer' ? local.timer : m.type === 'stopwatch' ? local.stopwatch : true }), getManifest: () => ({ oauth2: { client_id: 'x.apps.googleusercontent.com' } }), getURL: p => p, lastError: null },
    tabs: { query: async () => tabs, getCurrent: async () => null, update: async () => {}, remove: async () => {}, create: async () => {}, onCreated: ev, onRemoved: ev, onUpdated: ev, onMoved: ev, onAttached: ev },
    windows: { update: async () => {}, getCurrent: async () => ({ id: 1 }), create: async () => {} },
    identity: {}, alarms: {}, action: {}
  };
})();
