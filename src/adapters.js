// Per-app metric readers. Each returns a short list of { label, value, note? } for the app's
// card. Adapters only GET, only from the app's own base URL, and never return tokens.

import { appUrl } from './apps.config.js';
import { timedFetch } from './health.js';

async function getJson(fetchImpl, url, headers) {
  const { res } = await timedFetch(fetchImpl, url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const ADAPTERS = {
  /** Kestrel: setup state from the public probe; fleet numbers once a read-only admin token exists. */
  async kestrel({ app, env, body, fetchImpl }) {
    const out = [];
    if (body && typeof body.setup_required === 'boolean') {
      out.push({ label: 'Owner account', value: body.setup_required ? 'not set up' : 'set up' });
    }
    const token = app.tokenSecret && env[app.tokenSecret];
    if (!token) {
      out.push({ label: 'Fleet numbers', value: 'needs token', note: `Set the ${app.tokenSecret} secret to show devices, alerts and revenue.` });
      return out;
    }
    const s = await getJson(fetchImpl, appUrl(app, '/api/admin/summary'), { Authorization: `Bearer ${token}` });
    if (Number.isFinite(s.devices)) out.push({ label: 'Devices', value: s.devices });
    if (Number.isFinite(s.devices_online)) out.push({ label: 'Online now', value: s.devices_online });
    if (Number.isFinite(s.open_alerts)) out.push({ label: 'Open alerts', value: s.open_alerts, attention: s.open_alerts > 0 });
    if (Number.isFinite(s.tenants)) out.push({ label: 'Accounts', value: s.tenants });
    return out;
  },

  /** Season Challenger: the /health body says which store and feed are live. */
  async seasonChallenger({ body }) {
    if (!body) return [];
    const out = [];
    if (body.store) out.push({ label: 'Database', value: body.store, attention: body.store !== 'postgres', note: body.store !== 'postgres' ? 'Running on in-memory storage: data resets on restart.' : undefined });
    if (body.feed) out.push({ label: 'Football feed', value: body.feed });
    return out;
  },

  /** Seasonbook: the push-notification engine's public status. */
  async seasonbook({ app, fetchImpl }) {
    const s = await getJson(fetchImpl, appUrl(app, '/api/notify/status'));
    const out = [];
    const state = s && s.fcm && s.fcm.state;
    if (state) {
      const on = state === 'configured';
      out.push({ label: 'Push notifications', value: on ? 'on' : 'off', attention: !on, note: on ? undefined : 'Set FCM_SERVICE_ACCOUNT on the Seasonbook worker to send episode alerts.' });
    }
    if (s && s.engine && s.engine.trigger) out.push({ label: 'Announce schedule', value: s.engine.trigger });
    return out;
  },
};
