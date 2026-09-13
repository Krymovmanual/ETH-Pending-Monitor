# Paseqa Treasury v16 — Solana

## Railway configuration

Add the complete Alchemy Solana Mainnet HTTPS endpoint as a Railway variable and redeploy:

```env
SOLANA_RPC_URL=https://solana-mainnet.g.alchemy.com/v2/REPLACE_ME
```

The value is server-only. Users add public Solana addresses; the application never requests a seed phrase or private key.

## Included

- Per-user Solana watch-only address lists and labels.
- SOL and non-zero SPL token balances through Railway.
- Known symbols for native SOL, USDC and USDT; unknown SPL tokens remain identifiable by their mint.
- Independent Ethereum and Solana Gas Station addresses, thresholds and refresh schedules.
- Solana Network Control with health, confirmed slot, block height, RPC latency and recent priority-fee distribution.
- Backward-compatible Ethereum monitoring and settings.
