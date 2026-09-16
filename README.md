# Treasury Operations Center — v21.1

Start with [USERS-v11.md](USERS-v11.md). It supersedes the deployment instructions below for authentication, hosting and credentials.

## v21.1 — UI stability & self-hosted fonts

DM Sans and IBM Plex Mono are now served by Paseqa itself, so the strict CSP no longer blocks typography or sends browser requests to Google Fonts. The Wallets transaction table keeps a stable header, row height and column geometry. Relative ages update in place; unchanged transaction rows are no longer recreated every second. No new Railway variables or database migration are required. See [V21.1-UI-STABILITY.md](V21.1-UI-STABILITY.md).

## v21 — BTC UTXO Intelligence & Passkeys

Bitcoin monitoring now identifies low-fee consolidation windows, keeps a compact 30-day fee baseline, counts dust outputs, estimates consolidation cost and forecasts the inputs, vbytes and fee for the next expected payout. A dedicated alert rule can notify the configured Telegram group without repeating more often than its selected cadence. Passkeys add phishing-resistant WebAuthn registration, login and credential management while private keys remain on the user's device. See [V21-BTC-PASSKEYS.md](V21-BTC-PASSKEYS.md).

## v20.1 — Ethereum Queue Recovery

Railway now persists compact unresolved nonce slots, including transactions whose hashes are not exposed by the connected provider. After a boosted blocker confirms, the next nonce automatically becomes the visible blocker and can trigger a fresh Telegram, email or browser alert. The API and Wallets table merge nonce-only placeholders with full transaction records without duplicating rows. See [QUEUE-RECOVERY-v20.1.md](QUEUE-RECOVERY-v20.1.md).

## v20 — Organizations & Roles

Company workspaces now support `owner`, `admin`, `operator` and `viewer` roles, email invitations, workspace switching and a dedicated organization audit trail. Wallets, alerts, transactions and encrypted exchange connections are shared through the active organization while authorization is enforced on Railway. Existing users are migrated automatically and no new environment variables are required. See [ORGANIZATIONS-v20.md](ORGANIZATIONS-v20.md).

# Treasury Operations Center

Digital asset operations dashboard for wallets, transactions, gas, and market monitoring, with an optional 24/7 Railway backend. The repository and deployment URLs retain the `ETH-Pending-Monitor` name.

- `docs/` contains the GitHub Pages dashboard.
- `server/` contains the Node.js monitoring service.
- PostgreSQL stores server settings, transaction state, notification history, Web Push subscriptions, and compact one-minute Gas Analytics summaries.

The interface is split into focused workspaces: **Overview** for operational KPIs and alerts, **Wallets** for on-chain balances and transactions, **Exchanges** for CEX assets and positions, **Transfers** for validated drafts, **Networks** for network health, fee planning and gas analytics, and **Market** for news. Overview refreshes only the compact data required for decision-making; detailed tables remain on their own pages.

## Railway deployment

1. Create a Railway project and add PostgreSQL.
2. Deploy this GitHub repository as a service.
3. Add these service variables:

   - `DATABASE_URL` — reference `Postgres.DATABASE_URL` from the PostgreSQL service.
   - `ALCHEMY_WSS_URL` — the Ethereum Mainnet Alchemy WebSocket URL.
   - `SOLANA_RPC_URL` — the Solana Mainnet Alchemy HTTPS RPC URL used for watch-only balances, SOL Gas Station and network health.
   - `BITCOIN_RPC_URL` — the Bitcoin Mainnet Alchemy HTTPS RPC URL used for chain, mempool and fee health.
   - `BITCOIN_INDEXER_URL` — an Esplora-compatible API used for address UTXOs; defaults to `https://mempool.space/api`.
   - `ADMIN_TOKEN` — a random value containing at least 24 characters.
   - `FRONTEND_ORIGIN` — `https://krymovmanual.github.io`.
   - `ETHERSCAN_API_KEY` — enables server-side pending-nonce cross-checks.
   - `CRYPTOCOMPARE_API_KEY` — enables authenticated server-side crypto news requests.
   - `BITGET_API_KEY` — read-only Bitget Unified Account API key.
   - `BITGET_API_SECRET` — secret for signing Bitget requests.
   - `BITGET_API_PASSPHRASE` — passphrase created with the Bitget API key.

4. Generate a public Railway domain and confirm that `/health` returns `"status":"ok"`.
5. In the dashboard's **Connection settings**, enter the Railway URL and the same `ADMIN_TOKEN`, then save.

Email alerts use Resend when `RESEND_API_KEY` and `EMAIL_FROM` are configured. Without Resend, the service uses the already activated FormSubmit recipient. Web Push requires `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`.

Telegram alerts require one Railway secret, `TELEGRAM_BOT_TOKEN`, created with `@BotFather`. Each user stores their own numeric group chat ID in **Notification settings**; the platform bot token is never returned to the browser. Pending and nonce-blocker Telegram alerts are enabled by default once a group is configured, use the existing 15-minute threshold, recheck the transaction on-chain before delivery, and share the PostgreSQL repeat/deduplication policy with email and Web Push.

The browser talks to Railway for Etherscan diagnostics and CryptoCompare news, so those provider keys are never exposed in GitHub Pages or browser storage. Both integrations require the Railway backend.

Gas Analytics uses an independent Alchemy connection on Railway to sample every Ethereum block. It stores one aggregated row per minute, keeps 30 days, and removes older rows automatically. A Gas Analytics failure does not stop pending-transaction monitoring.

Solana support is server-only and optional. When `SOLANA_RPC_URL` is configured, each user can save public Solana addresses, view SOL and SPL token balances, configure an independent SOL Gas Station reserve, and inspect Solana RPC health and priority fees. See [SOLANA-v16.md](SOLANA-v16.md).

Low SOL reserves now have a dedicated `solanaGasLow` alert rule, separate from Ethereum. Browser, email, Telegram, repeat cadence, and quiet-hours bypass can be configured independently, while Railway checks both Gas Stations continuously even when the dashboard is closed. See [SOLANA-GAS-ALERT-v19.md](SOLANA-GAS-ALERT-v19.md).

Bitcoin support is watch-only. Each user can save up to 25 public mainnet addresses, view BTC balances and UTXO fragmentation, estimate consolidation cost and the next payout fee, and inspect chain synchronization, mempool and fee targets. The Networks workspace defaults to Ethereum and switches cleanly between Ethereum, Solana and Bitcoin without stacking all analytics on one page. See [BITCOIN-v17.md](BITCOIN-v17.md) and [V21-BTC-PASSKEYS.md](V21-BTC-PASSKEYS.md).

The Railway monitor also scans confirmed Ethereum blocks and stores a persistent block checkpoint. The browser merges `/api/transactions` into its local cache every 15 seconds, so transactions observed while the page was closed or missed by the browser WebSocket still appear after reopening the dashboard.

The Exchange Accounts panel reads Bitget Unified and Funding balances plus open USDT-M, USDC-M, and Coin-M futures positions. Create a dedicated Bitget key with read permissions only; do not enable trading, transfers, or withdrawals. Results are cached on Railway for 20 seconds and refreshed by the dashboard every 30 seconds.

`docs/exchanges.html` is the dedicated multi-exchange workspace. Railway exposes a normalized account model at `/api/exchanges/accounts`, so future Binance, Bybit, OKX, and other connectors can use the same interface. The page supports an exchange/account tree, multi-selection, consolidated or per-account assets, and consolidated exposure or detailed open positions. Automatic refresh is deferred while the user is actively scrolling or interacting with the tables.

`docs/transfers.html` is a draft-only transfer workspace. It combines Bitget Unified/Funding balances with monitored, watch-only, and MetaMask Ethereum wallets; supports Internal and External transfer plans; validates amount, balance, destination, asset, network, and MetaMask chain; and can estimate Ethereum gas through Railway. Drafts remain in local browser storage. This version never signs or sends a transaction and does not require Bitget transfer or withdrawal permissions.

See [docs/README.md](docs/README.md) for the dashboard feature list and GitHub Pages instructions.
