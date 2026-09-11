const express = require('express');
const cors = require('cors');
const { config, tokenMatches, validateEnvironment, normalizeOrigin } = require('./config');
const db = require('./db');
const { EthereumMonitor } = require('./monitor');
const { sendEmail, sendPush, hasPushConfiguration } = require('./notifier');
const { fetchEtherscanPendingNonces, fetchCryptoCompareNews } = require('./providers');
const { GasAnalyticsCollector, RETENTION_DAYS } = require('./gas-analytics');
const { configured: bitgetConfigured, fetchBitgetAccount, fetchBitgetAccounts } = require('./bitget');

const app = express();
const monitor = new EthereumMonitor();
const gasAnalytics = new GasAnalyticsCollector();

app.disable('x-powered-by');
app.use(cors({
  origin(origin, callback) {
    if (!origin || !config.frontendOrigins.length || config.frontendOrigins.includes(normalizeOrigin(origin))) return callback(null, true);
    return callback(new Error('Origin is not allowed'));
  },
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '128kb' }));

function requireAdmin(req, res, next) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!config.adminToken) return res.status(503).json({ error: 'ADMIN_TOKEN is not configured on the server' });
  if (!tokenMatches(token)) return res.status(401).json({ error: 'Invalid access token' });
  next();
}

function validAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ''));
}

function sanitizeSettings(body) {
  const addresses = [...new Set((Array.isArray(body.addresses) ? body.addresses : [])
    .map(value => String(value).trim().toLowerCase()))];
  if (!addresses.length || addresses.length > 50 || addresses.some(value => !validAddress(value))) {
    throw new Error('Enter 1–50 valid Ethereum addresses');
  }
  const labels = {};
  for (const address of addresses) {
    const label = String(body.labels?.[address] || '').trim().slice(0, 80);
    if (label) labels[address] = label;
  }
  const email = String(body.email || '').trim().slice(0, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid alert email');
  const sourceRules = body.notificationSettings?.rules || {};
  const rule = (name, defaults) => ({
    ...defaults,
    enabled: sourceRules[name]?.enabled !== false,
    browser: sourceRules[name]?.browser !== false,
    email: sourceRules[name]?.email !== false,
    afterMinutes: clamp(sourceRules[name]?.afterMinutes, defaults.afterMinutes, 0, 1440),
    repeatMinutes: clamp(sourceRules[name]?.repeatMinutes, defaults.repeatMinutes, 0, 1440),
    ignoreQuiet: Boolean(sourceRules[name]?.ignoreQuiet),
  });
  const gasAddress = String(body.balanceSettings?.gasAddress || '').trim().toLowerCase();
  if (gasAddress && !validAddress(gasAddress)) throw new Error('Enter a valid Gas Station address');
  return {
    addresses,
    labels,
    email,
    timezone: safeTimezone(body.timezone),
    notificationSettings: {
      rules: {
        pending: rule('pending', { enabled: true, browser: true, email: true, afterMinutes: 15, repeatMinutes: 30 }),
        blocker: rule('blocker', { enabled: true, browser: true, email: true, afterMinutes: 15, repeatMinutes: 30, ignoreQuiet: true }),
        dropped: rule('dropped', { enabled: true, browser: true, email: true, afterMinutes: 30, repeatMinutes: 0 }),
        replaced: rule('replaced', { enabled: true, browser: true, email: true, afterMinutes: 0, repeatMinutes: 0 }),
        gasLow: rule('gasLow', { enabled: true, browser: true, email: true, afterMinutes: 0, repeatMinutes: 60, ignoreQuiet: true }),
      },
      quietHoursEnabled: Boolean(body.notificationSettings?.quietHoursEnabled),
      quietStart: validTime(body.notificationSettings?.quietStart) ? body.notificationSettings.quietStart : '22:00',
      quietEnd: validTime(body.notificationSettings?.quietEnd) ? body.notificationSettings.quietEnd : '08:00',
    },
    balanceSettings: {
      gasName: String(body.balanceSettings?.gasName || 'Main Gas Station').trim().slice(0, 80),
      gasAddress,
      gasThreshold: clamp(body.balanceSettings?.gasThreshold, 0.1, 0, 1_000_000),
      gasInterval: clamp(body.balanceSettings?.gasInterval, 300000, 60000, 86400000),
    },
  };
}

function clamp(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function validTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

function safeTimezone(value) {
  const aliases = {
    'Europe/Kiev': 'Europe/Kyiv',
    'Asia/Calcutta': 'Asia/Kolkata',
    'Asia/Katmandu': 'Asia/Kathmandu',
    'America/Godthab': 'America/Nuuk',
  };
  const supplied = String(value || 'UTC').slice(0, 80);
  const timezone = aliases[supplied] || supplied;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return timezone;
  } catch { return 'UTC'; }
}

app.get('/health', (_req, res) => {
  const missing = validateEnvironment();
  const analyticsStatus = gasAnalytics.status();
  res.json({
    status: 'ok',
    configured: missing.length === 0,
    missing,
    pushConfigured: hasPushConfiguration(),
    providers: {
      etherscan: Boolean(config.etherscanApiKey),
      cryptoCompare: Boolean(config.cryptoCompareApiKey),
      bitget: bitgetConfigured(),
    },
    gasAnalytics: { connected: analyticsStatus.connected, lastBlockAt: analyticsStatus.lastBlockAt },
  });
});

app.get('/', (_req, res) => {
  res.json({ service: 'ETH Pending Monitor', status: 'online', health: '/health' });
});

app.get('/api/public-config', (_req, res) => {
  res.json({ pushEnabled: hasPushConfiguration(), vapidPublicKey: config.vapidPublicKey || null });
});

app.get('/api/settings', requireAdmin, async (_req, res, next) => {
  try { res.json(await db.getSettings()); } catch (error) { next(error); }
});

app.put('/api/settings', requireAdmin, async (req, res, next) => {
  try {
    const settings = sanitizeSettings(req.body || {});
    await db.saveSettings(settings);
    await monitor.reconfigure(settings);
    res.json({ success: true, settings });
  } catch (error) {
    if (/Enter /.test(error.message)) return res.status(400).json({ error: error.message });
    next(error);
  }
});

app.get('/api/transactions', requireAdmin, async (req, res, next) => {
  try { res.json({ items: await db.recentTransactions(req.query.limit) }); } catch (error) { next(error); }
});

app.get('/api/gas-analytics', requireAdmin, async (_req, res, next) => {
  try {
    const settings = await db.getSettings();
    const summary = await db.gasAnalyticsSummary(safeTimezone(settings.timezone));
    const current = gasAnalytics.status().current;
    const minutes = Number(summary.baseline.minutes) || 0;
    let recommendation = { level: 'collecting', label: 'Building baseline', confidence: 'Low' };
    if (current && minutes >= 60) {
      if (current.standard <= Number(summary.baseline.p35)) recommendation = { level: 'low', label: 'Send now', confidence: minutes >= 1440 ? 'High' : 'Medium' };
      else if (current.standard <= Number(summary.baseline.p70)) recommendation = { level: 'normal', label: 'Normal', confidence: minutes >= 1440 ? 'High' : 'Medium' };
      else recommendation = { level: 'high', label: 'Better wait', confidence: minutes >= 1440 ? 'High' : 'Medium' };
    }
    res.json({
      status: gasAnalytics.status(),
      current,
      recommendation,
      retentionDays: RETENTION_DAYS,
      ...summary,
    });
  } catch (error) { next(error); }
});

app.post('/api/providers/etherscan/pending-nonces', requireAdmin, async (req, res, next) => {
  try {
    const addresses = [...new Set((Array.isArray(req.body?.addresses) ? req.body.addresses : [])
      .map(value => String(value).trim().toLowerCase()))];
    if (!addresses.length || addresses.length > 50 || addresses.some(value => !validAddress(value))) {
      return res.status(400).json({ error: 'Enter 1–50 valid Ethereum addresses' });
    }
    res.json(await fetchEtherscanPendingNonces(addresses));
  } catch (error) {
    if (/not configured/.test(error.message)) return res.status(503).json({ error: error.message });
    next(error);
  }
});

app.get('/api/providers/cryptocompare/news', requireAdmin, async (req, res, next) => {
  try {
    const force = req.query.refresh === '1';
    res.json(await fetchCryptoCompareNews({ force }));
  } catch (error) { next(error); }
});

app.get('/api/providers/bitget/account', requireAdmin, async (req, res, next) => {
  try {
    res.json(await fetchBitgetAccount({ force: req.query.refresh === '1' }));
  } catch (error) {
    if (/not configured/.test(error.message)) return res.status(503).json({ error: error.message });
    console.error(error);
    res.status(502).json({ error: String(error?.message || 'Bitget account request failed').slice(0, 220) });
  }
});

app.get('/api/exchanges/accounts', requireAdmin, async (req, res) => {
  try {
    res.json(await fetchBitgetAccounts({ force: req.query.refresh === '1' }));
  } catch (error) {
    if (/not configured/.test(error.message)) return res.status(503).json({ error: error.message });
    console.error(error);
    res.status(502).json({ error: String(error?.message || 'Exchange account request failed').slice(0, 220) });
  }
});

app.post('/api/push/subscribe', requireAdmin, async (req, res, next) => {
  try {
    if (!hasPushConfiguration()) return res.status(503).json({ error: 'Web Push is not configured on the server' });
    if (!req.body?.endpoint || !req.body?.keys?.p256dh || !req.body?.keys?.auth) return res.status(400).json({ error: 'Invalid push subscription' });
    await db.savePushSubscription(req.body);
    res.json({ success: true });
  } catch (error) { next(error); }
});

app.post('/api/test-push', requireAdmin, async (req, res, next) => {
  try {
    if (!hasPushConfiguration()) return res.status(503).json({ error: 'Web Push is not configured on the server' });
    const requestedUrl = String(req.body?.url || '');
    const url = config.frontendOrigins.some(origin => requestedUrl.startsWith(`${origin}/`))
      ? requestedUrl
      : config.frontendOrigins[0] || undefined;
    const delivered = await sendPush(
      'ETH Pending Monitor server test',
      '24/7 browser push notifications are active.',
      url,
      `server-test-${Date.now()}`,
      false,
    );
    if (!delivered) return res.status(409).json({ error: 'No active browser subscription was found' });
    res.json({ success: true, delivered });
  } catch (error) { next(error); }
});

app.post('/api/test-email', requireAdmin, async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    await sendEmail(email, 'ETH Pending Monitor server test', {
      event: 'test',
      status: 'Server-side alerts are active',
      checked_at: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Server request failed' });
});

async function boot() {
  await db.initializeDatabase();
  gasAnalytics.start();
  await monitor.start();
  app.listen(config.port, '0.0.0.0', () => {
    const missing = validateEnvironment();
    console.log(`ETH Pending Monitor server listening on port ${config.port}`);
    if (missing.length) console.warn(`Configuration required: ${missing.join(', ')}`);
  });
}

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  monitor.stop();
  await gasAnalytics.stop();
  await db.pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

boot().catch(error => {
  console.error('Startup failed:', error);
  process.exit(1);
});
