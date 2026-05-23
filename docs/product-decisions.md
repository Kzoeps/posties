# Product Decisions: ATProto Sticky Quote Canvas

Date: 2026-05-21

## Confirmed

- **App location:** repository root.
- **NSID authority:** use `kzoeps.com`, represented in AT Protocol NSIDs as `com.kzoeps`.
- **Quote collection:** `com.kzoeps.stickyquotes.canvas.quote`.
- **Settings collection:** `com.kzoeps.stickyquotes.canvas.settings`.
- **Canvas model:** v1 has one infinite canvas per user. Do not add `boardId` or multi-board support yet.
- **Privacy stance:** all quote and settings records are public PDS data. The app must warn users before they create quotes.
- **Development OAuth:** use ATProto OAuth loopback mode for local development.
- **Production OAuth:** production origin and hosted client metadata are still pending. Do not treat `https://kzoeps.com` placeholders as release-ready until deployment is confirmed.
- **Quote lifecycle:** v1 supports creating, editing, moving, and deleting quotes.
- **Colors:** v1 uses the fixed palette from the lexicon: `yellow`, `pink`, `blue`, `green`, `purple`, `orange`, `gray`.
- **Maximum quote length:** quote text is limited to 2000 graphemes.
- **Viewport settings:** the settings lexicon supports `defaultColor` and `lastViewport`; current UI persistence focuses on quote records and does not yet restore viewport position from the settings record.
- **Shareable public pages:** public notes pages use `/:handle` URLs, for example `/kzoeps.com` or `/dorji.bsky.social`.
- **Handle/DID split:** handles are URL-facing and mutable; records are stored, queried, and cached by stable owner DID. Do not add handle fields to quote or settings records.
- **Home route:** signed-out `/` is a landing page. Signed-in `/` resolves the active DID to the current handle and redirects to `/:handle`.
- **Canonicalization:** public handle pages normalize casing/leading `@`, then canonicalize to the owner DID document's current handle when it differs.
- **Ownership UI:** public pages are readable by everyone, but Add/Edit/Delete/drag/retry controls render only when the active OAuth DID equals the page owner DID.
- **Public toolbar:** `/:handle` shows the owner handle and owner DID, with a copy-share-link button next to the identity/share area.

## Known limitations

- Public PDS records are not private storage. Do not save secrets, private notes, or sensitive personal data.
- Stale handle URLs can be canonicalized only if the old handle still resolves to the same DID. A future server-side alias/history table would be required for durable old-handle links after reassignment or failed resolution.
- Browser OAuth token and DPoP key material are readable by app JavaScript; production needs a strict CSP and continued avoidance of unsafe HTML rendering.
- Custom lexicon enforcement can vary by PDS. The app validates locally and uses relaxed PDS validation by default.
- `pnpm build` currently emits a Vite large chunk warning. Follow-up: route/code split ATProto and mock/test-only modules.
