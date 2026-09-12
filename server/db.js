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
    CREATE TABLE IF NOT EXISTS monitor_state (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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
    CREATE TABLE IF NOT EXISTS gas_minute_samples (
      minute TIMESTAMPTZ PRIMARY KEY,
      sample_count SMALLINT NOT NULL,
      base_min REAL NOT NULL,
      base_avg REAL NOT NULL,
      base_median REAL NOT NULL,
      base_max REAL NOT NULL,
      low_min REAL NOT NULL,
      low_avg REAL NOT NULL,
      low_median REAL NOT NULL,
      low_max REAL NOT NULL,
      standard_min REAL NOT NULL,
      standard_avg REAL NOT NULL,
      standard_median REAL NOT NULL,
      standard_max REAL NOT NULL,
      fast_min REAL NOT NULL,
      fast_avg REAL NOT NULL,
      fast_median REAL NOT NULL,
      fast_max REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gas_minute_samples_recent ON gas_minute_samples (minute DESC);
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

async function upsertConfirmedTransaction(tx, status = 'confirmed', firstSeen = null) {
  const safeStatus = status === 'failed' ? 'failed' : 'confirmed';
  const result = await pool.query(
    `INSERT INTO transactions (hash, from_address, to_address, nonce, status, first_seen, tx_data)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()), $7::jsonb)
     ON CONFLICT (hash) DO UPDATE SET
       status = EXCLUDED.status,
       last_seen = NOW(),
       missing_checks = 0,
       tx_data = transactions.tx_data || EXCLUDED.tx_data
     RETURNING *`,
    [tx.hash, tx.from, tx.to || null, tx.nonce, safeStatus, firstSeen, JSON.stringify(tx)],
  );
  return result.rows[0];
}

async function getMonitorState(key) {
  const result = await pool.query('SELECT value FROM monitor_state WHERE key = $1', [key]);
  return result.rows[0]?.value ?? null;
}

async function saveMonitorState(key, value) {
  await pool.query(
    `INSERT INTO monitor_state (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)],
  );
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

async function clearTransactions() {
  const result = await pool.query('DELETE FROM transactions');
  return result.rowCount;
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

async function saveGasMinute(sample) {
  const values = [
    sample.minute, sample.sampleCount,
    sample.base.min, sample.base.avg, sample.base.median, sample.base.max,
    sample.low.min, sample.low.avg, sample.low.median, sample.low.max,
    sample.standard.min, sample.standard.avg, sample.standard.median, sample.standard.max,
    sample.fast.min, sample.fast.avg, sample.fast.median, sample.fast.max,
  ];
  await pool.query(
    `INSERT INTO gas_minute_samples (
       minute, sample_count,
       base_min, base_avg, base_median, base_max,
       low_min, low_avg, low_median, low_max,
       standard_min, standard_avg, standard_median, standard_max,
       fast_min, fast_avg, fast_median, fast_max
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (minute) DO UPDATE SET
       sample_count=EXCLUDED.sample_count,
       base_min=EXCLUDED.base_min, base_avg=EXCLUDED.base_avg, base_median=EXCLUDED.base_median, base_max=EXCLUDED.base_max,
       low_min=EXCLUDED.low_min, low_avg=EXCLUDED.low_avg, low_median=EXCLUDED.low_median, low_max=EXCLUDED.low_max,
       standard_min=EXCLUDED.standard_min, standard_avg=EXCLUDED.standard_avg, standard_median=EXCLUDED.standard_median, standard_max=EXCLUDED.standard_max,
       fast_min=EXCLUDED.fast_min, fast_avg=EXCLUDED.fast_avg, fast_median=EXCLUDED.fast_median, fast_max=EXCLUDED.fast_max`,
    values,
  );
}

async function cleanupGasAnalytics(retentionDays = 30) {
  await pool.query(`DELETE FROM gas_minute_samples WHERE minute < NOW() - ($1::text || ' days')::interval`, [retentionDays]);
}

async function gasAnalyticsSummary(timezone = 'UTC') {
  let results;
  try {
    results = await Promise.all([
    pool.query(`
      SELECT date_trunc('hour', minute) AS hour,
        SUM(sample_count)::integer AS sample_count,
        AVG(base_avg)::float AS base,
        AVG(low_avg)::float AS low,
        AVG(standard_avg)::float AS standard,
        AVG(fast_avg)::float AS fast,
        MIN(standard_min)::float AS minimum,
        MAX(standard_max)::float AS maximum
      FROM gas_minute_samples
      WHERE minute >= NOW() - INTERVAL '24 hours'
      GROUP BY 1 ORDER BY 1 DESC`),
    pool.query(`
      SELECT EXTRACT(ISODOW FROM minute AT TIME ZONE $1)::integer AS weekday,
        EXTRACT(HOUR FROM minute AT TIME ZONE $1)::integer AS hour,
        AVG(standard_avg)::float AS value,
        COUNT(*)::integer AS minutes
      FROM gas_minute_samples
      WHERE minute >= NOW() - INTERVAL '30 days'
      GROUP BY 1, 2 ORDER BY 1, 2`, [timezone]),
    pool.query(`
      SELECT COUNT(*)::integer AS minutes,
        percentile_cont(0.35) WITHIN GROUP (ORDER BY standard_avg)::float AS p35,
        percentile_cont(0.70) WITHIN GROUP (ORDER BY standard_avg)::float AS p70
      FROM gas_minute_samples
      WHERE minute >= NOW() - INTERVAL '30 days'`),
    ]);
  } catch (error) {
    if (error?.code === '22023' && timezone !== 'UTC') return gasAnalyticsSummary('UTC');
    throw error;
  }
  const [hourlyResult, heatmapResult, baselineResult] = results;
  return {
    hourly: hourlyResult.rows,
    heatmap: heatmapResult.rows,
    baseline: baselineResult.rows[0] || { minutes: 0, p35: null, p70: null },
  };
}

module.exports = {
  pool,
  defaultSettings,
  initializeDatabase,
  getSettings,
  saveSettings,
  upsertTransaction,
  upsertConfirmedTransaction,
  getMonitorState,
  saveMonitorState,
  pendingTransactions,
  recentTransactions,
  clearTransactions,
  markStatus,
  incrementMissing,
  findSameNonce,
  alertIsDue,
  recordAlert,
  savePushSubscription,
  allPushSubscriptions,
  deletePushSubscription,
  saveGasMinute,
  cleanupGasAnalytics,
  gasAnalyticsSummary,
};
