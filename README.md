# ETH Pending Monitor

Ethereum pending-transaction dashboard with an optional 24/7 Railway backend.

- `docs/` contains the GitHub Pages dashboard.
- `server/` contains the Node.js monitoring service.
- PostgreSQL stores server settings, transaction state, notification history, and Web Push subscriptions.

## Railway deployment

1. Create a Railway project and add PostgreSQL.
2. Deploy this GitHub repository as a service.
3. Add these service variables:

   - `DATABASE_URL` — reference `Postgres.DATABASE_URL` from the PostgreSQL service.
   - `ALCHEMY_WSS_URL` — the Ethereum Mainnet Alchemy WebSocket URL.
   - `ADMIN_TOKEN` — a random value containing at least 24 characters.
   - `FRONTEND_ORIGIN` — `https://krymovmanual.github.io`.
   - `ETHERSCAN_API_KEY` and `CRYPTOCOMPARE_API_KEY` — optional during the first deployment.

4. Generate a public Railway domain and confirm that `/health` returns `"status":"ok"`.
5. In the dashboard's **Connection settings**, enter the Railway URL and the same `ADMIN_TOKEN`, then save.

Email alerts use Resend when `RESEND_API_KEY` and `EMAIL_FROM` are configured. Without Resend, the service uses the already activated FormSubmit recipient. Web Push requires `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`.

The existing browser monitor remains available as a fallback while the backend is being configured.

See [docs/README.md](docs/README.md) for the dashboard feature list and GitHub Pages instructions.
