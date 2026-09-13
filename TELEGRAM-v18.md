# Telegram alerts — v18

Paseqa can send server-side Ethereum alerts to a Telegram group while the dashboard is closed.

## Setup

1. Open `@BotFather` in Telegram, run `/newbot`, and copy the token.
2. Add `TELEGRAM_BOT_TOKEN` to the Railway application variables and redeploy.
3. Add the new bot to the destination Telegram group.
4. Obtain the group's numeric chat ID. A supergroup ID normally starts with `-100`.
5. In Paseqa open **Notification settings**, paste the group chat ID, and click **Send test**.
6. Keep **Telegram** enabled for **Pending transactions**. The default threshold is 15 minutes.

The bot token stays in Railway. Group IDs and channel preferences are isolated per Paseqa user. Before every pending or blocker alert, the backend verifies that the transaction is still pending. PostgreSQL prevents duplicate delivery and applies the selected repeat interval.
