// ALL-THAT dashboard. Everything is built with DOM APIs and textContent: no innerHTML, so
// nothing an app returns can inject markup into the hub.

const STATUS = {
  up: { label: 'Up', icon: 'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm3.3 5.2-3.9 4.2a.75.75 0 0 1-1.1 0L4.7 8.7a.75.75 0 1 1 1.1-1l1.1 1.1 3.3-3.6a.75.75 0 1 1 1.1 1Z' },
  slow: { label: 'Slow', icon: 'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm.75 3.5v3.2l2.1 1.3a.75.75 0 1 1-.8 1.3L7.6 8.8a.75.75 0 0 1-.35-.64V4.5a.75.75 0 0 1 1.5 0Z' },
  down: { label: 'Down', icon: 'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm2.5 8.4a.75.75 0 1 1-1.06 1.06L8 9.06l-1.44 1.4A.75.75 0 1 1 5.5 9.4L6.94 8 5.5 6.56A.75.75 0 1 1 6.56 5.5L8 6.94 9.44 5.5a.75.75 0 1 1 1.06 1.06L9.06 8l1.44 1.4Z' },
  check: { label: 'Check', icon: 'M8.9 1.6a1 1 0 0 0-1.8 0L.8 13.4A1 1 0 0 0 1.7 15h12.6a1 1 0 0 0 .9-1.6L8.9 1.6ZM8 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 5Zm0 7.6a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Z' },
  unconfigured: { label: 'No URL yet', icon: 'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 3a.9.9 0 1 1 0 1.8A.9.9 0 0 1 8 4Zm.75 7.25a.75.75 0 0 1-1.5 0V7.5a.75.75 0 0 1 1.5 0v3.75Z' },
};
const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c) node.append(c);
  return node;
}

function pill(status) {
  const s = STATUS[status] || STATUS.unconfigured;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', s.icon);
  svg.append(path);
  const span = el('span', { class: `pill ${status}` });
  span.append(svg, document.createTextNode(s.label));
  return span;
}

/** External links only ever go to https URLs the server built from config. */
function safeLink(url, label, cls = 'btn') {
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) return null;
  return el('a', { class: cls, href: url, target: '_blank', rel: 'noopener noreferrer', text: label });
}

function fmtMs(ms) {
  if (typeof ms !== 'number') return '–';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function tile(label, value, note) {
  return el('div', { class: 'tile' },
    el('span', { class: 'tile-label', text: label }),
    el('span', { class: 'tile-value', text: String(value) }),
    note ? el('span', { class: 'tile-note', text: note }) : null);
}

function renderTiles(summary) {
  const attention = summary.down + summary.slow;
  const tiles = document.getElementById('tiles');
  tiles.replaceChildren(
    tile('Apps watched', summary.total, `${summary.unconfigured} waiting for a URL`),
    tile('Up', summary.up, summary.total - summary.unconfigured ? `of ${summary.total - summary.unconfigured} with a URL` : 'none checked yet'),
    tile('Down or slow', attention, attention ? `${summary.down} down, ${summary.slow} slow` : 'nothing wrong'),
    tile('Average response', fmtMs(summary.avgMs), 'across apps that answered'),
  );
}

function renderAttention(apps, results) {
  const byId = Object.fromEntries(apps.map((a) => [a.id, a]));
  const items = [];
  for (const r of results) {
    const app = byId[r.id];
    if (r.status === 'down' || r.status === 'slow') {
      items.push(el('li', {}, pill(r.status), el('strong', { text: app.name }), el('span', { class: 'note', text: r.detail || `answered in ${fmtMs(r.ms)}` })));
    }
    for (const m of r.metrics || []) {
      if (m.attention) items.push(el('li', {}, pill('check'), el('strong', { text: `${app.name}: ${m.label}` }), el('span', { class: 'note', text: m.note || String(m.value) })));
    }
  }
  const box = document.getElementById('attention');
  document.getElementById('attention-list').replaceChildren(...items);
  box.hidden = items.length === 0;
}

function uptimeStrip(points, enabled) {
  const wrap = el('div', { class: 'uptime' });
  if (!enabled) {
    wrap.append(el('p', { class: 'note', text: 'Uptime history starts once the HISTORY store is connected.' }));
    return wrap;
  }
  const slots = 48;
  const list = (points || []).slice(-slots);
  const upCount = list.filter((p) => p.s === 'up' || p.s === 'slow').length;
  const checked = list.filter((p) => p.s !== 'unconfigured').length;
  const pct = checked ? Math.round((upCount / checked) * 1000) / 10 : null;
  wrap.append(el('div', { class: 'uptime-head' },
    el('span', { text: 'Last 4 hours' }),
    el('span', { class: 'num', text: pct === null ? 'no checks yet' : `${pct}% up` })));
  const strip = el('div', { class: 'strip', role: 'img', 'aria-label': pct === null ? 'No checks yet' : `${pct}% of checks up in the last 4 hours` });
  for (let i = 0; i < slots - list.length; i++) strip.append(el('span', { class: 'seg' }));
  for (const p of list) {
    strip.append(el('span', { class: `seg ${p.s}`, title: `${fmtTime(p.t)} · ${STATUS[p.s]?.label || p.s}${p.ms ? ` · ${fmtMs(p.ms)}` : ''}` }));
  }
  wrap.append(strip);
  return wrap;
}

function card(app, result, history, historyEnabled) {
  const status = result ? result.status : 'unconfigured';
  const head = el('div', { class: 'card-head' },
    el('div', {},
      el('h3', { text: app.name }),
      el('div', { class: 'kind', text: app.kind }),
      app.baseUrl ? el('div', { class: 'host', text: new URL(app.baseUrl).host }) : null),
    pill(status));

  const rows = [];
  if (result && typeof result.ms === 'number') rows.push({ label: 'Response', value: fmtMs(result.ms) });
  if (result && result.detail && status !== 'unconfigured') rows.push({ label: 'Problem', value: result.detail, attention: true });
  for (const m of (result && result.metrics) || []) rows.push(m);

  const dl = el('dl', { class: 'metrics' });
  const notes = [];
  for (const r of rows) {
    dl.append(el('div', { class: `metric${r.attention ? ' attn' : ''}` }, el('dt', { text: r.label }), el('dd', { class: 'num', text: String(r.value) })));
    if (r.note) notes.push(el('p', { class: 'note', text: r.note }));
  }

  const actions = el('div', { class: 'actions' });
  if (app.live) {
    const open = safeLink(app.adminUrl, 'Open admin', 'btn btn-primary');
    if (open) actions.append(open);
    for (const l of app.links) {
      if (l.url === app.adminUrl) continue;
      const a = safeLink(l.url, l.label);
      if (a) actions.append(a);
    }
  }
  if (app.repo) actions.append(safeLink(`https://github.com/${app.repo}`, 'Code'));

  const parts = [head];
  if (!app.live) {
    parts.push(el('div', { class: 'setup' },
      el('span', { text: 'Add this app’s live URL to start checking it. In wrangler.toml:' }),
      el('code', { text: `APP_URLS = '{"${app.id}":"https://…"}'` })));
  } else {
    if (rows.length) parts.push(dl);
    parts.push(...notes);
    parts.push(uptimeStrip(history, historyEnabled));
  }
  parts.push(actions);
  return el('article', { class: 'card', 'aria-label': app.name }, ...parts);
}

let loading = false;
async function load() {
  if (loading) return;
  loading = true;
  const btn = document.getElementById('refresh');
  const checked = document.getElementById('checked');
  btn.disabled = true;
  checked.textContent = 'Checking your apps…';
  try {
    const res = await fetch('/api/status', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (res.status === 401) {
      location.href = '/login';
      return;
    }
    if (!res.ok) throw new Error(`The hub answered ${res.status}.`);
    const data = await res.json();
    const byId = Object.fromEntries(data.results.map((r) => [r.id, r]));
    renderTiles(data.summary);
    renderAttention(data.apps, data.results);
    const cards = document.getElementById('cards');
    cards.replaceChildren(...data.apps.map((a) => card(a, byId[a.id], data.history[a.id], data.historyEnabled)));
    if (!data.apps.length) cards.replaceChildren(el('div', { class: 'empty', text: 'No apps yet. Add them in src/apps.config.js.' }));
    checked.textContent = `Checked at ${fmtTime(data.generatedAt)}`;
  } catch (err) {
    checked.textContent = 'Check failed';
    document.getElementById('cards').replaceChildren(el('div', { class: 'error-box', text: `Could not load app status. ${err.message} Try Check now.` }));
  } finally {
    btn.disabled = false;
    loading = false;
  }
}

document.getElementById('refresh').addEventListener('click', load);
document.getElementById('logout').addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  } finally {
    location.href = '/login';
  }
});

load();
setInterval(() => {
  if (document.visibilityState === 'visible') load();
}, 60_000);
