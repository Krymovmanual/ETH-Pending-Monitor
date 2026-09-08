# ETH Pending Monitor

Live pending transaction monitor for one or more Ethereum addresses.

## Features

- Monitor up to 50 Ethereum addresses from one dashboard.
- Browser and optional email alerts when a transaction is pending for more than 15 minutes, is dropped, is replaced, or may need a gas boost.
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
- Local browser storage for the Alchemy URL, addresses, alert email, and transaction history.

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
3. Optionally enter an alert email and click **Send test**. Confirm the first FormSubmit email before expecting automatic alerts.
4. Click **Enable browser notifications** and allow notifications in the browser.
5. Click **Save and connect**.

Use **Wallet balances → Settings** to enable wallet balances and select their refresh interval. Use the separate **Gas Station → Settings** dialog to configure its address, minimum ETH balance, and independent refresh interval. Use **Refresh now** at any time without changing either schedule.

Monitoring and alerts run only while the page remains open. Email delivery uses the third-party FormSubmit service. The gas boost indicator is a recommendation based on the current network price, not a guarantee that a transaction is stuck.
