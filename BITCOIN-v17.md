# Bitcoin & UTXO Health — v17

## Railway variables

```env
BITCOIN_RPC_URL=https://bitcoin-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
BITCOIN_INDEXER_URL=https://mempool.space/api
```

`BITCOIN_RPC_URL` is the full Bitcoin Mainnet HTTPS endpoint copied from Alchemy. It is used only by Railway for block height, chain synchronization, mempool state, hashrate and fee estimates.

`BITCOIN_INDEXER_URL` must expose the Esplora endpoint `GET /address/:address/utxo`. The public mempool.space API works without a key and is the default. For higher limits or address privacy, replace it with a private/self-hosted Esplora-compatible service.

Do not remove the existing Ethereum, Solana, database, email or authentication variables.

## Using the feature

1. Open **Wallets → Wallet settings**.
2. Add up to 25 public Bitcoin Mainnet addresses, one per line. A label is optional: `Cold storage | bc1q…`.
3. Save. The Wallet balances panel will show BTC, spendable UTXO count, dust count, health and an approximate consolidation cost.
4. Open **Networks**. Ethereum is selected by default. Use the top switcher to open **Solana** or **Bitcoin · UTXO**.

The app is watch-only. It never requests Bitcoin private keys, seed phrases or xprv values.

## UTXO Health model

- **Healthy**: at most 15 outputs and no dust.
- **Monitor**: more than 15 outputs or more than five small outputs.
- **Consolidate**: dust exists or the address has more than 50 outputs.
- Dust uses a conservative 546-satoshi heuristic.
- Consolidation cost is an estimate based on address type, current 6-block fee estimate and one destination output. The final transaction fee can differ.

Address balances and UTXO composition are public blockchain data. With the default indexer, watched Bitcoin addresses are requested from mempool.space by the Railway server. Use a private indexer if this metadata should not be disclosed to a third party.
