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

4. Generate a public Railway domain and confirm that `/health` returns `"status":"ok"`.
5. In the dashboard's **Connection settings**, enter the Railway URL and the same `ADMIN_TOKEN`, then save.

Email alerts use Resend when `RESEND_API_KEY` and `EMAIL_FROM` are configured. Without Resend, the service uses the already activated FormSubmit recipient. Web Push requires `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`.

The browser talks to Railway for Etherscan diagnostics and CryptoCompare news, so those provider keys are never exposed in GitHub Pages or browser storage. Both integrations require the Railway backend.

Gas Analytics uses an independent Alchemy connection on Railway to sample every Ethereum block. It stores one aggregated row per minute, keeps 30 days, and removes older rows automatically. A Gas Analytics failure does not stop pending-transaction monitoring.

See [docs/README.md](docs/README.md) for the dashboard feature list and GitHub Pages instructions.
