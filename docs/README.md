# ETH Pending Monitor

Live pending transaction monitor for the Ethereum address:

`0xcED92FA7f0797cBc851B48140aE218a0b0D41ce0`

## Publishing with Visual Studio

1. Extract the archive and open the `ETH-Pending-Monitor` folder in Visual Studio.
2. Open **Git → Create Git Repository**.
3. Select GitHub, enter a repository name, and choose **Public**.
4. Click **Create and Push**.
5. Open the new repository on GitHub.
6. Go to **Settings → Pages**.
7. Under **Build and deployment**, select **Deploy from a branch**.
8. Select the `master` branch and `/docs` folder, then click **Save**.

After publishing, open the GitHub Pages URL, click **Connection settings**, and enter the Alchemy WebSocket URL in this format:

`wss://eth-mainnet.g.alchemy.com/v2/YOUR_KEY`

The Alchemy URL is stored locally in the browser. Monitoring runs while the page is open.
