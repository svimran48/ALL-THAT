# ALL-THAT

One admin hub for every app you run. It signs you in once, checks each app's health every five minutes, shows each app's key numbers, and links straight into that app's own admin panel.

It is a single Cloudflare Worker with no runtime dependencies.

## What it watches

| App | Live URL | What the hub reads | Admin link |
| --- | --- | --- | --- |
| Kestrel (`spy-pro`) | not set yet | `/api/auth/status`; fleet numbers once `KESTREL_ADMIN_TOKEN` is set | dashboard, devices, alerts, billing, audit log |
| Season Challenger | `season-challenger-api.onrender.com` | `/health` (database and feed) | KYC review page at `/review` |
| Seasonbook | not set yet | `/api` and `/api/notify/status` | the PWA, API docs |

Add or change apps in `src/apps.config.js`. Live URLs can also be set without a code change through the `APP_URLS` var in `wrangler.toml`.

## Set up

```sh
npm install
npx wrangler login

# 1. Session signing key: 32+ random characters
npx wrangler secret put SESSION_SECRET

# 2. Your password, hashed (PBKDF2-SHA256). It is read from stdin, not typed on the command line.
node scripts/hash-password.js | npx wrangler secret put OWNER_PASSWORD_HASH

# 3. Optional: uptime history
npx wrangler kv namespace create HISTORY     # paste the id into wrangler.toml

npm run deploy
```

Without both secrets the hub refuses every sign-in and serves nothing but the login page.

For local work, copy `.dev.vars.example` to `.dev.vars`, fill it in, and run `npm run dev`. `.dev.vars` is git-ignored.

## Security model

- **Owner login.** One password, checked with PBKDF2 (100k iterations, the Workers limit) and a constant-time compare. Five wrong tries from one IP lock that IP out for 15 minutes.
- **Session cookie.** `__Host-` prefixed, `HttpOnly`, `Secure`, `SameSite=Strict`, signed with HMAC-SHA256, and valid for 12 hours. Change `SESSION_VERSION` to sign out every session.
- **Gate first.** `run_worker_first` sends every request through the session check, including static files, so the dashboard's HTML and JS are never served to a signed-out visitor.
- **No secrets in the browser.** App tokens are Worker secrets. The hub uses them server-side for read-only GETs to URLs fixed in config, and never returns them or their names.
- **No markup injection.** The dashboard builds every node with `textContent`. A strict CSP (`script-src 'self'`, `frame-ancestors 'none'`) is set on every response.
- **Admin panels stay where they are.** The hub links to each app's admin in a new tab. You sign in to that app with its own login, so the hub never holds those passwords.

**Recommended:** put [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/) in front of the hub's hostname (free for one user) so only your Google or GitHub identity can reach the login page. Add a WAF rate-limit rule on `/api/login`. The built-in throttle is per Worker isolate, so it slows guessing but can't stop a distributed attack on its own.

## Connecting Kestrel's numbers

Kestrel only accepts browser sessions today. To show devices, alerts and accounts here, add a read-only route to Kestrel:

```
GET /api/admin/summary   Authorization: Bearer <KESTREL_ADMIN_TOKEN>
→ { "devices": 12, "devices_online": 9, "open_alerts": 2, "tenants": 4 }
```

Then set the same token on the hub with `npx wrangler secret put KESTREL_ADMIN_TOKEN`.

## Tests

```sh
npm test
```

The tests cover password hashing, session signing, tamper and expiry handling, sign-in throttling, origin checks, the asset gate, secret redaction, health classification and the app adapters.
