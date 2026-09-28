// Dev-only stand-in for the chrome.* APIs so the pages can be previewed in a normal
// browser (python3 -m http.server, then open /dev/preview.html). Not shipped.
(function () {
  const now = Date.now(), day = 86400000;
  const dk = n => { const d = new Date(now - n * day); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const usage = {}; for (let i = 0; i < 7; i++) usage[dk(i)] = { 'github.com': 3600 + i * 400, 'stackoverflow.com': 1800, 'youtube.com': 2400 - i * 200, 'docs.python.org': 900, 'claude.ai': 2700, 'mail.google.com': 600, 'news.ycombinator.com': 500 };
  const focusLog = {}; [0,1,2,4,5].forEach((i, k) => focusLog[dk(i)] = { count: 3 + k % 3, minutes: 75 + k * 20 });
  const v = (term, kind, box, pos, d, e) => ({ id: term, term, kind, box, due: now - (box < 2 ? 1 : -day * box), created: now - box * day, phonetic: kind === 'word' ? '/ˈsʌm/' : '', meanings: [{ pos, defs: [{ d, e }], syn: [] }], lookups: 1 + (box % 3), reviews: box * 2 });
  const vocab = {}; [
    v('ephemeral','word',1,'adjective','Lasting a very short time.','Fame in the digital age is ephemeral.'),
    v('break the ice','idiom',0,'verb','To start to get to know people and ease tension.',''),
    v('laconic','word',5,'adjective','Using very few words.','His laconic reply ended the debate.'),
    v('ubiquitous','word',3,'adjective','Present, appearing, or found everywhere.',''),
    v('under the weather','idiom',2,'adjective','Ill or gloomy, especially from a cold.',''),
    v('serendipity','word',6,'noun','The occurrence of events by chance in a happy way.','')
  ].forEach(x => vocab[x.id] = x);
  const sessions = { a: { id: 'a', name: 'Research: Rust async', created: now - day, tabs: Array(9).fill({ url: 'https://docs.rs' }) }, b: { id: 'b', name: 'Trip planning', created: now - 3*day, tabs: Array(5).fill({ url: 'https://maps.google.com' }) } };
  const local = { usage, focusLog, vocab, sessions, timer: { mode: 'focus', running: true, remaining: 0, total: 25*60000, endsAt: now + 14*60000 + 37000, cycle: 2 } };
  const tabs = ['GitHub - anthropics/claude-code|https://github.com/anthropics/claude-code','Pull requests · github|https://github.com/pulls','python - How to merge dicts - Stack Overflow|https://stackoverflow.com/q/38987','Rust async book|https://rust-lang.github.io/async-book/','YouTube|https://www.youtube.com/','YouTube|https://www.youtube.com/','Gmail - Inbox|https://mail.google.com/mail/u/0/','Hacker News|https://news.ycombinator.com/','Claude|https://claude.ai/new','3.13 Documentation|https://docs.python.org/3/']
    .map((s, i) => { const [title, url] = s.split('|'); return { id: i + 1, windowId: i < 6 ? 1 : 2, title, url, active: i === 0, pinned: false, lastAccessed: now - i * day * 0.8, discarded: i === 7, groupId: -1, favIconUrl: '' }; });
  const store = obj => ({ get: async k => k == null ? { ...obj } : (typeof k === 'string' ? (k in obj ? { [k]: obj[k] } : {}) : {}), set: async o => Object.assign(obj, o), remove: async k => { delete obj[k]; } });
  const ev = { addListener() {} };
  window.chrome = {
    storage: { local: store(local), sync: store({}), session: store({}), onChanged: ev },
    runtime: { sendMessage: (m, cb) => cb({ ok: true, data: m.type === 'timer' ? local.timer : true }), getManifest: () => ({ oauth2: { client_id: 'REPLACE_' } }), getURL: p => p },
    tabs: { query: async () => tabs, getCurrent: async () => null, onCreated: ev, onRemoved: ev, update: async () => {}, remove: async () => {} },
    windows: { update: async () => {}, getCurrent: async () => ({ id: 1 }) },
    identity: {}, alarms: {}, action: {}
  };
})();
