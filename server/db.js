const { Pool } = require('pg');
const { config } = require('./config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseUrl && !/localhost|127\.0\.0\.1/.test(config.databaseUrl)
    ? { rejectUnauthorized: false }
    : false,
  max: 5,
});

const defaultSettings = {
  addresses: [],
  labels: {},
  email: '',
  timezone: 'UTC',
  notificationSettings: {
    rules: {
      pending: { enabled: true, browser: true, email: true, afterMinutes: 15, repeatMinutes: 30 },
      blocker: { enabled: true, browser: true, email: true, afterMinutes: 15, repeatMinutes: 30, ignoreQuiet: true },
      dropped: { enabled: true, browser: true, email: true, afterMinutes: 30, repeatMinutes: 0 },
      replaced: { enabled: true, browser: true, email: true, afterMinutes: 0, repeatMinutes: 0 },
      gasLow: { enabled: true, browser: true, email: true, afterMinutes: 0, repeatMinutes: 60, ignoreQuiet: true }
    },
    quietHoursEnabled: false,
    quietStart: '22:00',
    quietEnd: '08:00'
  },
  balanceSettings: {
    gasName: 'Main Gas Station',
    gasAddress: '',
    gasThreshold: 0.1,
    gasInterval: 300000
  }
};

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      settings JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS transactions (
      hash TEXT PRIMARY KEY,
      from_address TEXT NOT NULL,
      to_address TEXT,
      nonce BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      missing_checks INTEGER NOT NULL DEFAULT 0,
      replacement_hash TEXT,
      tx_data JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_transactions_pending_sender_nonce
      ON transactions (from_address, nonce) WHERE status = 'pending';
    CREATE TABLE IF NOT EXISTS alert_log (
      kind TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      last_sent TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (kind, scope_key)
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      subscription JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(
    `INSERT INTO app_settings (id, settings) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(defaultSettings)],
  );
}

function deepMerge(base, update) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return update === undefined ? base : update;
  const result = { ...base };
  for (const [key, value] of Object.entries(update)) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? deepMerge(base?.[key] || {}, value)
      : value;
  }
  return result;
}

async function getSettings() {
  const result = await pool.query('SELECT settings FROM app_settings WHERE id = 1');
  return deepMerge(defaultSettings, result.rows[0]?.settings || {});
}

async function saveSettings(settings) {
  const merged = deepMerge(defaultSettings, settings);
  await pool.query(
    `INSERT INTO app_settings (id, settings, updated_at) VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()`,
    [JSON.stringify(merged)],
  );
  return merged;
}

async function upsertTransaction(tx) {
  const result = await pool.query(
    `INSERT INTO transactions (hash, from_address, to_address, nonce, status, tx_data)
     VALUES ($1, $2, $3, $4, 'pending', $5::jsonb)
     ON CONFLICT (hash) DO UPDATE SET last_seen = NOW(), missing_checks = 0, tx_data = EXCLUDED.tx_data
     RETURNING *, (xmax = 0) AS inserted`,
    [tx.hash, tx.from, tx.to || null, tx.nonce, JSON.stringify(tx)],
  );
  return result.rows[0];
}

async function pendingTransactions() {
  const result = await pool.query(`SELECT * FROM transactions WHERE status = 'pending' ORDER BY from_address, nonce, first_seen`);
  return result.rows;
}

async function recentTransactions(limit = 250) {
  const result = await pool.query(
    `SELECT hash, from_address, to_address, nonce, status, first_seen, last_seen, replacement_hash, tx_data
     FROM transactions ORDER BY first_seen DESC LIMIT $1`,
    [Math.min(1000, Math.max(1, Number(limit) || 250))],
  );
  return result.rows;
}

async function markStatus(hash, status, replacementHash = null) {
  await pool.query(
    `UPDATE transactions SET status = $2, replacement_hash = COALESCE($3, replacement_hash), last_seen = NOW() WHERE hash = $1`,
    [hash, status, replacementHash],
  );
}

async function incrementMissing(hash) {
  const result = await pool.query(
    `UPDATE transactions SET missing_checks = missing_checks + 1 WHERE hash = $1 RETURNING missing_checks`,
    [hash],
  );
  return Number(result.rows[0]?.missing_checks || 0);
}

async function findSameNonce(from, nonce, exceptHash) {
  const result = await pool.query(
    `SELECT * FROM transactions WHERE from_address = $1 AND nonce = $2 AND hash <> $3 AND status = 'pending'`,
    [from, nonce, exceptHash],
  );
  return result.rows;
}

async function alertIsDue(kind, scopeKey, repeatMinutes) {
  const result = await pool.query(`SELECT last_sent FROM alert_log WHERE kind = $1 AND scope_key = $2`, [kind, scopeKey]);
  if (!result.rows.length) return true;
  if (!Number(repeatMinutes)) return false;
  return Date.now() - new Date(result.rows[0].last_sent).getTime() >= Number(repeatMinutes) * 60_000;
}

async function recordAlert(kind, scopeKey) {
  await pool.query(
    `INSERT INTO alert_log (kind, scope_key, last_sent) VALUES ($1, $2, NOW())
     ON CONFLICT (kind, scope_key) DO UPDATE SET last_sent = NOW()`,
    [kind, scopeKey],
  );
}

async function savePushSubscription(subscription) {
  await pool.query(
    `INSERT INTO push_subscriptions (endpoint, subscription) VALUES ($1, $2::jsonb)
     ON CONFLICT (endpoint) DO UPDATE SET subscription = EXCLUDED.subscription, updated_at = NOW()`,
    [subscription.endpoint, JSON.stringify(subscription)],
  );
}

async function allPushSubscriptions() {
  const result = await pool.query('SELECT endpoint, subscription FROM push_subscriptions');
  return result.rows;
}

async function deletePushSubscription(endpoint) {
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

module.exports = {
  pool,
  defaultSettings,
  initializeDatabase,
  getSettings,
  saveSettings,
  upsertTransaction,
  pendingTransactions,
  recentTransactions,
  markStatus,
  incrementMissing,
  findSameNonce,
  alertIsDue,
  recordAlert,
  savePushSubscription,
  allPushSubscriptions,
  deletePushSubscription,
};
