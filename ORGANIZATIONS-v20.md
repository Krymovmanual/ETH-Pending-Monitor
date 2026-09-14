# Organizations & Roles — v20

Paseqa v20 turns the personal dashboard into a company workspace without enabling withdrawals or transaction signing.

## What changed

- Every existing and newly registered user receives a personal organization and the `owner` role.
- Owners and admins can invite colleagues by email. Invitations expire after seven days and can only be accepted by the invited email address.
- The session bar switches between every organization a user belongs to.
- Organization members share monitored Ethereum, Solana and Bitcoin wallets, alerts, transaction history, and encrypted exchange connections.
- Workspace actions are recorded in a separate organization audit log with actor, time, IP, target and structured metadata.

## Roles

| Role | Access |
| --- | --- |
| Owner | Full workspace administration, roles, removals, settings and exchange connections |
| Admin | Treasury settings, invitations, exchange connections and workspace audit |
| Operator | Operational read access and notification test actions |
| Viewer | Read-only balances, positions, transactions and network intelligence |

The API enforces roles server-side. Hiding a button in the browser is only a usability feature and is not treated as an authorization boundary.

## Migration and data model

The startup migration creates organization, membership, invitation and audit tables. Existing users are backfilled automatically into one personal organization each. Existing treasury rows remain physically attached to the workspace owner's internal data identity, so deployment does not rewrite encrypted credentials or transaction history. Access to those rows is resolved from the authenticated user's active organization membership on every request.

No new Railway variables are required. Back up PostgreSQL before the first v20 deployment as with any schema migration.

## Security boundaries

- Invitations use random, hashed, single-use tokens.
- A member cannot accept an invitation sent to a different email.
- Owners cannot be demoted or removed through member endpoints.
- Only owners can change other members' roles.
- Admins cannot grant the admin role unless the requester is the owner.
- Exchange API credentials remain encrypted and are never returned to the browser.

This release is the identity and governance foundation. Quorum approvals, cryptographic user signatures, policy evaluation and write-enabled transfers remain intentionally out of scope until a later controlled release.
