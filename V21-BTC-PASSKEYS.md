# v21 — BTC UTXO Intelligence & Passkeys

## BTC UTXO Intelligence

The Bitcoin network workspace remains watch-only and adds:

- a current low-fee/consolidation signal;
- a rolling 30-day fee baseline sampled into one row per 10-minute bucket;
- configurable maximum consolidation fee in sat/vB;
- per-wallet UTXO, dust and consolidation-cost analysis;
- a configurable expected payout amount with an estimate of selected inputs, transaction vbytes, miner fee, change or funding shortfall;
- an independent `bitcoinConsolidation` notification rule for browser, email and Telegram delivery.

After at least 12 samples, the effective low-fee threshold is the lower of the configured threshold and the historical 25th percentile. This prevents a permissive manual value from labeling an expensive period as a good window. The signal is informational: Paseqa does not construct, sign or broadcast Bitcoin transactions.

The Telegram notification is emitted only when fees are inside the low window and a watched wallet has an `attention` or `watch` UTXO-health level. PostgreSQL deduplication enforces the configured repeat interval.

## Passkeys

Security & accounts now supports WebAuthn passkeys:

- registration requires the current password and, when enabled, a fresh TOTP or recovery code;
- login verifies a challenge, origin, relying-party ID, user verification and signature counter;
- credentials can be named, inspected and removed;
- one-time challenges expire after five minutes and are consumed before verification;
- only the credential ID, public key, counter, transports and device metadata are stored in PostgreSQL.

The authenticator's private key remains in the operating system, password manager or hardware security key. It is never exported to Paseqa. Password and TOTP/recovery login remain available as fallback.

Passkeys are bound to the hostname in `APP_ORIGIN`. Production must use the permanent HTTPS origin, for example:

```env
APP_ORIGIN=https://app.paseqa.com
```

Do not register production passkeys on the temporary Railway hostname and then change `APP_ORIGIN`; those credentials will not be valid for the new relying-party domain. No additional secret or environment variable is required.

## Deployment

Deploy the release normally. Startup creates these tables automatically:

- `bitcoin_fee_samples` for compact network-fee history;
- `passkey_credentials` for public WebAuthn credentials;
- `passkey_challenges` for short-lived, single-use ceremonies.

Keep `BITCOIN_RPC_URL`, `BITCOIN_INDEXER_URL`, `DATABASE_URL`, `APP_ORIGIN` and the existing authentication secrets configured. The hourly cleanup removes expired passkey challenges and fee samples older than 35 days.
