# ATProto OAuth

This app uses ATProto OAuth to authenticate a browser user before writes. Public `/:handle` pages can read quote records without OAuth after resolving the owner handle to a DID and PDS endpoint. OAuth implementation is isolated in:

- `src/lib/atproto/oauthClient.ts`
- `src/lib/atproto/sessionStore.ts`
- `src/lib/atproto/agent.ts`
- `public/client-metadata.json`

No OAuth client secret is used. This is a public client flow with PKCE and DPoP-bound access tokens.

## Local development

Development uses ATProto OAuth loopback mode. Start the app on a loopback host:

```bash
cp .env.example .env.local
pnpm install
pnpm dev --host 127.0.0.1
```

Open:

```text
http://127.0.0.1:5173
```

Local public config values:

```env
VITE_PUBLIC_APP_ORIGIN=http://127.0.0.1:5173
VITE_PUBLIC_OAUTH_CLIENT_METADATA_URL=http://127.0.0.1:5173/client-metadata.json
```

These are public Vite values. Do not put secrets, API keys, refresh tokens, or Linear keys in `.env.local`.

## Loopback client behavior

`oauthClient.ts` builds a loopback `client_id` at runtime with `buildAtprotoLoopbackClientId(...)` from `@atproto/oauth-client`.

When the app is served from `http://localhost:5173`, the redirect URI is normalized to:

```text
http://127.0.0.1:5173/oauth/callback
```

Allowed local `http://` hosts are loopback hosts only:

- `localhost`
- `127.0.0.1`
- `[::1]`

If the app is opened from another `http://` origin, OAuth startup fails with an actionable error because loopback mode would not be valid.

## Production metadata

Production OAuth uses the canonical Posties deployment origin.

`public/client-metadata.json` contains production metadata for:

```text
https://posties.kzoeps.com/client-metadata.json
```

Before changing domains, update the hosted metadata so these values match exactly:

- `client_id`
- `client_uri`
- `redirect_uris`, including `/oauth/callback`
- `scope`

Current placeholder values:

- client metadata URL: `https://posties.kzoeps.com/client-metadata.json`
- callback URL: `https://posties.kzoeps.com/oauth/callback`
- scope: `atproto repo:com.kzoeps.stickyquotes.canvas.quote`
- token endpoint auth method: `none`
- DPoP-bound access tokens: enabled

Do not ship production OAuth until the final HTTPS origin serves the metadata document at the same URL used as `client_id`.

## Session storage

OAuth state and sessions are stored in IndexedDB under `atproto-sticky-canvas-oauth`.

Stored data includes:

- short-lived OAuth redirect state and PKCE verifier
- refresh/access token set returned by the authorization server
- DPoP signing key material
- active DID for the selected account
- DPoP nonce cache

Pending OAuth redirect state expires after one hour. Stored sessions persist across reloads so the app can restore the active account without another login.

## DPoP key implementation

The core `@atproto/oauth-client` package requires a runtime-specific key implementation. Because this project currently depends only on `@atproto/oauth-client`, `sessionStore.ts` provides a browser WebCrypto ES256 key wrapper.

If the project later adds an official browser runtime package such as `@atproto/oauth-client-browser` or a non-extractable key implementation from the ATProto stack, replace the local key wrapper behind `createBrowserDpopKey(...)` without changing feature code.

## Feature-code boundary

Feature code should not import `@atproto/oauth-client` directly. Use the app helper layer:

```ts
import {
  completeOAuthCallback,
  logoutActiveOAuthSession,
  restoreActiveOAuthSession,
  startOAuthLogin,
} from './lib/atproto/oauthClient'
```

Route responsibilities:

- `/login`: call `startOAuthLogin({ handle })`; signed-in users are sent back to `/` so the home route can redirect to the canonical handle page.
- `/oauth/callback`: call `completeOAuthCallback()` and redirect to `/`.
- `/`: restore the active session. Signed-out users see the landing page; signed-in users resolve their DID document and redirect to `/:handle`.
- `/:handle`: resolve the route handle to a DID, resolve the DID document to the current canonical handle and PDS endpoint, then read public records from that DID repo. Write controls are shown only when the active OAuth DID matches the page owner DID.
- logout action: call `logoutActiveOAuthSession()` and clear account-scoped query state. Public pages remain readable after logout.

`src/lib/atproto/agent.ts` creates the authenticated `@atproto/api` agent so PDS data modules do not need to know about OAuth token refresh, DPoP signing, or nonce handling.

## Multi-tab coordination

`sessionStore.ts` publishes events for:

- login
- logout
- account switch
- session deletion

It uses `BroadcastChannel` with a `localStorage` event fallback. `AuthProvider` subscribes to those events and clears DID-scoped quote/settings query caches on logout or account switch.

## Security notes

OAuth tokens and DPoP key material are browser-readable by design in this SPA. Treat XSS as account-compromising:

- never render quote text as HTML
- avoid `dangerouslySetInnerHTML`
- add a strict Content Security Policy before production
- do not store API keys or secrets in source files or `.env.local`
- keep `LINEAR_API_KEY` only in the shell environment for Linear automation

All quote and settings records are public PDS records for v1. OAuth only requests write access to `com.kzoeps.stickyquotes.canvas.quote`; public board reads do not require OAuth, settings writes are not currently requested, and board avatar/display-name chrome uses unauthenticated `app.bsky.actor.getProfile` reads from the public Bluesky AppView.

## Troubleshooting

- **OAuth says the origin is invalid:** serve the app from `127.0.0.1`, `localhost`, or `[::1]` for dev loopback mode.
- **Callback fails after returning to the app:** OAuth callbacks are single-use and can expire. Start login again from `/login`.
- **Session restore fails:** log out or clear site data, then sign in again.
- **Production login fails:** confirm `client_id`, hosted metadata URL, and `redirect_uris` are byte-for-byte consistent with the deployed HTTPS origin.
