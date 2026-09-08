# ETH Pending Monitor

Live pending transaction monitor for one or more Ethereum addresses.

## Features

- Monitor up to 50 Ethereum addresses from one dashboard.
- Browser and optional email alerts when a transaction is pending for more than 15 minutes, is dropped, is replaced, or may need a gas boost.
- `Needs boost` indicator when the transaction max fee is below the current network gas price returned by Alchemy.
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

Monitoring and alerts run only while the page remains open. Email delivery uses the third-party FormSubmit service. The gas boost indicator is a recommendation based on the current network price, not a guarantee that a transaction is stuck.
