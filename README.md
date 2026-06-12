# ATProto Sticky Quote Canvas

Browser-only React app for saving quotes as Japanese-stationery-style notes on an infinite canvas. Public pages are shareable at `/:handle` (for example `/kzoeps.com`), while records are still read and written by the owner's DID-backed PDS repo.

V1 scope:

- one infinite canvas per user
- shareable public pages at `/:handle`
- signed-out landing page at `/`
- owner-only create, edit, move, and delete controls
- persistent note position and rotation
- public AT Protocol records on the user's PDS
- local development with ATProto OAuth loopback mode

## Quick start

Requirements:

- Node.js 20+
- pnpm
- Playwright Chromium browser for e2e tests when needed

Install dependencies:

```bash
pnpm install
```

Create local public config:

```bash
cp .env.example .env.local
```

Default local values are:

```env
VITE_PUBLIC_APP_ORIGIN=http://127.0.0.1:5173
VITE_PUBLIC_OAUTH_CLIENT_METADATA_URL=http://127.0.0.1:5173/client-metadata.json
```

Run the dev server:

```bash
pnpm dev --host 127.0.0.1
```

Open:

```text
http://127.0.0.1:5173
```

Open a public notes page directly with a handle path such as `http://127.0.0.1:5173/kzoeps.com`, or use a real ATProto/Bluesky handle on the login page to create your own notes. Do not put secrets in `.env.local`; this SPA uses public OAuth with PKCE and no client secret.

## Scripts

```bash
pnpm dev            # Vite dev server
pnpm test           # Vitest unit/component/integration tests
pnpm test:e2e:list  # list Playwright e2e tests without running them
pnpm test:e2e       # Playwright mocked OAuth/PDS smoke tests
pnpm build          # TypeScript check + production Vite build
```

If Playwright browsers are missing:

```bash
pnpm exec playwright install chromium
```

## Public config and secrets

| Value | Used for | Local value |
| --- | --- | --- |
| `VITE_PUBLIC_APP_ORIGIN` | Public app origin and OAuth callback construction | `http://127.0.0.1:5173` |
| `VITE_PUBLIC_OAUTH_CLIENT_METADATA_URL` | Browser-accessible OAuth metadata URL | `http://127.0.0.1:5173/client-metadata.json` |
| `VITE_E2E_ATPROTO_MOCK` | Enables deterministic ATProto mock boundary for tests only | `true` in Playwright config |

Never commit API keys, OAuth secrets, refresh tokens, or Linear keys. Linear automation uses `LINEAR_API_KEY` from the shell environment only; the app itself does not need it.

## ATProto OAuth

Local development uses ATProto OAuth loopback mode. The app normalizes `localhost` to `127.0.0.1` for callback URLs and rejects non-loopback `http://` origins.

Production is not finalized yet. Before release, confirm the deployment origin and update/host `public/client-metadata.json` so these match exactly:

- `client_id`
- `client_uri`
- `redirect_uris`, especially `/oauth/callback`

More detail: [`docs/atproto-oauth.md`](docs/atproto-oauth.md).

## Shareable handle pages

Public notes pages live at `/:handle`, for example:

```text
https://notes.example/kzoeps.com
https://notes.example/dorji.bsky.social
```

The handle in the URL is user-facing only. The app resolves the handle to a DID, resolves that DID document to the current canonical handle and PDS endpoint, then reads quote/settings records from `at://<did>/...`. Query caches remain DID-scoped, so a handle change does not create a second notes cache for the same account.

Route behavior:

- `/`: signed-out users see a landing page; signed-in users are redirected to their current canonical handle page.
- `/:handle`: everyone can read the owner's public notes. Non-canonical handle casing or aliases redirect to the DID document's current handle when it can be resolved.
- owner viewers see Add/Edit/Delete/drag/retry controls.
- signed-out viewers and signed-in non-owners see a read-only page with no write controls.
- the toolbar shows the page owner's canonical handle, an icon-only share button that copies the page URL, and sign-in/logout controls.

## UI layout

The public canvas uses a board-first stationery layout: a parchment canvas, literary paper-slip notes, a compact top-right identity/share/logout pill, and a floating **Add note** action for the page owner. The toolbar shows the board owner's public Bluesky avatar, display name, and handle via unauthenticated public AppView reads, so no extra OAuth scope is needed. The login page is a minimal handle field with a single **Log in** action. The add-note action opens a right-side composer panel; signed-out viewers and non-owners see the notes without board chrome or write controls.

Every quote record remains public ATProto/PDS data. The landing page and docs keep the privacy warning; the board view stays visually quiet, so do not use the app for private or sensitive notes.

## PDS records and lexicons

Quote and settings records are stored in the owner's public PDS repo, identified by DID after handle resolution.

| Purpose | Collection NSID | Record key |
| --- | --- | --- |
| Sticky quotes | `com.kzoeps.stickyquotes.canvas.quote` | PDS-generated `tid` |
| Canvas settings | `com.kzoeps.stickyquotes.canvas.settings` | literal `self` |

No handle is stored in quote or settings records.

Quote records live at AT URIs shaped like:

```text
at://<did>/com.kzoeps.stickyquotes.canvas.quote/<rkey>
```

Settings records live at:

```text
at://<did>/com.kzoeps.stickyquotes.canvas.settings/self
```

All quote text, metadata, position, color, and settings data are public/discoverable PDS data in v1. Do not save private notes or secrets.

More detail: [`docs/lexicons.md`](docs/lexicons.md).

## Mocked e2e tests

`pnpm test:e2e` starts Vite with `VITE_E2E_ATPROTO_MOCK=true` and uses the deterministic mock boundary in `src/test/mocks/atprotoHandlers.ts`.

The smoke tests verify app behavior across reloads:

- signed-out `/` landing page and public read-only `/:handle` pages
- non-canonical handle redirect to the current handle
- mocked OAuth login landing on the owner handle page
- share button that copies the page URL
- create quote
- reload
- move quote
- reload again
- edit quote
- delete quote
- signed-in non-owner read-only behavior
- recover from a mocked create failure

Mocked e2e tests do not prove that a real PDS, real OAuth provider, DNS, or production client metadata is configured correctly. Run the manual real-PDS checklist before release.

More detail: [`docs/testing.md`](docs/testing.md).

## Manual real-PDS validation checklist

Use a non-sensitive test account because records are public.

1. Start dev on a loopback URL: `pnpm dev --host 127.0.0.1`.
2. Open `http://127.0.0.1:5173` while signed out and confirm the landing page appears.
3. Open `http://127.0.0.1:5173/<handle>` while signed out and confirm public records load without OAuth and no Add/Edit/Delete controls appear.
4. Log in with a handle.
5. Confirm `/` redirects to your canonical handle page and the toolbar shows your handle, share button, and logout button.
6. Use **Add note** to open the creation dialog, then create a quote.
7. Reload; confirm the quote still appears with the same tilt.
8. Move the quote.
9. Reload; confirm the quote appears in the moved position.
10. Edit the quote text or metadata.
11. Reload; confirm the edit persisted.
12. Delete the quote.
13. Reload; confirm it stays deleted.
14. Log out and reopen your handle URL; confirm it remains publicly readable and read-only.
15. Sign in as a different account and open the first account's handle URL; confirm it remains read-only.

## Known limitations and release follow-ups

- PDS records are public; v1 has no client-side encryption.
- Old handle URLs can only canonicalize if the old handle still resolves to the same DID. Reassigned or unresolvable handles need a future server-side alias/history design.
- Production OAuth metadata/origin is still pending and must be finalized before deployment.
- The build currently warns that the main bundle is larger than 500 kB. Likely follow-up: route/code splitting for ATProto and mock/test-only modules.
- Browser OAuth token and DPoP key material are readable by app JavaScript. Add a strict CSP before production and never render quote text as HTML.
- Custom lexicon validation can vary by PDS. The app validates locally and currently asks PDS writes not to enforce custom lexicon validation by default.
- The settings lexicon/API supports `lastViewport`, but the current UI does not restore viewport position from PDS settings yet.
