# Shareable User Pages Worker Handoff

## Changed files

- `plans/shareable-user-pages-plan.md`
- `src/lib/config.ts`
- `src/lib/atproto/identity.ts`
- `src/lib/atproto/identity.test.ts`
- `src/lib/atproto/records.ts`
- `src/features/identity/identityQueries.ts`
- `src/features/auth/AuthToolbar.tsx`
- `src/features/canvas/CanvasPage.tsx`
- `src/features/canvas/CanvasPage.test.tsx`
- `src/features/quotes/quoteApi.ts`
- `src/features/quotes/quoteQueries.ts`
- `src/features/quotes/StickyNote.tsx`
- `src/routes/$handle.tsx`
- `src/routes/index.tsx`
- `src/routes/login.tsx`
- `src/routes/oauth.callback.tsx`
- `src/routeTree.gen.ts`
- `src/test/mocks/atprotoHandlers.ts`
- `src/test/mocks/atprotoHandlers.test.ts`
- `e2e/sticky-quote-canvas.spec.ts`
- `src/styles/globals.css`
- `README.md`
- `docs/atproto-oauth.md`
- `docs/lexicons.md`
- `docs/product-decisions.md`
- `docs/testing.md`
- `plans/shareable-user-pages-worker-handoff.md`

## Implemented

- Added public `/:handle` notes pages that resolve handle → DID → DID document/current handle/PDS endpoint.
- Added canonical redirects for normalized/non-current handle URLs.
- Kept quote/settings records and query caches DID-scoped; no handle fields were added to records.
- Added unauthenticated public repo reads using resolved DID + PDS endpoint while keeping writes authenticated.
- Refactored `CanvasPage` to render owner or read-only viewer mode from page-owner context.
- Hid Add/Edit/Delete/drag/retry controls for signed-out viewers and signed-in non-owners.
- Changed `/` to signed-out landing page and signed-in redirect to the current canonical handle page.
- Added public toolbar showing owner handle + DID with a copy-share-link button, plus viewer/owner auth state and logout/sign-in actions.
- Extended deterministic ATProto mocks with handle/DID identity mapping and public-read behavior.
- Added/updated unit, component, and Playwright coverage for handle normalization, canonicalization, public reads, owner vs viewer controls, route flow, and copy link.
- Updated README and docs for shareable pages, DID-backed data model, route responsibilities, and validation expectations.

## Validation observed

- `pnpm typecheck` — passed.
- `pnpm test` — passed: 9 test files, 52 tests.
- `pnpm build` — passed.
  - Vite emitted the existing-style warning that the main chunk is larger than 500 kB after minification (`index-*.js` about 1,237 kB / 291 kB gzip).
- `pnpm test:e2e:list` — passed; listed 6 Playwright tests.
- `pnpm test:e2e` — passed: 6/6 Chromium tests.

## Remaining undone

- Manual real-PDS validation was not run, per constraint to avoid real external PDS/network validation without explicit approval.
- Durable old-handle support after handle reassignment remains out of scope; it would require a server-side alias/history table.

## Risks / surprises

- The working directory is not a git repository, so no git diff/status summary was available.
- Public read behavior, DID document parsing, and browser CORS still need manual verification against real PDSes.
- Dynamic `/:handle` routing depends on the centralized reserved-route segment list staying current as new internal routes are added.
- Build chunk size remains large; route/code splitting is still a likely follow-up.
