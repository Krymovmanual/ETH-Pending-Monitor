# Ethereum Queue Recovery — v20.1

Paseqa now keeps a compact server-side record for every unresolved Ethereum nonce, even when Alchemy or Etherscan reports that a queue exists without returning transaction hashes.

## What this fixes

If nonce `195191` blocks six later withdrawals, the Wallets table shows all seven queue positions. After nonce `195191` confirms, Railway closes that slot and nonce `195192` automatically becomes the next blocker. The queue therefore remains visible after a speed-up instead of disappearing with the first known transaction.

## Data model

`user_pending_queue` stores only the organization data owner, sender address, nonce, first/last observation, resolution time and discovery source. It does not store block snapshots, raw mempool payloads or duplicate transaction bodies.

- Open slots are unique by organization, address and nonce.
- A scan tracks at most 250 consecutive open nonces per address.
- Resolved slots are deleted after seven days.
- When a transaction hash is later observed, the API links the slot to the full transaction instead of rendering a duplicate.

## Detection and handoff

Every monitoring cycle compares `latest` and `pending` transaction counts through Alchemy and optionally cross-checks the pending count through Etherscan. The greater safe pending count defines the open nonce range. Advancing `latest` resolves completed slots.

When the first slot has no available hash, the dashboard renders an explicit **Hash unavailable** row with a link to the address pending queue. Telegram, email and Web Push can alert through the existing Pending/Blocker rules. The alert scope includes the nonce, so confirmation of one blocker allows the next nonce to produce a new alert.

## Provider limitation

A nonce count proves that queue positions exist but cannot reveal their hashes, fees, recipients or amounts. Paseqa labels those fields as unknown and directs the operator to the signing system or Etherscan. If the connected RPC later exposes the transaction, the normal full-detail row and fee analysis replace the placeholder automatically.

No new Railway variables are required. `ETHERSCAN_API_KEY` remains optional but improves cross-provider detection.
