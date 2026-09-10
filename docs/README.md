# Treasury Operations Center

Digital asset operations dashboard. The current network module monitors live pending transactions for one or more Ethereum addresses.

## Features

- Monitor up to 50 Ethereum addresses from one dashboard.
- Scan Alchemy's pending-block snapshot immediately after connection and on demand, including incoming transactions that existed before the page opened. A lighter outgoing-nonce reconciliation then runs every minute.
- Cross-check every monitored wallet's pending nonce with Etherscan through Railway once per minute. Server requests are sent in groups of three to respect the free API rate limit.
- Show an `Etherscan detects additional pending transactions` warning and a direct link to the affected wallet's Etherscan pending page when Etherscan sees a higher pending nonce than Alchemy.
- Show a visible warning when Alchemy reports a pending nonce gap but does not expose the missing transaction hashes in its mempool.
- Browser and optional email alerts for long-pending transactions, blocked nonce queues, dropped/replaced transactions, and low Gas Station balance.
- Every alert rule has its own enable switch, Browser/Email channels, delay where applicable, repeat interval where applicable, and urgent quiet-hours override.
- Long-pending transactions are grouped into one wallet summary instead of sending a separate message for every transaction.
- Gas boost analysis starts only after the configured Pending threshold. Emails show the full actionable TX hash first, followed by nonce, fee, network gas, and queue details.
- Urgent queue alerts identify the blocking TX hash, nonce, and number of transactions behind it. Immediately before delivery, the monitor rechecks receipts and current transaction state for both the blocker and the higher-nonce transactions; if either side of the queue is no longer pending, no urgent alert is sent.
- `Needs boost` indicator when the transaction max fee is below the current network gas price returned by Alchemy.
- Copy the full transaction hash directly from the table while keeping the Etherscan link.
- Click any transaction row to inspect full From/To addresses, contract, method, fee data, nonce, queue state, and replacement hash.
- Search by transaction hash, nonce, wallet name/address, or token.
- Sort by status, age, amount, nonce, or max fee; the table header stays visible while scrolling.
- Paginate long transaction history with 25, 50, or 100 rows per page.
- Add an optional wallet name using `Wallet name | 0x address`; names appear in the dashboard and alert emails.
- Detect nonce queues and highlight the transaction that is blocking later transactions from the same monitored wallet.
- Identify standard ERC-20 `transfer` and `transferFrom` transactions, including token symbol, name, contract, and token amount.
- Display balances for ETH, USDT ERC-20, USDC, LINK, DAI and USDS across all monitored wallets.
- Configure wallet balance refresh separately: 5, 15 or 30 minutes; 1 or 6 hours; or manual only.
- Configure a dedicated Gas Station address, minimum ETH threshold, independent refresh interval, and low-balance browser/email alerts.
- Show the Gas Station ETH balance change since the previous refresh.
- Show live Gas Analytics on every Ethereum block: base fee, low/standard/fast totals, per-block change, spike detection, and a history-based Send now / Normal / Better wait recommendation.
- Store only one min/average/median/max Gas Analytics summary per minute in PostgreSQL, retain 30 days, and automatically remove older samples.
- Display a rolling 24-hour gas table and weekday/hour heatmap. Recommendations start after 60 stored minutes and gain confidence as history grows.
- Display an English crypto news feed with Ethereum, Bitcoin, market, and regulation filters. Railway caches CryptoCompare responses for 15 minutes, and the last successful result is also cached in the browser.
- Move the eight latest news cards into denser left/right rails on screens at least 1,800 px wide, with summaries, tags, article links, and independent scrolling; keep the central responsive feed on laptops and phones.
- Keep the Etherscan and CryptoCompare API keys exclusively in Railway environment variables.
- Local browser storage for the Alchemy URL, addresses, alert email, and transaction history.
- Optional Railway backend for continuous monitoring, PostgreSQL transaction state, server-side email alerts, and Web Push while the dashboard is closed.

## Publishing with Visual Studio

1. Extract the archive and open the `ETH-Pending-Monitor` folder in Visual Studio.
2. Open **Git → Create Git Repository**.
3. Select GitHub, enter a repository name, and choose **Public**.
4. Click **Create and Push**.
5. Open the new repository on GitHub.
6. Go to **Settings → Pages**.
7. Under **Build and deployment**, select **Deploy from a branch**.
8. Select the `master` branch and `/docs` folder, then click **Save**.

After publishing, open the GitHub Pages URL and click **Connection settings**:

1. Enter the Alchemy WebSocket URL in this format:

`wss://eth-mainnet.g.alchemy.com/v2/YOUR_KEY`

2. Add 1–50 Ethereum addresses, one per line.
3. Enter the Railway backend URL and its `ADMIN_TOKEN`.
4. Click **Save and connect**.
5. Open **Notification settings**, choose the alert types and delivery channels, and configure the timing.
6. Optionally enter an alert email and click **Send test**. Confirm the first FormSubmit email before expecting automatic alerts.
7. Click **Enable browser notifications** and allow notifications in the browser.

Use **Wallet balances → Settings** to enable wallet balances and select their refresh interval. Use the separate **Gas Station → Settings** dialog to configure its address, minimum ETH balance, and independent refresh interval. Use **Refresh now** at any time without changing either schedule.

Without a Railway backend, monitoring and alerts run only while the page remains open. With the backend configured, server-side email and Web Push alerts continue while the dashboard is closed. Email delivery uses Resend when configured and otherwise falls back to the activated FormSubmit recipient. The gas boost indicator is a recommendation based on the current network price, not a guarantee that a transaction is stuck.

Pending synchronization is best-effort. Ethereum JSON-RPC can reveal a difference between the confirmed and pending account nonce, but it cannot always return every transaction hash from another provider's mempool. The dashboard reports such missing transactions instead of silently showing zero.

The Etherscan key is stored only on Railway. Etherscan's official API can confirm a higher pending nonce but does not provide the address pending list with full transaction hashes, so Alchemy remains the primary live transaction source.

Crypto news is loaded through the Railway backend. The dashboard excludes sponsored stories, links to the original publisher, attributes CryptoCompare, and keeps the latest successful news response in local browser storage. If the feed is temporarily unavailable, transaction monitoring continues unaffected.
