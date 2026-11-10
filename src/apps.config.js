// The apps ALL-THAT watches. This file holds no secrets: an app's token lives in a
// Worker secret, and `tokenSecret` only names that secret.
//
// Fields
//   id           short slug, used in URLs and secret names
//   name         what the owner calls the app
//   kind         one-line description shown on the card
//   repo         GitHub repo, for the "Code" link
//   baseUrl      the live app; null until it is deployed or known
//   adminUrl     where the app's own admin lives (opened in a new tab)
//   health       { path, json } GET path checked for status; json=true parses the body
//   metrics      name of an adapter in src/adapters.js, or null
//   tokenSecret  Worker secret holding a read-only token for this app, or null
//   links        extra admin shortcuts: [{ label, path }]

export const APPS = [
  {
    id: 'kestrel',
    name: 'Kestrel',
    kind: 'Device monitoring platform',
    repo: 'svimran48/spy-pro',
    baseUrl: null,
    adminUrl: '/',
    health: { path: '/api/auth/status', json: true },
    metrics: 'kestrel',
    tokenSecret: 'KESTREL_ADMIN_TOKEN',
    links: [
      { label: 'Devices', path: '/#devices' },
      { label: 'Alerts', path: '/#alerts' },
      { label: 'Billing', path: '/#billing' },
      { label: 'Audit log', path: '/#audit' },
    ],
  },
  {
    id: 'season-challenger',
    name: 'Season Challenger',
    kind: 'Fantasy football API',
    repo: 'svimran48/season-challenger',
    baseUrl: 'https://season-challenger-api.onrender.com',
    adminUrl: '/review',
    health: { path: '/health', json: true },
    metrics: 'seasonChallenger',
    tokenSecret: null,
    links: [{ label: 'KYC review', path: '/review' }],
  },
  {
    id: 'seasonbook',
    name: 'Seasonbook',
    kind: 'TV schedule PWA on Cloudflare',
    repo: 'svimran48/Seasonbook',
    baseUrl: null,
    adminUrl: '/',
    health: { path: '/api', json: false },
    metrics: 'seasonbook',
    tokenSecret: null,
    links: [
      { label: 'API docs', path: '/api' },
      { label: 'Notifications', path: '/api/notify/status' },
    ],
  },
  // The apps below were found on MJ's PC (not in the svimran48 GitHub account). Their live
  // URLs and admin routes aren't known yet: set them in APP_URLS or here.
  {
    id: 'a1score',
    name: 'A1 Score',
    kind: 'Next.js web app with a Prisma database',
    repo: null,
    baseUrl: null,
    adminUrl: '/',
    health: { path: '/', json: false },
    metrics: null,
    tokenSecret: null,
    links: [],
  },
  {
    id: 'sportzfylive',
    name: 'Sportzfy Live',
    kind: 'Live sports website',
    repo: null,
    baseUrl: null,
    adminUrl: '/',
    health: { path: '/', json: false },
    metrics: null,
    tokenSecret: null,
    links: [],
  },
  {
    id: 'stream-proxy',
    name: 'Stream Proxy',
    kind: 'Node stream proxy service',
    repo: null,
    baseUrl: null,
    adminUrl: '/',
    health: { path: '/', json: false },
    metrics: null,
    tokenSecret: null,
    links: [],
  },
];

/** Joins an app's base URL and a path. Returns null when the app has no base URL. */
export function appUrl(app, path = '/') {
  if (!app.baseUrl) return null;
  return new URL(path, app.baseUrl).toString();
}

/** Applies per-app overrides from the APP_URLS var ({"kestrel":"https://…"}), so URLs can change without a code edit. */
export function resolveApps(env = {}, apps = APPS) {
  let overrides = {};
  if (env.APP_URLS) {
    try {
      overrides = JSON.parse(env.APP_URLS);
    } catch {
      overrides = {};
    }
  }
  return apps.map((app) => {
    const url = overrides[app.id];
    if (typeof url === 'string' && /^https:\/\//.test(url)) return { ...app, baseUrl: url };
    return app;
  });
}
