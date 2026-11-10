import { appUrl } from './apps.config.js';
import { ADAPTERS } from './adapters.js';

export const TIMEOUT_MS = 8000;
export const SLOW_MS = 2500;

/** GETs a URL with a timeout. Never follows redirects to other hosts silently. */
export async function timedFetch(fetchImpl, url, { headers = {}, timeoutMs = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { 'User-Agent': 'ALL-THAT/1 health-check', Accept: 'application/json, text/html;q=0.8', ...headers },
      redirect: 'manual',
      signal: ctrl.signal,
    });
    return { res, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Checks one app. Status is one of:
 *   up            2xx within SLOW_MS
 *   slow          2xx but slower than SLOW_MS (Render free tier waking up, usually)
 *   down          non-2xx, timeout or network error
 *   unconfigured  no live URL yet
 */
export async function checkApp(app, env = {}, fetchImpl = fetch) {
  const checkedAt = new Date().toISOString();
  const url = appUrl(app, app.health?.path || '/');
  if (!url) return { id: app.id, status: 'unconfigured', checkedAt, detail: 'Add the live URL to start checking.' };

  let res, ms;
  try {
    ({ res, ms } = await timedFetch(fetchImpl, url));
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    return { id: app.id, status: 'down', checkedAt, detail: timedOut ? `No answer in ${TIMEOUT_MS / 1000}s` : 'Could not connect' };
  }

  const ok = res.status >= 200 && res.status < 300;
  const result = {
    id: app.id,
    status: ok ? (ms > SLOW_MS ? 'slow' : 'up') : 'down',
    code: res.status,
    ms,
    checkedAt,
    detail: ok ? null : `HTTP ${res.status}`,
  };

  let body = null;
  if (ok && app.health?.json) {
    try {
      body = await res.json();
    } catch {
      body = null;
    }
  }

  const adapter = app.metrics && ADAPTERS[app.metrics];
  if (ok && adapter) {
    try {
      result.metrics = await adapter({ app, env, body, fetchImpl });
    } catch {
      result.metrics = [{ label: 'Metrics', value: 'unavailable', note: 'The app answered, but its numbers could not be read.' }];
    }
  }
  return result;
}

export async function checkAll(apps, env, fetchImpl = fetch) {
  return Promise.all(apps.map((app) => checkApp(app, env, fetchImpl)));
}

export function summarize(results) {
  const counts = { up: 0, slow: 0, down: 0, unconfigured: 0 };
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  const live = results.filter((r) => typeof r.ms === 'number');
  const avgMs = live.length ? Math.round(live.reduce((s, r) => s + r.ms, 0) / live.length) : null;
  return { total: results.length, ...counts, avgMs };
}
