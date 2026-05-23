# Implementation Plan

## Goal
Implement shareable public notes pages at `/:handle` that resolve ATProto handles to DIDs internally, read/write quote records by DID, and show create/edit/delete controls only to the page owner.

## Approved Decisions and Assumptions
- Signed-out `/` is a public landing page with a sign-in CTA; signed-out users can still open `/:handle` directly.
- `/:handle` accepts ATProto handles only, not DID URLs; leading `@` and casing differences should normalize via redirect.
- Public handle pages should canonicalize to the current resolved handle. After resolving the route handle to a DID, resolve that DID's current handle and redirect with `replace: true` when the URL handle differs.
- Owners get a visible copy-share-link control.
- The public toolbar shows the page owner's handle and DID, with a copy button next to the share/identity area. It may also show the active viewer's signed-in state separately.
- Quote/settings record schemas do not need to change because records already live in the repo identified by DID and AT URIs already use `at://<did>/...`.
- Old handle links cannot be made durable without a server-side alias/history table. This plan keeps data durable by DID after a handle is resolved, but a stale handle URL may stop resolving or may resolve to a different DID if the handle is reassigned.
- Public PDS reads should be possible without OAuth by resolving the handle to a DID and PDS endpoint, then calling public repo XRPCs. This must be manually verified against real PDSes because the current implementation only uses authenticated XRPC clients outside the test mock.

## Current Code Findings
- Routing is manual TanStack Router setup in `src/routeTree.gen.ts` with routes for `/`, `/login`, and `/oauth/callback`.
- `/` is currently protected in `src/routes/index.tsx` and redirects signed-out users to `/login`.
- Auth session state in `src/features/auth/authQueries.ts` exposes only `{ did }`; no current handle is available for redirecting `/` to `/:handle`.
- `CanvasPage` currently restores the active session internally and always reads/mutates the active DID. It needs to be parameterized by page owner DID/handle.
- Quote query keys are already DID-scoped (`['quotes', did]` and `['canvasSettings', did]`), which matches the approved direction.
- Low-level record reads in `src/lib/atproto/records.ts` currently require `getAuthenticatedAtprotoAgent()` even when a `repo` is passed. This blocks signed-out public pages.
- `InfiniteCanvas`, `StickyNote`, and `StickyNoteMenu` already hide move/edit/delete behavior when handler props are omitted. `CanvasPage` must stop passing handlers for non-owners and should not render the add-note dialog for non-owners.
- The deterministic ATProto test mock in `src/test/mocks/atprotoHandlers.ts` supports repos keyed by DID but has no handle-to-DID identity mapping yet.

## Tasks

1. **Add handle/path constants and route guards**
   - File: `src/lib/config.ts`
   - Changes: Add `publicHandlePage` route helper/constant if desired, `ATPROTO_PUBLIC_RESOLVER_SERVICE` (likely `https://bsky.social`), and `RESERVED_ROUTE_SEGMENTS` for `login`, `oauth`, `new`, `settings`, `about`, `api`, and static asset-like paths.
   - Acceptance: Internal route names are centralized and the worker has one source of truth for reserved handle path segments.

2. **Create ATProto identity resolution helpers**
   - File: `src/lib/atproto/identity.ts`
   - Changes: New module with public documented types and functions:
     - `normalizeRouteHandle(raw: string): string`
     - `validateRouteHandle(handle: string): void` with actionable errors for reserved/invalid segments.
     - `resolveHandleToIdentity(handle, options)` returning `{ did, handle, pdsEndpoint }`.
     - `resolveDidToIdentity(did, options)` returning the current handle and PDS endpoint for an authenticated DID.
     - DID document parsing for `did:plc` and `did:web`, including `#atproto_pds` service endpoint extraction.
   - Acceptance: A valid handle resolves to a DID and PDS endpoint; invalid/reserved handles fail before any notes query runs; errors say what failed and what to do.

3. **Add identity query hooks**
   - File: `src/features/identity/identityQueries.ts`
   - Changes: New TanStack Query keys/hooks:
     - `identityQueryKeys.handle(handle)`
     - `identityQueryKeys.did(did)`
     - `useHandleIdentityQuery(handle)`
     - `useDidIdentityQuery(did)`
   - Acceptance: Identity lookups are cached separately from quote records and can be reused by `/`, `/:handle`, and auth UI.

4. **Support unauthenticated public repo reads**
   - File: `src/lib/atproto/records.ts`
   - Changes: Extend read input types (`ListRepoRecordsInput`, `GetRepoRecordInput`, `GetSettingsRecordInput`) with a public read option such as `serviceEndpoint?: string` / `auth?: 'public' | 'authenticated'`. For public reads, call the resolved PDS endpoint directly without `getAuthenticatedAtprotoAgent()`. Keep `createRepoRecord`, `putRepoRecord`, and `deleteRepoRecord` authenticated-only.
   - Acceptance: `listRepoRecords({ repo: did, collection, serviceEndpoint, auth: 'public' })` works without an active OAuth session; write helpers still fail clearly when no session exists.

5. **Thread public read options through quote APIs**
   - File: `src/features/quotes/quoteApi.ts`
   - Changes: Add `serviceEndpoint` / public-read options to `QuoteRepositoryCallOptions`, `ListQuoteRecordsInput`, and settings read inputs. Pass these through to `listAllRepoRecords`, `getRepoRecord`, and `getSettingsRecord`. Do not add handle fields to quote records.
   - Acceptance: `listQuoteRecords({ repo: ownerDid, serviceEndpoint })` reads by DID and validates records exactly as before.

6. **Update quote query hooks for page-owner reads**
   - File: `src/features/quotes/quoteQueries.ts`
   - Changes: Change `useQuotesQuery(did)` to accept owner read options, e.g. `useQuotesQuery(ownerDid, { serviceEndpoint })`. Keep the query key as `quoteQueryKeys.byDid(ownerDid)`. Keep mutation hooks DID-scoped but document they should receive only the active owner DID.
   - Acceptance: Public pages cache quote lists by DID, not handle; changing the route handle does not create a separate quote cache for the same DID.

7. **Expose active account handle for redirects**
   - File: `src/features/auth/authQueries.ts`
   - Changes: Either extend `ActiveAuthSessionSummary` to `{ did: string; handle?: string }` after resolving the DID, or add a separate active identity query in routes. Ensure session restore still succeeds if OAuth is valid but identity lookup is handled with a clear route-level error/retry.
   - Acceptance: A logged-in user’s current handle can be obtained from their active DID so `/` can redirect to `/:handle`.

8. **Refactor `CanvasPage` to take page-owner context**
   - File: `src/features/canvas/CanvasPage.tsx`
   - Changes: Replace internal auth/session lookup with props like `{ ownerDid, ownerHandle, ownerPdsEndpoint, activeDid, isOwner }`. Read quotes with the owner DID and PDS endpoint. Instantiate/pass create/move/update/delete/retry handlers only when `isOwner` is true. Render the add-note command bar and dialog only for owners.
   - Acceptance: Non-owner and signed-out viewers can see notes but the DOM contains no Add note button, add-note dialog, Edit buttons, Delete buttons, or retry/write controls.

9. **Keep canvas and note components read-only by omission of handlers**
   - File: `src/features/canvas/InfiniteCanvas.tsx`
   - Changes: No major logic change expected. Verify `canMove` remains false when `onMoveQuote` is omitted and that handler props are only forwarded when present.
   - Acceptance: Notes cannot be dragged on public read-only pages.

10. **Verify sticky note menu hiding for read-only pages**
    - File: `src/features/quotes/StickyNote.tsx`, `src/features/quotes/StickyNoteMenu.tsx`
    - Changes: Prefer no change unless tests reveal empty topbar/layout issues. If needed, hide the topbar action area entirely when no edit/delete/retry actions exist.
    - Acceptance: Public viewers do not see edit/delete UI; owner behavior remains unchanged.

11. **Add reusable account/public toolbar UI**
    - File: `src/features/auth/AuthToolbar.tsx`
    - Changes: New component for signed-in status, public-data warning, sign-in link for anonymous viewers, logout action, and share-link copying. It should show the page owner's canonical handle and DID, place a copy button next to that identity/share area, and indicate whether the active viewer owns the current page.
    - Acceptance: `/:handle` shows “Viewing public notes” plus the owner handle, owner DID, and a copy-share-link button for everyone, while owners also see signed-in/logout state.

12. **Implement the dynamic handle route**
    - File: `src/routes/$handle.tsx`
    - Changes: New route with `path: '/$handle'` (verify TanStack syntax against the existing code-route style). Normalize/validate `params.handle`, redirect from uppercase or `@handle`, resolve handle identity, resolve the owner's current canonical handle from the DID, redirect with `replace: true` when the URL handle differs from that canonical handle, load auth session in parallel, compute `isOwner = session?.did === identity.did`, render `CanvasPage` and toolbar.
    - Acceptance: `/kzoeps.com` and `/dorji.bsky.social` render the resolved DID’s public notes; non-canonical handle URLs redirect to the resolved current handle; signed-out users are not redirected to login; non-owners stay read-only.

13. **Change the home route into redirect/landing behavior**
    - File: `src/routes/index.tsx`
    - Changes: Replace the protected canvas behavior. If session is pending, show restore status. If no session, render a landing page with sign-in CTA and short explanation that shared `/:handle` pages are public. If session exists, resolve the active DID’s current handle and redirect to `/:handle` with `replace: true`.
    - Acceptance: Logged-in `/` redirects to the current handle page; logged-out `/` no longer blocks public browsing by forcing `/login`.

14. **Update login route redirect behavior**
    - File: `src/routes/login.tsx`
    - Changes: Keep handle-based OAuth start. If already signed in, navigate to `/` or directly to the active handle page after identity resolution. Make copy consistent with public pages.
    - Acceptance: Visiting `/login` while signed in does not leave the user on login; sign-in still starts OAuth from a handle.

15. **Update OAuth callback post-login navigation**
    - File: `src/routes/oauth.callback.tsx`
    - Changes: After `completeOAuthCallback()`, update auth query data and navigate to `/` (letting home redirect), or resolve the DID immediately and navigate to `/:handle`. Keep callback error handling unchanged.
    - Acceptance: Completing OAuth lands on the user’s handle page, not the old protected canvas at `/`.

16. **Register the dynamic route safely**
    - File: `src/routeTree.gen.ts`
    - Changes: Import the handle route and add it to `rootRoute.addChildren`. Keep static routes (`/login`, `/oauth/callback`) registered and protected by reserved segment validation.
    - Acceptance: `/login` and `/oauth/callback` still match their internal pages; `/oauth` or `/new` do not get treated as valid handles.

17. **Extend the ATProto mock with identity mapping**
    - File: `src/test/mocks/atprotoHandlers.ts`
    - Changes: Add handle mapping to mock state, e.g. `handles: Record<string, string>` or repo-level `handle`. Add helpers such as `seedMockHandle(handle, did)`, `mockResolveHandle(handle)`, and `mockResolveDid(did)`. Make `mockStartOAuthLogin({ handle })` remember that handle for `MOCK_ATPROTO_DID`.
    - Acceptance: Tests can seed `alice.test -> did:...alice` and `bob.test -> did:...bob`, then resolve those handles without real network calls.

18. **Add identity and public-read unit tests**
    - File: `src/lib/atproto/identity.test.ts`, `src/test/mocks/atprotoHandlers.test.ts`
    - Changes: Test handle normalization, reserved route rejection, mock handle resolution, DID-to-handle resolution, and public read of a seeded repo without an active mock OAuth session.
    - Acceptance: `pnpm test` covers the critical handle/DID resolution contract before route tests run.

19. **Add CanvasPage/StickyNote ownership tests**
    - File: `src/features/canvas/CanvasPage.test.tsx` or extend `src/features/quotes/StickyNote.test.tsx`
    - Changes: Render owner and non-owner states with seeded query data. Assert owner sees Add/Edit/Delete; non-owner/signed-out viewer does not.
    - Acceptance: Tests fail if write controls accidentally appear for non-owners.

20. **Update mocked Playwright e2e flows**
    - File: `e2e/sticky-quote-canvas.spec.ts`
    - Changes: Update sign-in expectations to land on `/:handle`. Add tests for:
      - signed-out viewer opens `/alice.test` and sees seeded notes without Add/Edit/Delete.
      - owner signs in as `alice.test`, lands on `/alice.test`, and can create/move/edit/delete.
      - signed-in Alice viewing `/bob.test` remains read-only.
      - non-canonical handle URLs redirect to the resolved current handle.
      - copy-share-link button copies the canonical `/:handle` URL.
    - Acceptance: Existing CRUD smoke test still passes under the new route model and read-only public behavior is covered.

21. **Update docs for shareable pages**
    - File: `README.md`
    - Changes: Document `/:handle` public pages, `/` redirect behavior, owner-only controls, and that records are queried by DID after handle resolution.
    - Acceptance: A new developer understands why the URL contains a handle but query keys/PDS repos use DIDs.

22. **Update OAuth docs route responsibilities**
    - File: `docs/atproto-oauth.md`
    - Changes: Replace old “`/` protected canvas route” wording with new home redirect/landing behavior. Note that OAuth completion routes users to their current handle page.
    - Acceptance: Docs match actual route flow.

23. **Update lexicon/data-model docs**
    - File: `docs/lexicons.md`, `docs/product-decisions.md`
    - Changes: Add product decision for shareable handle routes and DID-backed records. Clarify read flow: handle -> DID -> PDS endpoint -> list quote collection from DID repo. State that no handle is stored in quote records.
    - Acceptance: Data model docs explicitly distinguish user-facing handles from stable DID storage/query identity.

24. **Update styles for public/owner page chrome**
    - File: `src/styles/globals.css`
    - Changes: Add styles only for new landing/public toolbar/canvas page header states. Reuse existing Japanese minimal visual language; avoid broad restyling.
    - Acceptance: New route states are readable on desktop/mobile without changing sticky note styling unnecessarily.

25. **Run focused validation**
    - Files: all changed files
    - Changes: No code change; run validation commands.
    - Acceptance: `pnpm test`, `pnpm build`, and `pnpm test:e2e` pass or any failures are documented with exact cause and next step.

## Files to Modify
- `src/lib/config.ts` - add route/reserved segment constants and public identity resolver service constant.
- `src/lib/atproto/records.ts` - support public unauthenticated read calls while keeping writes authenticated.
- `src/features/quotes/quoteApi.ts` - pass public read options through quote/settings read APIs.
- `src/features/quotes/quoteQueries.ts` - read quote lists for a page-owner DID/PDS endpoint; keep DID-scoped cache keys.
- `src/features/auth/authQueries.ts` - expose or coordinate active DID-to-handle identity for redirects.
- `src/features/canvas/CanvasPage.tsx` - accept owner/auth props and hide all write controls for non-owners.
- `src/features/canvas/InfiniteCanvas.tsx` - verify/read-only behavior; likely minor or no change.
- `src/features/quotes/StickyNote.tsx` - verify/hide empty action UI if needed.
- `src/features/quotes/StickyNoteMenu.tsx` - verify no edit/delete controls render without handlers.
- `src/routes/index.tsx` - change `/` from protected canvas to logged-in redirect plus signed-out landing.
- `src/routes/login.tsx` - align signed-in redirect with handle-page flow.
- `src/routes/oauth.callback.tsx` - route completed sign-in to home/handle page flow.
- `src/routeTree.gen.ts` - register the dynamic handle route.
- `src/test/mocks/atprotoHandlers.ts` - add deterministic handle/DID identity mock behavior.
- `src/test/mocks/atprotoHandlers.test.ts` - cover identity mock behavior and public reads.
- `src/features/quotes/StickyNote.test.tsx` - extend read-only/action rendering coverage if not using CanvasPage tests.
- `e2e/sticky-quote-canvas.spec.ts` - update CRUD flow and add public/non-owner e2e coverage.
- `src/styles/globals.css` - style new landing/public toolbar states.
- `README.md` - document shareable handle pages and DID-backed records.
- `docs/atproto-oauth.md` - update route responsibilities.
- `docs/lexicons.md` - document handle-to-DID read flow.
- `docs/product-decisions.md` - record the approved shareable page behavior.

## New Files
- `src/lib/atproto/identity.ts` - handle normalization, reserved-route validation, handle-to-DID resolution, DID-to-current-handle resolution, and PDS endpoint extraction.
- `src/features/identity/identityQueries.ts` - TanStack Query hooks/keys for handle and DID identity lookups.
- `src/features/auth/AuthToolbar.tsx` - reusable signed-in/signed-out public page toolbar with owner handle, owner DID, copy-share-link button, and logout UI.
- `src/routes/$handle.tsx` - shareable public notes page route.
- `src/lib/atproto/identity.test.ts` - unit tests for normalization, validation, and identity resolution helpers.
- `src/features/canvas/CanvasPage.test.tsx` - ownership/read-only rendering tests if route-level tests are not enough.

## Data Model/API Changes
- No PDS record schema migration is required.
- Quote records remain in `com.kzoeps.stickyquotes.canvas.quote` under `at://<did>/...`.
- Settings remain in `com.kzoeps.stickyquotes.canvas.settings/self` under `at://<did>/...`.
- Do not add `handle` to quote or settings records.
- Query caches remain DID-scoped: `['quotes', did]` and `['canvasSettings', did]`.
- New identity caches are separate and may be handle-scoped or DID-scoped.
- Public reads need an API path that does not require OAuth; writes must continue to require the authenticated owner session.

## Route Behavior
- `/`: restore auth session.
  - Logged in: resolve active DID to current handle and redirect to `/:handle` with `replace: true`.
  - Logged out: show public landing/sign-in CTA.
  - Session restore error: show retry + sign-in-again actions.
- `/:handle`: public page.
  - Normalize handle casing and optional leading `@`.
  - Reject reserved/internal segments before identity lookup.
  - Resolve handle to DID and PDS endpoint.
  - Resolve the owner DID back to its current handle and redirect to that canonical handle if the URL differs.
  - Load quote records by owner DID.
  - Compute ownership by comparing active session DID to resolved owner DID.
- `/login`: explicit OAuth login route.
- `/oauth/callback`: completes OAuth, then navigates into the new home/handle redirect flow.
- Reserved paths such as `/login`, `/oauth/callback`, `/new`, `/settings`, `/about`, and `/api` must not be treated as handles.

## Auth/Ownership Logic
- Owner identity: resolved from URL handle to `{ did, handle, pdsEndpoint }`.
- Active viewer identity: restored from OAuth session as `{ did }`, with current handle resolved separately when needed.
- `isOwner = activeViewer.did === owner.did`.
- Only owners receive mutation handlers in `CanvasPage`.
- Only owners see the add-note command bar/dialog.
- Non-owners and signed-out viewers can read notes but cannot drag, edit, delete, retry failed writes, or open create UI.
- Client-side hiding is UX protection; write APIs should still produce clear auth/ownership errors if called without an active owner session.

## UI Behavior
- Public page toolbar should clearly show the page owner's canonical handle and DID.
- The toolbar should include a copy-share-link button next to the owner identity/share area; the copied URL should use the canonical `/:handle` path.
- Signed-out public viewers should see a sign-in link but no write controls.
- Signed-in non-owners should see their signed-in state and a read-only notice.
- Owners should see the existing Japanese-minimal canvas UI plus Add note, edit, delete, drag, copy share link, and logout controls.
- Existing note rendering and source-link safety behavior should remain unchanged.

## Validation Contract
- Unit tests:
  - Handle normalization strips `@`, lowercases, rejects reserved/internal segments, rejects malformed handles.
  - Identity helpers parse DID docs, extract PDS endpoints, and resolve the current canonical handle with actionable failures.
  - Public quote reads work with a repo DID and PDS endpoint while signed out.
  - Quote query keys stay DID-scoped.
- Component tests:
  - Owner sees Add/Edit/Delete and can trigger handlers.
  - Signed-out/non-owner viewer sees notes but no Add/Edit/Delete/drag controls.
- E2E tests:
  - Signed-out `/alice.test` can display seeded public notes.
  - Signing in as Alice lands on `/alice.test` and existing create/move/edit/delete smoke flow still works.
  - Signed-in Alice viewing `/bob.test` is read-only.
- Commands:
  - `pnpm test`
  - `pnpm build`
  - `pnpm test:e2e:list`
  - `pnpm test:e2e`
- Manual real-PDS check:
  - Sign out, open a real handle URL, confirm public records load without OAuth.
  - Sign in as that handle, confirm controls appear.
  - Sign in as a different handle, confirm controls stay hidden.

## Migration and Backcompat Concerns
- Existing PDS records remain valid because they are already DID-owned ATProto repo records.
- Existing users who bookmarked `/` will be redirected to their current handle page after login.
- Existing tests and mocks assume active DID-only OAuth; mock identity mapping must be added to avoid brittle route tests.
- Existing local mock state may need a small shape migration or reset in tests when adding handle maps.
- If a user changes handle, records stay under the same DID. Old handle URLs can canonicalize only when the route handle still resolves to that DID; if it no longer resolves or has been reassigned, the app cannot safely map it without an external alias/history service.

## Dependencies
- Tasks 1-3 define route and identity primitives needed by routes and auth redirects.
- Tasks 4-6 are required before signed-out public pages can load notes.
- Tasks 7, 13, and 15 depend on DID-to-handle identity lookup.
- Task 8 depends on Tasks 4-6 for page-owner reads.
- Task 12 depends on Tasks 1-8.
- Task 16 depends on Task 12.
- Tasks 17-20 depend on the identity and route implementation shape.
- Tasks 21-24 should be updated after route and UI behavior is finalized.
- Task 25 depends on all implementation tasks.

## Risks
- Public unauthenticated `com.atproto.repo.listRecords` behavior and CORS must be validated against real PDSes; the current code path only proves mocked behavior.
- The exact best SDK/API path for resolving DID -> current handle/PDS endpoint should be verified during implementation.
- Dynamic `/:handle` route can accidentally catch future internal pages unless reserved route validation stays centralized and tested.
- Owner controls hidden by UI are not a security boundary; authenticated write helpers must still rely on OAuth/PDS authorization and ideally local owner checks.
- DID document resolution for `did:web` has more failure modes than `did:plc` because it depends on HTTPS hosting and CORS.
- Handle reassignment can make a stale shared URL point at a different DID. Canonicalization cannot fix reassigned handles, so the app should display the resolved handle/DID context clearly.

## Remaining Open Question
- Is supporting `did:web` handles in public pages required for launch, or is `did:plc` enough initially?
