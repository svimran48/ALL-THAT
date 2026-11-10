import { resolveApps, appUrl } from './apps.config.js';
import { checkAll, summarize } from './health.js';
import {
  COOKIE,
  authConfigured,
  clearCookie,
  clearFailures,
  loginAllowed,
  readCookie,
  recordFailure,
  sameOrigin,
  sessionCookie,
  signSession,
  verifyPassword,
  verifySession,
} from './auth.js';

const HISTORY_POINTS = 48;
const PUBLIC_PATHS = new Set(['/login', '/login.html', '/login.js', '/app.css', '/favicon.svg']);

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function withHeaders(res, extra = {}) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) out.headers.set(k, v);
  return out;
}

function json(data, status = 200, extra = {}) {
  return withHeaders(
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } }),
    { 'Cache-Control': 'no-store', ...extra },
  );
}

function redirect(location) {
  return withHeaders(new Response(null, { status: 303, headers: { Location: location } }), { 'Cache-Control': 'no-store' });
}

/** What the browser may see about an app: links and names, never secret names or values. */
export function publicApp(app, env) {
  return {
    id: app.id,
    name: app.name,
    kind: app.kind,
    repo: app.repo,
    live: Boolean(app.baseUrl),
    baseUrl: app.baseUrl,
    adminUrl: appUrl(app, app.adminUrl || '/'),
    links: (app.links || []).map((l) => ({ label: l.label, url: appUrl(app, l.path) })).filter((l) => l.url),
    tokenMissing: Boolean(app.tokenSecret && !env[app.tokenSecret]),
  };
}

async function readHistory(env, ids) {
  if (!env.HISTORY) return {};
  const raw = await env.HISTORY.get('history', 'json');
  const out = {};
  for (const id of ids) out[id] = (raw && raw[id]) || [];
  return out;
}

async function writeHistory(env, results) {
  if (!env.HISTORY) return;
  const raw = (await env.HISTORY.get('history', 'json')) || {};
  for (const r of results) {
    const list = raw[r.id] || [];
    list.push({ t: r.checkedAt, s: r.status, ms: typeof r.ms === 'number' ? r.ms : null });
    raw[r.id] = list.slice(-HISTORY_POINTS);
  }
  await env.HISTORY.put('history', JSON.stringify(raw));
}

async function isSignedIn(request, env) {
  if (!authConfigured(env)) return false;
  return Boolean(await verifySession(env, readCookie(request, COOKIE)));
}

async function handleLogin(request, env) {
  if (!sameOrigin(request)) return json({ error: 'Sign-in must come from this page.' }, 403);
  if (!authConfigured(env)) {
    return json({ error: 'Sign-in is not set up yet. Set OWNER_PASSWORD_HASH and SESSION_SECRET on the worker.' }, 503);
  }
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (!loginAllowed(ip)) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429, { 'Retry-After': '900' });

  let password = '';
  try {
    const ctype = request.headers.get('Content-Type') || '';
    if (!ctype.includes('application/json')) throw new Error('type');
    const body = await request.json();
    password = typeof body.password === 'string' ? body.password.slice(0, 512) : '';
  } catch {
    return json({ error: 'Send the password as JSON.' }, 400);
  }

  if (!(await verifyPassword(password, env.OWNER_PASSWORD_HASH))) {
    recordFailure(ip);
    return json({ error: 'That password is not right.' }, 401);
  }
  clearFailures(ip);
  const token = await signSession(env);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token) });
}

export async function handle(request, env, ctx = {}, fetchImpl = fetch) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  if (pathname === '/api/login' && method === 'POST') return handleLogin(request, env);
  if (pathname === '/api/logout' && method === 'POST') {
    if (!sameOrigin(request)) return json({ error: 'Sign-out must come from this page.' }, 403);
    return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
  }

  const signedIn = await isSignedIn(request, env);

  if (pathname.startsWith('/api/')) {
    if (!signedIn) return json({ error: 'Sign in first.' }, 401);
    if (method !== 'GET') return json({ error: 'Not found.' }, 404);
    if (pathname === '/api/status') {
      const apps = resolveApps(env);
      const results = await checkAll(apps, env, fetchImpl);
      const history = await readHistory(env, apps.map((a) => a.id));
      return json({
        generatedAt: new Date().toISOString(),
        apps: apps.map((a) => publicApp(a, env)),
        results,
        summary: summarize(results),
        history,
        historyEnabled: Boolean(env.HISTORY),
      });
    }
    return json({ error: 'Not found.' }, 404);
  }

  if (method !== 'GET' && method !== 'HEAD') return withHeaders(new Response('Method not allowed', { status: 405 }));

  if (pathname === '/login' || pathname === '/login.html') {
    if (signedIn) return redirect('/');
    return serveAsset(request, env, '/login.html');
  }
  if (PUBLIC_PATHS.has(pathname)) return serveAsset(request, env, pathname);
  if (!signedIn) return redirect('/login');
  return serveAsset(request, env, pathname === '/' ? '/index.html' : pathname);
}

async function serveAsset(request, env, path) {
  if (!env.ASSETS) return withHeaders(new Response('Assets binding missing', { status: 500 }));
  const assetUrl = new URL(path, request.url);
  const res = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: 'GET', headers: request.headers }));
  return withHeaders(res, { 'Cache-Control': path.endsWith('.html') ? 'no-store' : 'private, max-age=300' });
}

export default {
  fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },
  async scheduled(_event, env, ctx) {
    const apps = resolveApps(env);
    const results = await checkAll(apps, env);
    ctx.waitUntil(writeHistory(env, results));
  },
};

export { writeHistory, readHistory };
