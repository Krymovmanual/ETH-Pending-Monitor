# Multi-exchange release v12

Supported personal read-only connections:

- Bitget: API key, secret and passphrase; Unified Manage and Trade data access while the key remains globally Read-only.
- Bybit: API key and secret; Read-only with wallet/account and position query access.
- Gate.io: API key and secret; configure every enabled product permission as Read-only.
- OKX: API key, secret and passphrase; Read permission only.
- Binance: API key and secret; trading, futures trading, withdrawals and universal transfers must be disabled.

Connections are added from Exchanges → Add new and require a fresh 2FA or recovery code. Credentials are encrypted per user and connection, are never returned by the API, and all exchange adapters issue GET requests only.

The Exchanges tree can select one or multiple providers. Consolidated mode groups assets by coin and positions by underlying asset; By account mode preserves the provider account breakdown.

## Deployment

Deploy the complete project. Startup migrates the existing `exchange_connections` constraint to accept `bitget`, `bybit`, `gate`, `okx`, and `binance`; existing Bitget rows and encrypted credentials remain unchanged. No new Railway variables are required.

Run before deployment:

```bash
npm ci
npm run check
npm test
```
