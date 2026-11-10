import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handle, publicApp } from '../src/index.js';
import { hashPassword, _resetAttempts, COOKIE } from '../src/auth.js';
import { checkApp, summarize } from '../src/health.js';
import { resolveApps, APPS } from '../src/apps.config.js';

const ORIGIN = 'https://hub.test';
const PASSWORD = 'a long owner password';
let env;

const assets = {
  async fetch(req) {
    const p = new URL(req.url).pathname;
    return new Response(`asset:${p}`, { status: 200, headers: { 'Content-Type': 'text/html' } });
  },
};

beforeEach(async () => {
  _resetAttempts();
  env = {
    ASSETS: assets,
    SESSION_SECRET: 's'.repeat(48),
    SESSION_VERSION: '1',
    OWNER_PASSWORD_HASH: await hashPassword(PASSWORD, 20_000),
    KESTREL_ADMIN_TOKEN: 'super-secret-token',
  };
});

function req(path, init = {}) {
  return new Request(`${ORIGIN}${path}`, init);
}

async function login(password = PASSWORD, headers = {}) {
  return handle(req('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': '9.9.9.9', ...headers },
    body: JSON.stringify({ password }),
  }), env);
}

function cookieFrom(res) {
  const c = res.headers.get('Set-Cookie');
  return c.split(';')[0];
}

const okFetch = async (url) => {
  const u = String(url);
  if (u.endsWith('/health')) return Response.json({ status: 'ok', store: 'postgres', feed: 'fake' });
  return new Response('ok');
};

test('dashboard and its script redirect to login when signed out', async () => {
  for (const p of ['/', '/index.html', '/app.js']) {
    const res = await handle(req(p), env);
    assert.equal(res.status, 303, p);
    assert.equal(res.headers.get('Location'), '/login');
  }
});

test('login page and stylesheet are public', async () => {
  assert.equal((await handle(req('/login'), env)).status, 200);
  assert.equal((await handle(req('/app.css'), env)).status, 200);
});

test('status API needs a session', async () => {
  const res = await handle(req('/api/status'), env);
  assert.equal(res.status, 401);
});

test('wrong password is refused; right password sets a hardened cookie', async () => {
  assert.equal((await login('nope')).status, 401);
  const res = await login();
  assert.equal(res.status, 200);
  const c = res.headers.get('Set-Cookie');
  assert.match(c, new RegExp(`^${COOKIE}=`));
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(c.includes(flag), flag);
});

test('login from another origin or without Origin is refused', async () => {
  assert.equal((await login(PASSWORD, { Origin: 'https://evil.test' })).status, 403);
  const res = await handle(req('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), env);
  assert.equal(res.status, 403);
});

test('login rejects non-JSON bodies', async () => {
  const res = await handle(req('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN }, body: 'password=x',
  }), env);
  assert.equal(res.status, 400);
});

test('login fails closed when secrets are missing', async () => {
  delete env.OWNER_PASSWORD_HASH;
  assert.equal((await login()).status, 503);
  assert.equal((await handle(req('/'), env)).status, 303);
});

test('brute force is throttled', async () => {
  for (let i = 0; i < 5; i++) await login('wrong');
  const res = await login();
  assert.equal(res.status, 429);
});

test('signed-in owner gets the dashboard and status without any secret leaking', async () => {
  const cookie = cookieFrom(await login());
  const page = await handle(req('/', { headers: { Cookie: cookie } }), env);
  assert.equal(page.status, 200);
  assert.equal(await page.text(), 'asset:/index.html');
  assert.equal(page.headers.get('X-Frame-Options'), 'DENY');
  assert.match(page.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);

  const res = await handle(req('/api/status', { headers: { Cookie: cookie } }), env, {}, okFetch);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes('super-secret-token'), 'token value must not be returned');
  assert.ok(!text.includes('KESTREL_ADMIN_TOKEN'), 'secret names must not be returned');
  const data = JSON.parse(text);
  assert.equal(data.apps.length, APPS.length);
  const sc = data.results.find((r) => r.id === 'season-challenger');
  assert.equal(sc.status, 'up');
  assert.deepEqual(sc.metrics.map((m) => m.label), ['Database', 'Football feed']);
  assert.equal(data.results.find((r) => r.id === 'kestrel').status, 'unconfigured');
});

test('a forged cookie does not open the dashboard', async () => {
  const res = await handle(req('/', { headers: { Cookie: `${COOKIE}=eyJ2IjoiMSIsImV4cCI6OTk5OTk5OTk5OX0.AAAA` } }), env);
  assert.equal(res.status, 303);
});

test('bumping SESSION_VERSION signs everyone out', async () => {
  const cookie = cookieFrom(await login());
  env.SESSION_VERSION = '2';
  assert.equal((await handle(req('/api/status', { headers: { Cookie: cookie } }), env)).status, 401);
});

test('logout clears the cookie', async () => {
  const res = await handle(req('/api/logout', { method: 'POST', headers: { Origin: ORIGIN } }), env);
  assert.match(res.headers.get('Set-Cookie'), /Max-Age=0/);
});

test('health check classifies down, slow, timeout and redirect', async () => {
  const app = { id: 'x', baseUrl: 'https://x.test', health: { path: '/h' } };
  assert.equal((await checkApp(app, {}, async () => new Response('', { status: 503 }))).status, 'down');
  assert.equal((await checkApp(app, {}, async () => new Response('', { status: 302, headers: { Location: 'https://elsewhere' } }))).status, 'down');
  assert.equal((await checkApp(app, {}, async () => { throw new TypeError('fail'); })).detail, 'Could not connect');
  const slow = async () => { await new Promise((r) => setTimeout(r, 2600)); return new Response('ok'); };
  assert.equal((await checkApp(app, {}, slow)).status, 'slow');
});

test('kestrel adapter asks for a token rather than guessing', async () => {
  const kestrel = { ...APPS.find((a) => a.id === 'kestrel'), baseUrl: 'https://k.test' };
  const r = await checkApp(kestrel, {}, async () => Response.json({ setup_required: false }));
  assert.equal(r.status, 'up');
  assert.equal(r.metrics.find((m) => m.label === 'Fleet numbers').value, 'needs token');
});

test('APP_URLS overrides accept only https URLs', () => {
  const apps = resolveApps({ APP_URLS: JSON.stringify({ kestrel: 'https://k.test', seasonbook: 'http://insecure.test' }) });
  assert.equal(apps.find((a) => a.id === 'kestrel').baseUrl, 'https://k.test');
  assert.equal(apps.find((a) => a.id === 'seasonbook').baseUrl, null);
  assert.doesNotThrow(() => resolveApps({ APP_URLS: 'not json' }));
});

test('publicApp exposes no secret names', () => {
  const p = publicApp(APPS[0], {});
  assert.equal(p.tokenMissing, true);
  assert.ok(!JSON.stringify(p).includes('TOKEN'));
});

test('summary counts statuses', () => {
  const s = summarize([{ status: 'up', ms: 100 }, { status: 'down' }, { status: 'unconfigured' }, { status: 'slow', ms: 3000 }]);
  assert.deepEqual(s, { total: 4, up: 1, slow: 1, down: 1, unconfigured: 1, avgMs: 1550 });
});
