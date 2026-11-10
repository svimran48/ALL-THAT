import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword, verifyPassword, signSession, verifySession, SESSION_TTL_S,
  loginAllowed, recordFailure, clearFailures, MAX_ATTEMPTS, _resetAttempts, authConfigured,
} from '../src/auth.js';

const env = { SESSION_SECRET: 'x'.repeat(40), SESSION_VERSION: '1' };

test('password hash round-trips and rejects wrong passwords', async () => {
  const h = await hashPassword('correct horse battery', 20_000);
  assert.match(h, /^pbkdf2\$20000\$/);
  assert.equal(await verifyPassword('correct horse battery', h), true);
  assert.equal(await verifyPassword('correct horse batterY', h), false);
  assert.equal(await verifyPassword('', h), false);
});

test('malformed or weak hashes never verify', async () => {
  assert.equal(await verifyPassword('a', 'plain-text'), false);
  assert.equal(await verifyPassword('a', 'pbkdf2$1$AAAA$AAAA'), false);
  assert.equal(await verifyPassword('a', 'pbkdf2$999999$AAAA$AAAA'), false);
  assert.equal(await verifyPassword('a', undefined), false);
});

test('sessions verify, expire, and are bound to secret and version', async () => {
  const now = Date.now();
  const t = await signSession(env, now);
  assert.ok(await verifySession(env, t, now));
  assert.equal(await verifySession(env, t, now + (SESSION_TTL_S + 1) * 1000), null);
  assert.equal(await verifySession({ ...env, SESSION_SECRET: 'y'.repeat(40) }, t, now), null);
  assert.equal(await verifySession({ ...env, SESSION_VERSION: '2' }, t, now), null);
});

test('tampered session tokens are rejected', async () => {
  const t = await signSession(env);
  const [body, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ v: '1', exp: 9_999_999_999 })).toString('base64url');
  assert.equal(await verifySession(env, `${forged}.${sig}`), null);
  assert.equal(await verifySession(env, `${body}.${sig.slice(0, -2)}AA`), null);
  assert.equal(await verifySession(env, `${body}`), null);
  assert.equal(await verifySession(env, `${body}.${sig}.extra`), null);
  assert.equal(await verifySession(env, null), null);
  assert.equal(await verifySession({}, t), null);
});

test('login is throttled after repeated failures', () => {
  _resetAttempts();
  const now = 1_000_000;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    assert.equal(loginAllowed('1.2.3.4', now), true);
    recordFailure('1.2.3.4', now);
  }
  assert.equal(loginAllowed('1.2.3.4', now), false);
  assert.equal(loginAllowed('5.6.7.8', now), true);
  assert.equal(loginAllowed('1.2.3.4', now + 16 * 60 * 1000), true);
  clearFailures('1.2.3.4');
  assert.equal(loginAllowed('1.2.3.4', now), true);
});

test('auth is not configured without both secrets or with a short session secret', () => {
  assert.equal(authConfigured({}), false);
  assert.equal(authConfigured({ OWNER_PASSWORD_HASH: 'h' }), false);
  assert.equal(authConfigured({ OWNER_PASSWORD_HASH: 'h', SESSION_SECRET: 'short' }), false);
  assert.equal(authConfigured({ OWNER_PASSWORD_HASH: 'h', SESSION_SECRET: 'x'.repeat(32) }), true);
});
