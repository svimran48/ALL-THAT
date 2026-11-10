// Owner login for ALL-THAT. One owner, one password, signed session cookies.
//
// Secrets (set with `wrangler secret put`, never in code):
//   OWNER_PASSWORD_HASH  pbkdf2$<iterations>$<salt b64url>$<hash b64url>  (make it with scripts/hash-password.js)
//   SESSION_SECRET       32+ random bytes, any encoding
// Optional var:
//   SESSION_VERSION      bump to sign everyone out

const enc = new TextEncoder();
export const COOKIE = '__Host-allthat_s';
export const SESSION_TTL_S = 12 * 60 * 60;
// Cloudflare Workers caps PBKDF2 at 100k iterations.
export const PBKDF2_ITERATIONS = 100_000;

export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Constant-time comparison of two byte arrays. */
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password, iterations = PBKDF2_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2$${iterations}$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > PBKDF2_ITERATIONS) return false;
  let salt, expected;
  try {
    salt = fromB64url(parts[2]);
    expected = fromB64url(parts[3]);
  } catch {
    return false;
  }
  const actual = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signSession(env, now = Date.now()) {
  const payload = {
    v: String(env.SESSION_VERSION || '1'),
    exp: Math.floor(now / 1000) + SESSION_TTL_S,
    n: b64url(crypto.getRandomValues(new Uint8Array(12))),
  };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

/** Returns the session payload when the token is valid, unexpired and current; otherwise null. */
export async function verifySession(env, token, now = Date.now()) {
  if (!env.SESSION_SECRET || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 1 || dot !== token.lastIndexOf('.')) return null;
  const body = token.slice(0, dot);
  let sig, payload;
  try {
    sig = fromB64url(token.slice(dot + 1));
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env.SESSION_SECRET), sig, enc.encode(body));
    if (!ok) return null;
    payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number') return null;
  if (payload.exp <= Math.floor(now / 1000)) return null;
  if (payload.v !== String(env.SESSION_VERSION || '1')) return null;
  return payload;
}

export function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookie(token) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_S}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/** True when login is possible: both secrets are present. The hub fails closed without them. */
export function authConfigured(env) {
  return Boolean(env.OWNER_PASSWORD_HASH && env.SESSION_SECRET && String(env.SESSION_SECRET).length >= 32);
}

/** Same-origin check for state-changing requests (defence in depth on top of SameSite=Strict). */
export function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  return origin === new URL(request.url).origin;
}

// Login throttling. Per isolate, so it slows guessing rather than stopping a distributed
// attack; put Cloudflare Access or a WAF rate-limit rule in front for that (see README).
const attempts = new Map();
export const MAX_ATTEMPTS = 5;
export const WINDOW_MS = 15 * 60 * 1000;

export function loginAllowed(ip, now = Date.now()) {
  const rec = attempts.get(ip);
  if (!rec || now - rec.start > WINDOW_MS) return true;
  return rec.count < MAX_ATTEMPTS;
}

export function recordFailure(ip, now = Date.now()) {
  const rec = attempts.get(ip);
  if (!rec || now - rec.start > WINDOW_MS) attempts.set(ip, { start: now, count: 1 });
  else rec.count++;
  if (attempts.size > 10_000) attempts.clear();
}

export function clearFailures(ip) {
  attempts.delete(ip);
}

export function _resetAttempts() {
  attempts.clear();
}
