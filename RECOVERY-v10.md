# Recovery v10 — 12 September 2026

## Changes

- Restored authenticated Railway Alchemy RPC for wallet balances, gas and nonce checks. The browser no longer requires or opens an Alchemy connection. Existing provider URL is removed from local storage; Railway variables remain authoritative.
- Transaction polling reports the server's subscription and scan state. A successful HTTP response alone is no longer displayed as a live Alchemy stream.
- Added startup failure notice and a synchronization diagnostic panel. Null object caches and malformed address/transaction entries no longer abort initialization.
- Scanner retains its checkpoint when a block or receipt is unavailable, and commits its checkpoint before advancing in memory. Integer nonces survive repeated normalization.
- Added WebSocket ping/pong watchdog. Long initial scans no longer block HTTP server startup.
- Clear history clears the local cache only. Server records return on synchronization; the broad DELETE endpoint was removed.
- Exchange table scroll offsets are restored after rendering.

## Verification

`npm run check` checks application and backend syntax. `npm test` runs eight regression tests with a mocked DOM/RPC and isolated monitor calls. These tests do not validate real DOM layout or live provider connectivity.

A Chromium download timed out in this workspace, so full browser testing was not completed. No deployment, authenticated Railway call, real PostgreSQL integration test, or real Bitget request was performed. The exact cause of the user's screenshot is not conclusively established: null persisted objects can reproduce a startup failure, and the browser Alchemy dependency was a confirmed regression.

## Installation

1. Update the existing repository with the archive contents, including `docs/boot.js`, both `docs` and `server` changes. Do not upload `node_modules` or secrets.
2. Deploy the backend and GitHub Pages from the same revision. Existing Railway variables are used; no new keys are required.
3. Reload the frontend. If this browser has no connection settings, enter its Railway URL and existing ADMIN_TOKEN in Connection settings. Never paste keys into chat.
4. Wallets → Synchronization should show a recent successful sync, two acknowledged subscriptions, and an advancing scanned block. Confirm a known recent transaction appears; an empty mempool alone does not demonstrate a fault.
5. If startup fails, the notice requests the first browser Console error. Hide credentials before sharing it.

## Remaining work

This is a recovery patch, not a complete production audit. Historical backfill currently resumes an existing checkpoint; a new database begins with a limited recent-block window. Arbitrary contract-internal token transfers and chain reorganizations require a dedicated event-log/reconciliation design. There is no guarantee of complete historical recovery in this release. Existing exchange and transfer integrations still need live acceptance testing.
