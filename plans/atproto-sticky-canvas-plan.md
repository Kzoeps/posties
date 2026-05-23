# Implementation Plan

## Goal
Build a browser-only TanStack React app where an authenticated AT Protocol user stores, views, creates, moves, and deletes quote sticky notes on an infinite canvas, with all quote data persisted as custom records in the user's PDS.

## Recommended Approach
Use a Vite React SPA with TanStack Router and TanStack Query. Avoid SSR/TanStack Start for the first version because ATProto OAuth, token persistence, and PDS writes are browser-session concerns and do not require a server.

Assumption: create the app in the repository root. If the app should live in a subdirectory such as `apps/web`, adjust all paths below.

## Confirmed Product Decisions

- NSID authority/domain: use `kzoeps.com`, which maps to the AT Protocol NSID authority `com.kzoeps`.
- Lexicon IDs: use `com.kzoeps.stickyquotes.canvas.quote` and `com.kzoeps.stickyquotes.canvas.settings` unless the app name changes before implementation.
- Canvas model: v1 is one infinite canvas per user. Do not add `boardId` or multi-board routing in v1.
- Privacy stance: all quote records are public PDS data. Do not add client-side encryption in v1.
- OAuth development mode: use ATProto OAuth loopback mode for local development.
- Quote lifecycle: v1 must support create, edit, move, and delete.

## Recommended Project Structure and Packages

### Packages
- Core app: `react`, `react-dom`, `typescript`, `vite`, `@vitejs/plugin-react`
- Routing/data: `@tanstack/react-router`, `@tanstack/react-query`, `@tanstack/router-devtools`, `@tanstack/react-query-devtools`
- AT Protocol: `@atproto/api`, `@atproto/oauth-client` or the current official browser package/export for OAuth, plus `@atproto/lexicon` if using generated/local validation helpers
- Validation/utilities: `zod`, `clsx`
- Testing: `vitest`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`, `msw`, `playwright`

### Structure
```text
public/
  client-metadata.json
src/
  main.tsx
  routeTree.gen.ts
  routes/
    __root.tsx
    index.tsx
    login.tsx
    oauth.callback.tsx
  lib/
    atproto/
      agent.ts
      oauthClient.ts
      sessionStore.ts
      nsids.ts
      records.ts
      lexicons/
        com.kzoeps.stickyquotes.canvas.quote.json
        com.kzoeps.stickyquotes.canvas.settings.json
      validation.ts
    config.ts
  features/
    auth/
      AuthProvider.tsx
      authQueries.ts
      LoginForm.tsx
    canvas/
      CanvasPage.tsx
      InfiniteCanvas.tsx
      useCanvasViewport.ts
      useDraggableNote.ts
      placement.ts
      coordinateMath.ts
    quotes/
      quoteApi.ts
      quoteQueries.ts
      quoteTypes.ts
      QuoteComposer.tsx
      StickyNote.tsx
      StickyNoteMenu.tsx
  styles/
    globals.css
  test/
    mocks/
      atprotoHandlers.ts
docs/
  atproto-oauth.md
  lexicons.md
```

## Proposed AT Protocol Lexicons

Use the controlled domain `kzoeps.com` as the NSID authority. In AT Protocol NSID form this becomes `com.kzoeps`, so the sticky quote collections should live under `com.kzoeps.stickyquotes.*`.

### Quote record collection
- NSID: `com.kzoeps.stickyquotes.canvas.quote`
- Record key: `tid`
- Purpose: one sticky note quote per record.
- Identity: AT URI returned by `com.atproto.repo.createRecord`; store `uri`, `cid`, and parsed `rkey` in client state.

Fields:
- `$type`: `com.kzoeps.stickyquotes.canvas.quote`
- `schemaVersion`: integer, required, fixed initial value `1`
- `text`: string, required, `minGraphemes: 1`, `maxGraphemes: 2000`
- `author`: string, optional, `maxGraphemes: 200`
- `sourceTitle`: string, optional, `maxGraphemes: 300`
- `sourceUri`: string, optional, URI format, `maxLength: 2048`
- `position`: object, required
  - `x`: integer canvas world coordinate, required, recommended bounds `-1000000000` to `1000000000`
  - `y`: integer canvas world coordinate, required, recommended bounds `-1000000000` to `1000000000`
- `size`: object, optional for future resizing
  - `width`: integer, bounds `160` to `600`, default app value `240`
  - `height`: integer, bounds `120` to `500`, default app value `180`
- `rotationDegX100`: integer, required, bounds `-800` to `800`; render as `rotationDegX100 / 100` degrees
- `color`: string, required, known values `yellow`, `pink`, `blue`, `green`, `purple`, `orange`, `gray`
- `zIndex`: integer, optional, bounds `0` to `1000000`
- `createdAt`: string datetime, required
- `updatedAt`: string datetime, required

Notes:
- Use integer coordinates and fixed-point rotation instead of floats so validation is deterministic and portable across Lexicon tooling.
- Generate `rotationDegX100` once at creation time and persist it. Never generate rotation during render.
- Keep any stricter color or URL validation in local Zod validators as well as Lexicon constraints.

### Canvas settings record
- NSID: `com.kzoeps.stickyquotes.canvas.settings`
- Record key: `literal:self`
- Purpose: optional per-user canvas preferences and last viewport; do not store note IDs here because quote records are discoverable by collection listing.

Fields:
- `$type`: `com.kzoeps.stickyquotes.canvas.settings`
- `schemaVersion`: integer, required, fixed initial value `1`
- `defaultColor`: string, optional, same known values as quote `color`
- `lastViewport`: object, optional
  - `x`: integer world coordinate at viewport center
  - `y`: integer world coordinate at viewport center
  - `zoomX1000`: integer zoom multiplier, recommended bounds `200` to `3000`; render as `zoomX1000 / 1000`
- `updatedAt`: string datetime, required

## ATProto OAuth Architecture

1. Configure ATProto OAuth for both development and production.
   - Development: use the official OAuth loopback mode for local development.
   - Production: host public OAuth client metadata at `public/client-metadata.json` and configure the app's `client_id` to the final HTTPS metadata URL.
   - Include production redirect URI `/oauth/callback` once the production origin is known.
   - Use a public client with PKCE and no client secret.
   - Verify the current required scope string during implementation. Expect to need generic ATProto repo access, commonly `atproto` plus any current transition scope required by the official client.
2. `src/lib/atproto/oauthClient.ts` creates one browser OAuth client instance.
   - Accept a user-entered handle.
   - Starts authorization with PKCE/state.
   - Completes redirect handling in `/oauth/callback`.
3. `src/lib/atproto/sessionStore.ts` persists OAuth state and sessions.
   - Prefer the official browser storage adapter if provided.
   - Otherwise use IndexedDB, not memory-only storage, because OAuth redirect, refresh tokens, and DPoP key material must survive page reloads.
   - Store sessions keyed by DID and track the active DID separately.
4. `src/lib/atproto/agent.ts` creates an authenticated ATProto agent/session wrapper for XRPC calls.
   - Isolate exact package APIs here so OAuth client package changes do not leak into feature code.
5. Session concerns to handle explicitly:
   - Refresh tokens may rotate; persist updated session data after refresh.
   - DPoP key material must remain available for the session lifetime.
   - Clear TanStack Query cache on logout or account switch.
   - Add a refresh mutex to avoid concurrent refreshes from multiple queries.
   - Use `BroadcastChannel` or storage events so multi-tab logout/account switch stays consistent.
   - Browser-stored tokens are exposed to XSS risk; add a strict CSP, avoid unsafe HTML rendering, and never store user-entered quote text as HTML.

## Data Flow for Quote Records

### Read
1. After OAuth session restore, fetch all records from the user's repo with `com.atproto.repo.listRecords`:
   - `repo`: authenticated DID
   - `collection`: `com.kzoeps.stickyquotes.canvas.quote`
   - paginate until no cursor remains
2. Validate each record locally with `src/lib/atproto/validation.ts`.
3. Normalize records into app quote objects containing `uri`, `cid`, `rkey`, and record fields.
4. Sort client-side by `zIndex` then `createdAt`.

### Create
1. User submits `QuoteComposer`.
2. Compute a collision-free default position near the current viewport center.
3. Generate `rotationDegX100` once using `crypto.getRandomValues`, e.g. between `-500` and `500`, optionally avoiding the tiny range around zero so notes visibly tilt.
4. Build and locally validate the record.
5. Optimistically insert a temporary note into the TanStack Query cache.
6. Call `com.atproto.repo.createRecord` on the user's PDS.
7. Replace the temporary note with returned `uri` and `cid`.

### Update position / appearance / text
1. Keep the latest `cid` with every loaded quote.
2. During drag, update local UI state immediately but do not write on every pointer move.
3. On pointer up, persist the final integer world coordinates with `com.atproto.repo.putRecord`.
4. Use compare-and-swap via `swapRecord` when available, passing the last known `cid` to avoid overwriting remote changes.
5. On success, update cached `cid` and `updatedAt`.
6. On conflict, refetch the record, show a conflict notice, and either:
   - safely merge if only position changed locally and remote changed unrelated fields, or
   - keep the local note marked `unsaved` and ask the user to retry/overwrite.

### Delete
1. Optimistically remove the note from the cache.
2. Call `com.atproto.repo.deleteRecord` with collection and rkey, using `swapRecord` if available.
3. Roll back the cache if deletion fails.

### Settings
- Load `com.kzoeps.stickyquotes.canvas.settings` with rkey `self` if viewport persistence is desired.
- Write settings with `putRecord` on debounced viewport changes or app unload-safe checkpoints. Avoid writing continuously while panning/zooming.

## Infinite Canvas UI Architecture

1. Render notes as DOM elements inside a transformed world layer, not as a bitmap canvas.
   - Container: fixed viewport with overflow hidden.
   - World layer transform: `translate(screenX, screenY) scale(zoom)` with transform origin `0 0`.
   - Notes: absolutely positioned at world coordinates.
2. `useCanvasViewport.ts` owns viewport state:
   - pan offset
   - zoom
   - screen-to-world and world-to-screen conversion helpers
   - wheel zoom centered on pointer
   - background pointer drag for panning
   - min/max zoom bounds
3. `useDraggableNote.ts` owns sticky note dragging:
   - pointer capture on note drag handle or whole note
   - disable canvas panning while dragging a note
   - convert screen deltas to world deltas by dividing by zoom
   - update position optimistically in query cache on pointer move
   - persist final position on pointer up
4. Creation defaults:
   - note size default: `240x180`
   - candidate start: viewport center converted to world coordinates
   - spiral/grid search with `NOTE_GAP` to find the nearest unoccupied axis-aligned rectangle
   - ignore rotation for collision placement in v1; use unrotated bounds plus gap
5. Persistent random rotation:
   - generated only during create
   - stored as `rotationDegX100`
   - rendered with CSS transform `rotate(var(--rotation))`
6. Optimistic and error states:
   - new notes show `saving` until PDS returns `uri/cid`
   - moved notes show `unsaved` or retry affordance if update fails
   - failed creates roll back and restore form input
   - failed deletes roll back and show an error toast
7. Conflict handling:
   - use `swapRecord` when possible
   - refetch on conflict
   - prefer field-level merge for position-only local changes
   - avoid silent last-write-wins unless explicitly chosen

## TanStack Router and Query Usage

### Routes
- `/`: protected canvas route. Restores session and loads quotes.
- `/login`: handle input and OAuth start.
- `/oauth/callback`: completes OAuth redirect, restores session, redirects to `/`.

### Query keys
- `['auth', 'session']`: active OAuth session summary
- `['quotes', did]`: quote records for the active account
- `['canvasSettings', did]`: optional settings record

### Mutations
- `useCreateQuoteMutation`
- `useUpdateQuoteMutation`
- `useMoveQuoteMutation` or reuse update with a position-only input
- `useDeleteQuoteMutation`

Each mutation should use `onMutate` for optimistic cache updates, `onError` for rollback/error state, and `onSettled` or targeted invalidation to reconcile with the PDS.

## Tasks

1. **Confirm remaining app-level decisions before coding**
   - File: `docs/product-decisions.md`
   - Changes: Document chosen app root, `kzoeps.com`/`com.kzoeps` NSID authority, loopback OAuth development mode, production OAuth redirect URL once known, public-data privacy stance, one-canvas-per-user v1 scope, and create/edit/move/delete quote lifecycle.
   - Acceptance: No placeholder NSID remains; only the production redirect URI may remain marked as pending if deployment origin is not chosen yet.

2. **Scaffold the Vite + TanStack React app**
   - File: `package.json`, `vite.config.ts`, `tsconfig.json`, `src/main.tsx`, `src/routes/__root.tsx`, `src/routes/index.tsx`
   - Changes: Create React TypeScript app, add TanStack Router and Query providers, global CSS import, and devtools in development only.
   - Acceptance: App starts locally and renders a placeholder route.

3. **Add configuration constants**
   - File: `src/lib/config.ts`, `.env.example`
   - Changes: Define app origin, OAuth client metadata URL, NSID prefix, quote collection NSID, settings collection NSID, route paths, note size constants, zoom limits, and color palette.
   - Acceptance: App fails fast with a clear error if required public config is missing.

4. **Add lexicon source files and documentation**
   - File: `src/lib/atproto/lexicons/com.kzoeps.stickyquotes.canvas.quote.json`, `src/lib/atproto/lexicons/com.kzoeps.stickyquotes.canvas.settings.json`, `docs/lexicons.md`
   - Changes: Add quote and settings lexicons using the final NSID authority; document each field, validation constraint, and migration policy.
   - Acceptance: Lexicon IDs match `src/lib/config.ts`; docs explain integer coordinate and fixed-point rotation choices.

5. **Implement local record types and validation**
   - File: `src/features/quotes/quoteTypes.ts`, `src/lib/atproto/validation.ts`, `src/lib/atproto/nsids.ts`
   - Changes: Define app-level quote/settings types, AT record input/output types, Zod validators, and helpers for parsing `uri`/`rkey`.
   - Acceptance: Invalid records produce errors that say what field failed and how to fix it.

6. **Implement browser OAuth metadata and client setup**
   - File: `public/client-metadata.json`, `src/lib/atproto/oauthClient.ts`, `src/lib/atproto/sessionStore.ts`, `docs/atproto-oauth.md`
   - Changes: Add loopback OAuth setup for local development, production public client metadata path, OAuth start/complete/restore/logout helpers, persistent session storage, active DID tracking, and OAuth docs.
   - Acceptance: A user can start login with a handle, return from `/oauth/callback`, reload the page, and remain logged in.

7. **Add authenticated ATProto agent wrapper**
   - File: `src/lib/atproto/agent.ts`
   - Changes: Create a small wrapper that exposes authenticated XRPC calls for repo list/create/put/delete and hides package-specific OAuth session APIs.
   - Acceptance: Feature code does not import OAuth client internals directly.

8. **Implement quote repository API**
   - File: `src/features/quotes/quoteApi.ts`, `src/lib/atproto/records.ts`
   - Changes: Add functions for listing all quote records, creating a quote, updating a quote with optional `swapRecord`, deleting a quote, and reading/writing settings.
   - Acceptance: API functions accept typed inputs, return normalized records with `uri/cid/rkey`, and surface PDS errors with actionable messages.

9. **Wire TanStack Query hooks**
   - File: `src/features/quotes/quoteQueries.ts`, `src/features/auth/authQueries.ts`
   - Changes: Add session query, quotes query, settings query, and create/update/move/delete mutations with optimistic updates and rollback.
   - Acceptance: Query cache is scoped by DID and clears on logout/account switch.

10. **Build the protected route and auth UI**
    - File: `src/routes/login.tsx`, `src/routes/oauth.callback.tsx`, `src/features/auth/AuthProvider.tsx`, `src/features/auth/LoginForm.tsx`
    - Changes: Add handle login form, callback completion route, logout action, protected route behavior, loading and error states.
    - Acceptance: Unauthenticated users land on login; authenticated users land on the canvas.

11. **Build infinite canvas viewport mechanics**
    - File: `src/features/canvas/CanvasPage.tsx`, `src/features/canvas/InfiniteCanvas.tsx`, `src/features/canvas/useCanvasViewport.ts`, `src/features/canvas/coordinateMath.ts`
    - Changes: Implement world/screen coordinate conversion, panning, wheel zoom, bounds for zoom, and empty canvas background.
    - Acceptance: Pan and zoom work smoothly without changing quote world coordinates.

12. **Build sticky note rendering, composer, edit, and delete UI**
    - File: `src/features/quotes/StickyNote.tsx`, `src/features/quotes/QuoteComposer.tsx`, `src/features/quotes/StickyNoteMenu.tsx`, `src/styles/globals.css`
    - Changes: Render quote text, author/source, color, persistent rotation, saving/error badges, add quote form, edit affordance, and delete affordance.
    - Acceptance: Created notes render with stable tilt after reload; edited text persists after reload; deleted notes stay deleted after reload.

13. **Implement collision-free placement**
    - File: `src/features/canvas/placement.ts`
    - Changes: Add nearest-free-position helper using viewport center, default note dimensions, existing note bounds, and spiral grid search.
    - Acceptance: Adding multiple notes in the same viewport does not stack them directly on top of each other.

14. **Implement note dragging and persistent movement**
    - File: `src/features/canvas/useDraggableNote.ts`, `src/features/canvas/InfiniteCanvas.tsx`, `src/features/quotes/quoteQueries.ts`
    - Changes: Add pointer-based dragging, update local position during drag, persist final position on pointer up, debounce/retry failed saves.
    - Acceptance: Move a note, reload the app, and the note appears in the same world position.

15. **Implement conflict and error handling polish**
    - File: `src/features/quotes/quoteQueries.ts`, `src/features/quotes/StickyNote.tsx`, `src/lib/atproto/records.ts`
    - Changes: Add conflict detection, stale CID refetch, retry actions, rollback paths, and clear user-facing error messages.
    - Acceptance: Simulated PDS failures and stale CIDs do not silently lose local changes.

16. **Add tests**
    - File: `src/features/canvas/*.test.ts`, `src/features/quotes/*.test.tsx`, `src/lib/atproto/*.test.ts`, `src/test/mocks/atprotoHandlers.ts`, `playwright.config.ts`
    - Changes: Add unit tests for coordinate math, placement, validation, record normalization, and optimistic mutation behavior; add component tests for rendering and dragging; add e2e smoke tests with mocked ATProto endpoints.
    - Acceptance: Test suite covers create/read/update/delete and persistence of rotation/position.

17. **Add developer documentation**
    - File: `README.md`, `docs/atproto-oauth.md`, `docs/lexicons.md`
    - Changes: Document setup, required env vars, OAuth redirect configuration, PDS data model, known privacy limitations, and local test workflow.
    - Acceptance: A new developer can run the app and understand where quote records are stored without reading source code.

## Files to Modify

- `package.json` - add scripts and runtime/test dependencies.
- `vite.config.ts` - configure React, TanStack Router plugin if used, and test environment.
- `tsconfig.json` - ensure strict TypeScript settings and path aliases if desired.
- `.env.example` - document public config values.
- `README.md` - setup and development instructions.
- `src/main.tsx` - mount React app with Router and Query providers.
- `src/styles/globals.css` - canvas and sticky note styles.

## New Files

- `public/client-metadata.json` - ATProto OAuth public client metadata.
- `src/routes/__root.tsx` - root route shell and providers.
- `src/routes/index.tsx` - protected canvas route.
- `src/routes/login.tsx` - login route.
- `src/routes/oauth.callback.tsx` - OAuth callback route.
- `src/lib/config.ts` - app constants and public config validation.
- `src/lib/atproto/oauthClient.ts` - browser OAuth client setup.
- `src/lib/atproto/sessionStore.ts` - persistent OAuth session storage.
- `src/lib/atproto/agent.ts` - authenticated ATProto agent wrapper.
- `src/lib/atproto/nsids.ts` - collection NSID constants.
- `src/lib/atproto/records.ts` - low-level repo record helpers.
- `src/lib/atproto/validation.ts` - record validation and error formatting.
- `src/lib/atproto/lexicons/com.kzoeps.stickyquotes.canvas.quote.json` - quote lexicon.
- `src/lib/atproto/lexicons/com.kzoeps.stickyquotes.canvas.settings.json` - settings lexicon.
- `src/features/auth/AuthProvider.tsx` - active session context.
- `src/features/auth/authQueries.ts` - session query helpers.
- `src/features/auth/LoginForm.tsx` - handle input and login UI.
- `src/features/canvas/CanvasPage.tsx` - page-level canvas composition.
- `src/features/canvas/InfiniteCanvas.tsx` - viewport and note world layer.
- `src/features/canvas/useCanvasViewport.ts` - pan/zoom state and pointer handlers.
- `src/features/canvas/useDraggableNote.ts` - note drag state and persistence trigger.
- `src/features/canvas/coordinateMath.ts` - world/screen math utilities.
- `src/features/canvas/placement.ts` - collision-free default placement.
- `src/features/quotes/quoteApi.ts` - quote CRUD calls.
- `src/features/quotes/quoteQueries.ts` - quote query and mutation hooks.
- `src/features/quotes/quoteTypes.ts` - domain types.
- `src/features/quotes/QuoteComposer.tsx` - add quote UI.
- `src/features/quotes/StickyNote.tsx` - note rendering.
- `src/features/quotes/StickyNoteMenu.tsx` - edit/delete actions.
- `src/test/mocks/atprotoHandlers.ts` - MSW handlers for ATProto XRPC mocks.
- `docs/product-decisions.md` - implementation decisions captured before coding.
- `docs/atproto-oauth.md` - OAuth setup and session persistence docs.
- `docs/lexicons.md` - lexicon schema and migration docs.

## Dependencies

- Task 1 must happen before lexicon and OAuth implementation because NSID authority and redirect URLs affect stored data and auth metadata.
- Task 2 must happen before most source files can be added.
- Tasks 3-5 define constants, lexicons, and types needed by API/query/UI work.
- Tasks 6-7 must complete before real PDS CRUD can be tested.
- Task 8 depends on Tasks 4-7.
- Task 9 depends on Task 8.
- Tasks 11-13 can be developed with fixtures after Task 2, but final wiring depends on Task 9.
- Task 14 depends on Tasks 9, 11, and 12.
- Task 15 depends on real mutation flows from Tasks 8-14.
- Task 16 should start with unit tests for Tasks 5, 11, and 13, then expand as features land.
- Task 17 should be updated throughout and finalized after OAuth/lexicon behavior is verified.

## Validation/Test Plan

- Unit test record validators with valid records, missing required fields, invalid colors, overlong text, out-of-bounds positions, and invalid rotation.
- Unit test coordinate conversion round-trips across pan/zoom values.
- Unit test collision-free placement with empty canvas, dense clusters, negative coordinates, and varied note sizes.
- Unit test random rotation generation to ensure it stays in bounds and is assigned only on create.
- Mock XRPC with MSW for list/create/put/delete records, paginated reads, stale CID conflicts, and network failures.
- Component test sticky note rendering for text, metadata, color, rotation, saving, and error states.
- Component test drag behavior using pointer events and verify final mutation input uses world coordinates.
- Integration test query cache optimistic create, move, delete, rollback, and DID scoping.
- Playwright smoke test: login with mocked OAuth, create a quote, reload, move it, reload again, delete it.
- Manual test against a real dev PDS before release: OAuth login, create, reload, move, reload, logout, login again.

## Risks

- Standard ATProto repo records are public; this is accepted for v1. The UI and docs must still make the public-data privacy stance explicit before users create quotes.
- Browser OAuth token storage has XSS risk. CSP and safe rendering are required because quote text is user-provided.
- The exact OAuth browser package/export and required scopes may change; isolate them in `src/lib/atproto/*` and verify against current ATProto docs during implementation.
- Custom lexicon validation behavior on PDS instances may vary. Always validate locally; verify whether `validate: true` is accepted for the custom collection or whether custom records need local validation plus relaxed server validation.
- Writing on every drag event can hit rate limits or create conflicts. Persist only on pointer up or with conservative debouncing.
- Multi-tab sessions can race refreshes or overwrite active account state without a refresh mutex and tab coordination.
- NSID authority is hard to change after users have records. Confirm the domain before any real user data is written.
- Integer world coordinates simplify validation but require rounding from UI drag math; verify rounding does not make movement feel jumpy at high zoom.

## Remaining Open Questions

1. What production origin and redirect URL should OAuth metadata use? Development uses loopback mode.
2. Should colors be limited to a fixed palette, or should custom colors be allowed with app-side validation?
3. Should the app persist last viewport in the PDS settings record, local storage, or not at all?
4. What maximum quote length is acceptable for the product: 500, 1000, 2000, or more graphemes?
5. Should the app live at the repository root or in a subdirectory such as `apps/web`?
