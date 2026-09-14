# Solana Gas Station alerts — v19

Version 19 adds an independent low-balance alert for the Solana Gas Station.

## What changed

- `solanaGasLow` is separate from the Ethereum `gasLow` rule.
- Browser, email, Telegram, repeat interval, and **Ignore quiet hours** are configured independently.
- Railway checks the configured Solana address through `SOLANA_RPC_URL` around the clock, even when the dashboard is closed.
- PostgreSQL alert history deduplicates repeated SOL notifications per user and address.
- Existing users receive the new rule through deep settings migration; no SQL migration is required.

## Configuration

1. Set `SOLANA_RPC_URL` and, for Telegram, `TELEGRAM_BOT_TOKEN` in Railway.
2. In **Wallets → Gas Station settings**, enter the Solana address, minimum SOL reserve, and refresh interval.
3. In **Wallets → Notification settings**, enable **Low Solana Gas Station balance** and select the desired channels.

Ethereum and Solana alerts can be enabled, disabled, or repeated independently.
