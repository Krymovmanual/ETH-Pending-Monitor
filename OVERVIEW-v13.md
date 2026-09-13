# Treasury Overview v13

This release replaces the legacy Bitget-only Overview with a consolidated operations dashboard.

## What changed

- Overview now reads `/api/exchanges/accounts` and includes Bitget, Bybit, Gate.io, OKX and Binance connections.
- Total equity, available balance, unrealized PnL and open exposure use all accounts with known USD values.
- Every returned exchange account appears in the Accounts table with its sync status, equity, PnL and open-position count.
- Allocation by venue and largest cross-exchange exposures are calculated from the same normalized account model.
- News, wallet activity and detailed network analytics remain in their dedicated workspaces.
- The desktop Overview uses a compact left navigation rail and a stricter operations-focused visual system; mobile falls back to the existing compact navigation.
- “Add account” opens the exchange connection dialog directly.
- A missing, unfunded Gate.io BTC futures account is treated as optional rather than as a synchronization warning.

No new Railway variables or database migrations are required.
