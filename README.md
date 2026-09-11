# Treasury Operations Center

Digital asset operations dashboard for wallets, transactions, gas, and market monitoring, with an optional 24/7 Railway backend. The repository and deployment URLs retain the `ETH-Pending-Monitor` name.

- `docs/` contains the GitHub Pages dashboard.
- `server/` contains the Node.js monitoring service.
- PostgreSQL stores server settings, transaction state, notification history, Web Push subscriptions, and compact one-minute Gas Analytics summaries.

## Railway deployment

1. Create a Railway project and add PostgreSQL.
2. Deploy this GitHub repository as a service.
3. Add these service variables:

   - `DATABASE_URL` — reference `Postgres.DATABASE_URL` from the PostgreSQL service.
   - `ALCHEMY_WSS_URL` — the Ethereum Mainnet Alchemy WebSocket URL.
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

The browser talks to Railway for Etherscan diagnostics and CryptoCompare news, so those provider keys are never exposed in GitHub Pages or browser storage. Both integrations require the Railway backend.

Gas Analytics uses an independent Alchemy connection on Railway to sample every Ethereum block. It stores one aggregated row per minute, keeps 30 days, and removes older rows automatically. A Gas Analytics failure does not stop pending-transaction monitoring.

The Exchange Accounts panel reads Bitget Unified and Funding balances plus open USDT-M, USDC-M, and Coin-M futures positions. Create a dedicated Bitget key with read permissions only; do not enable trading, transfers, or withdrawals. Results are cached on Railway for 20 seconds and refreshed by the dashboard every 30 seconds.

`docs/exchanges.html` is the dedicated multi-exchange workspace. Railway exposes a normalized account model at `/api/exchanges/accounts`, so future Binance, Bybit, OKX, and other connectors can use the same interface. The page supports an exchange/account tree, multi-selection, consolidated or per-account assets, and consolidated exposure or detailed open positions. Automatic refresh is deferred while the user is actively scrolling or interacting with the tables.

See [docs/README.md](docs/README.md) for the dashboard feature list and GitHub Pages instructions.
