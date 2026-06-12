# Testing and Validation

This project has three validation layers: Vitest unit/component tests, mocked Playwright smoke tests, and manual real-PDS validation.

## Commands

```bash
pnpm test
pnpm test:e2e:list
pnpm test:e2e
pnpm build
```

If Playwright cannot find Chromium, install it with:

```bash
pnpm exec playwright install chromium
```

## Unit, component, and integration tests

`pnpm test` runs Vitest in jsdom. Current coverage includes:

- record validation and actionable validation errors
- coordinate conversion math
- collision-free placement
- sticky note rendering and edit/delete affordances
- owner vs signed-out/non-owner canvas controls
- handle normalization, reserved route rejection, canonical identity resolution, and DID document parsing
- draggable-note world-coordinate persistence behavior
- query mutation behavior with the deterministic ATProto mock
- mock PDS handlers for list/create/put/delete/settings flows and public signed-out reads

## Mocked Playwright e2e mode

`pnpm test:e2e` uses `playwright.config.ts`, which starts Vite with:

```env
VITE_E2E_ATPROTO_MOCK=true
VITE_PUBLIC_APP_ORIGIN=http://127.0.0.1:4173
VITE_PUBLIC_OAUTH_CLIENT_METADATA_URL=http://127.0.0.1:4173/client-metadata.json
```

The app also supports a browser runtime flag used by the e2e tests:

```ts
window.__ATPROTO_STICKY_CANVAS_E2E_MOCK__ = true
```

The mock boundary lives in `src/test/mocks/atprotoHandlers.ts` and persists deterministic OAuth/PDS state in browser storage while tests run. It exercises the app through the same UI routes and quote/query code paths, but swaps real OAuth/PDS network calls for local deterministic behavior.

### What mocked e2e proves

- Signed-out `/` is a landing page.
- Signed-out users can open public `/:handle` pages, rearrange notes locally, and remain read-only from the PDS perspective.
- Non-canonical handle URLs redirect to the DID document's current handle.
- The user can sign in through the app's OAuth UI path when the mock boundary is enabled and lands on their handle page.
- The copy-share-link button works in the browser UI.
- The canvas can create, reload, move, reload again, edit, and delete a quote on the owner page.
- Signed-in non-owners can rearrange notes locally but remain unable to write another user's page.
- Persistent rotation and world coordinates survive reloads in the app state model.
- A mocked create failure leaves the composer recoverable.

### What mocked e2e does not prove

- A real handle resolves through a real public identity resolver.
- A real DID document exposes the expected `at://<handle>` alias and `#atproto_pds` endpoint.
- A real PDS accepts or returns custom records for this app.
- Production `client_id`, client metadata hosting, and redirect URIs are configured correctly.
- DNS and HTTPS for `posties.kzoeps.com` are deployed.
- Browser storage survives every production privacy mode or enterprise policy.

## Manual real-PDS checklist

Run this before release or after changing OAuth/PDS code. Use a test account and non-sensitive quotes because records are public.

1. Start the app on a loopback origin:

   ```bash
   pnpm dev --host 127.0.0.1
   ```

2. Open `http://127.0.0.1:5173` while signed out and confirm the landing page appears.
3. Open `http://127.0.0.1:5173/<handle>` while signed out and confirm public records load without OAuth, no Add/Edit/Delete controls appear, and local note rearranging does not write to the PDS.
4. Log in with a real ATProto handle.
5. Confirm `/` redirects to the canonical handle page and the toolbar shows the owner handle, owner DID, public-data warning, and copy-share-link button.
6. Create a quote.
7. Reload the page and confirm the quote still appears with the same rotation.
8. Move the quote to a visibly different canvas position.
9. Reload the page and confirm the moved position persisted.
10. Edit the quote text, author, source, or color.
11. Reload the page and confirm the edit persisted.
12. Delete the quote.
13. Reload the page and confirm the quote stays deleted.
14. Log out and reopen the handle page; confirm public read-only behavior still works while local note rearranging remains possible.
15. Log in as a different account and open the first account's handle page; confirm local note rearranging works but does not persist or expose write controls.
16. Optional: inspect the test account repo with AT Protocol tooling and verify records are under:

    ```text
    com.kzoeps.stickyquotes.canvas.quote
    com.kzoeps.stickyquotes.canvas.settings
    ```

## Build warning

`pnpm build` currently passes but can warn that the main chunk is larger than 500 kB. This is expected for the current MVP bundle. The likely follow-up is route/code splitting so ATProto and mock/test-only modules do not inflate the initial app chunk.
