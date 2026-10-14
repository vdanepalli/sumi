// Developer "things" recognised from a page address alone (never the page itself, so
// nothing breaks when a site changes its layout): repos, pull / merge requests, issues,
// commits and CI runs on GitHub, GitLab (also self-hosted) and Bitbucket; Linear and
// Jira tickets; localhost servers. Plus Markdown copy, URL cleanup and quicklinks.

// first path parts on github.com that are not owners
const GH_RESERVED = new Set(['settings', 'orgs', 'marketplace', 'notifications', 'explore', 'topics', 'sponsors', 'login', 'logout', 'features',
  'pulls', 'issues', 'search', 'new', 'apps', 'enterprise', 'about', 'pricing', 'collections', 'trending', 'codespaces', 'users', 'organizations',
  'account', 'dashboard', 'watching', 'stars', 'security', 'site', 'readme', 'events', 'customer-stories', 'team', 'join', 'signup', 'copilot', 'github-copilot']);
const TICKET = /^[A-Z][A-Z0-9_]{0,9}-\d{1,7}$/;
const LOCAL = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$|\.localhost$/;

const ent = (kind, host, repo, n, canonical, label) => ({ kind, host, repo, n, key: `${host}:${repo || ''}${n ? '#' + n : ''}`.replace(/:$/, ''), canonical, label });

// { kind: repo | pr | issue | commit | ci | ticket | local, host, repo, n, key, canonical, label } or null
export function entity(url) {
  let u; try { u = new URL(url); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const h = u.hostname.replace(/^www\./, '');
  const p = u.pathname.split('/').filter(Boolean);
  if (LOCAL.test(h)) { const port = u.port || (u.protocol === 'https:' ? '443' : '80'); return { kind: 'local', host: 'local', repo: '', n: port, key: 'local:' + port, canonical: `${u.protocol}//${u.host}/`, label: ':' + port }; }
  if (h === 'github.com' && p.length >= 2 && !GH_RESERVED.has(p[0])) {
    const repo = `${p[0]}/${p[1]}`; const base = `https://github.com/${repo}`;
    if (p[2] === 'pull' && /^\d+$/.test(p[3] || '')) return ent('pr', 'gh', repo, p[3], `${base}/pull/${p[3]}`, `${repo}#${p[3]}`);
    if (p[2] === 'issues' && /^\d+$/.test(p[3] || '')) return ent('issue', 'gh', repo, p[3], `${base}/issues/${p[3]}`, `${repo}#${p[3]}`);
    if (p[2] === 'commit' && p[3]) return { ...ent('commit', 'gh', repo, '', `${base}/commit/${p[3]}`, `${repo}@${p[3].slice(0, 7)}`), key: `gh:${repo}@${p[3].slice(0, 7)}` };
    if (p[2] === 'actions') return ent('ci', 'gh', repo, '', `${base}/actions`, `${repo} CI`);
    return ent('repo', 'gh', repo, '', base, repo);
  }
  if (h === 'bitbucket.org' && p.length >= 2) {
    const repo = `${p[0]}/${p[1]}`; const base = `https://bitbucket.org/${repo}`;
    if (p[2] === 'pull-requests' && /^\d+$/.test(p[3] || '')) return ent('pr', 'bb', repo, p[3], `${base}/pull-requests/${p[3]}`, `${repo}#${p[3]}`);
    if (p[2] === 'issues' && /^\d+$/.test(p[3] || '')) return ent('issue', 'bb', repo, p[3], `${base}/issues/${p[3]}`, `${repo}#${p[3]}`);
    if (p[2] === 'pipelines') return ent('ci', 'bb', repo, '', `${base}/pipelines`, `${repo} CI`);
    return ent('repo', 'bb', repo, '', base, repo);
  }
  // GitLab (gitlab.com or a self-hosted gitlab.* host): project path ends at "/-/"
  if (/(^|\.)gitlab\./.test(h) || h === 'gitlab.com') {
    const dash = p.indexOf('-');
    const proj = (dash > 0 ? p.slice(0, dash) : p).join('/'); const rest = dash > 0 ? p.slice(dash + 1) : [];
    if (proj.split('/').length < 2 || ['users', 'explore', 'dashboard', 'help', 'admin'].includes(p[0])) return null;
    const base = `${u.origin}/${proj}`; const hk = h === 'gitlab.com' ? 'gl' : 'gl.' + h;
    if (rest[0] === 'merge_requests' && /^\d+$/.test(rest[1] || '')) return ent('pr', hk, proj, rest[1], `${base}/-/merge_requests/${rest[1]}`, `${proj}!${rest[1]}`);
    if ((rest[0] === 'issues' || rest[0] === 'work_items') && /^\d+$/.test(rest[1] || '')) return ent('issue', hk, proj, rest[1], `${base}/-/issues/${rest[1]}`, `${proj}#${rest[1]}`);
    if (rest[0] === 'commit' && rest[1]) return { ...ent('commit', hk, proj, '', `${base}/-/commit/${rest[1]}`, `${proj}@${rest[1].slice(0, 7)}`), key: `${hk}:${proj}@${rest[1].slice(0, 7)}` };
    if (rest[0] === 'pipelines' || rest[0] === 'jobs') return ent('ci', hk, proj, '', `${base}/-/pipelines`, `${proj} CI`);
    return ent('repo', hk, proj, '', base, proj);
  }
  // Linear: linear.app/<workspace>/issue/ENG-421/slug
  if (h === 'linear.app' && p[1] === 'issue' && TICKET.test((p[2] || '').toUpperCase())) {
    const k = p[2].toUpperCase();
    return { kind: 'ticket', host: 'linear', repo: '', n: k, key: 'ticket:' + k, canonical: `https://linear.app/${p[0]}/issue/${k}`, label: k, base: `https://linear.app/${p[0]}/issue/` };
  }
  // Jira (Atlassian cloud or self-hosted jira.*): /browse/ENG-421 or ?selectedIssue=ENG-421
  if (/\.atlassian\.net$/.test(h) || /(^|\.)jira\./.test(h)) {
    const k = ((p[0] === 'browse' && p[1]) || u.searchParams.get('selectedIssue') || '').toUpperCase();
    if (TICKET.test(k)) return { kind: 'ticket', host: 'jira', repo: '', n: k, key: 'ticket:' + k, canonical: `${u.origin}/browse/${k}`, label: k, base: `${u.origin}/browse/` };
  }
  return null;
}
export const isTicketKey = s => TICKET.test(String(s).toUpperCase());

// what kind of developer time a page is (for Insights), or null for everything else
const ON = (h, list) => list.some(d => h === d || h.endsWith('.' + d));
export function category(url, e = entity(url)) {
  if (e) return { pr: 'review', commit: 'review', issue: 'planning', ticket: 'planning', ci: 'ci', repo: 'code', local: 'local' }[e.kind];
  let u; try { u = new URL(url); } catch (x) { return null; }
  const h = u.hostname.replace(/^www\./, '');
  if (ON(h, ['chatgpt.com', 'chat.openai.com', 'gemini.google.com', 'perplexity.ai', 'copilot.microsoft.com', 'phind.com', 'v0.dev', 'poe.com'])) return 'ai';
  if (ON(h, ['stackoverflow.com', 'stackexchange.com', 'serverfault.com', 'superuser.com', 'askubuntu.com'])) return 'qa';
  if (ON(h, ['developer.mozilla.org', 'readthedocs.io', 'devdocs.io', 'pkg.go.dev', 'docs.rs', 'npmjs.com', 'pypi.org', 'crates.io', 'learn.microsoft.com', 'developer.apple.com', 'developer.android.com', 'developer.chrome.com'])
    || /^(docs|developer|developers|api|devdocs)\./.test(h) || /^\/(docs|documentation|reference|api)(\/|$)/.test(u.pathname)) return 'docs';
  if (ON(h, ['github.com', 'gitlab.com', 'bitbucket.org', 'linear.app', 'atlassian.net', 'vercel.com', 'netlify.app', 'circleci.com', 'console.cloud.google.com', 'console.aws.amazon.com', 'portal.azure.com', 'sentry.io', 'datadoghq.com'])) return 'tools';
  return null;
}
export const CATEGORIES = { review: 'Code review', planning: 'Issues & tickets', ci: 'CI', code: 'Browsing code', docs: 'Docs', qa: 'Q&A', ai: 'AI assistants', local: 'Local dev', tools: 'Dev tools' };

// address without tracking parameters and empty fragments
export function cleanUrl(url) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^(utm_.*|fbclid|gclid|dclid|msclkid|mc_[ce]id|igshid|ref_src|si|_hsenc|_hsmi|mkt_tok)$/i.test(k)) u.searchParams.delete(k);
    if (u.hash === '#') u.hash = '';
    return u.href;
  } catch (e) { return url; }
}
const mdEscape = s => String(s || '').replace(/([\[\]\\])/g, '\\$1').replace(/\s+/g, ' ').trim();
export const mdLink = t => `[${mdEscape(entity(t.url)?.label && !/#|!|@/.test(mdEscape(t.title)) ? `${entity(t.url).label}: ${t.title}` : t.title || t.url)}](${cleanUrl(t.url)})`;
export const mdList = (tabs, heading) => (heading ? `## ${mdEscape(heading)}\n\n` : '') + tabs.map(t => `- ${mdLink(t)}`).join('\n');

// http(s) links in pasted text (one per line, or anywhere in prose / Markdown)
export function urlsIn(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)) {
    const url = m[0].replace(/[.,;:!?]+$/, '');
    try { new URL(url); if (!out.includes(url)) out.push(url); } catch (e) { /* skip */ }
  }
  return out;
}

// quicklinks: "key = https://…{q}…" lines from Settings; {q} is the rest of what you type
export const DEFAULT_QUICKLINKS = [
  'gh = https://github.com/{q}', 'ghs = https://github.com/search?q={q}&type=code', 'gl = https://gitlab.com/{q}',
  'npm = https://www.npmjs.com/package/{q}', 'pypi = https://pypi.org/project/{q}/', 'crate = https://crates.io/crates/{q}',
  'go = https://pkg.go.dev/{q}', 'mdn = https://developer.mozilla.org/en-US/search?q={q}', 'so = https://stackoverflow.com/search?q={q}'
];
export function quicklinks(lines) {
  const out = {};
  for (const l of lines || []) {
    const m = /^\s*([\w.-]+)\s*=\s*(https?:\/\/\S+)\s*$/.exec(l);
    if (m) out[m[1].toLowerCase()] = m[2];
  }
  return out;
}
// "gh acme/api" → url; keeps "/" in repo paths, encodes everything else
export function fillLink(tpl, q) {
  const enc = /[?&=]\{q\}|\{q\}[&]/.test(tpl) ? encodeURIComponent(q) : q.split('/').map(encodeURIComponent).join('/');
  return tpl.replace('{q}', enc);
}

// a tracked "kind|key" back to something to show / open
export function fromKey(kk) {
  const [kind, key] = kk.split('|'); const host = key.slice(0, key.indexOf(':')); const rest = key.slice(key.indexOf(':') + 1);
  const [repo, n] = rest.split('#');
  const label = kind === 'local' ? ':' + rest : kind === 'pr' && host.startsWith('gl') ? `${repo}!${n}` : kind === 'ci' ? `${rest} CI` : rest;
  const base = host === 'gh' ? `https://github.com/${repo}` : host === 'bb' ? `https://bitbucket.org/${repo}` : host === 'gl' ? `https://gitlab.com/${repo}` : host.startsWith('gl.') ? `https://${host.slice(3)}/${repo}` : '';
  const sep = host.startsWith('gl') ? '/-/' : '/';
  const url = !base ? null : kind === 'pr' ? `${base}${sep}${host === 'gh' ? 'pull' : host === 'bb' ? 'pull-requests' : 'merge_requests'}/${n}`
    : kind === 'issue' ? `${base}${sep}issues/${n}` : base;
  return { kind, host, repo: kind === 'ticket' || kind === 'local' ? '' : repo, label, url };
}
