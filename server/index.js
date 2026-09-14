const express = require('express');
const path = require('node:path');
const {version: packageVersion}=require('../package.json');
const {createAuth,appOrigin}=require('./auth/service');
const {createAccounts}=require('./accounts');
const {createMonitors}=require('./monitors');
const { config, tokenMatches, validateEnvironment, normalizeOrigin } = require('./config');
const db = require('./db');

const { sendEmail, sendPush, sendTelegram, hasPushConfiguration, hasTelegramConfiguration, validTelegramChatId } = require('./notifier');
const { proxyAlchemyRpc, fetchEtherscanPendingNonces, fetchCryptoCompareNews } = require('./providers');
const { GasAnalyticsCollector, RETENTION_DAYS } = require('./gas-analytics');

const { fetchWalletBalances, fetchSolanaWalletBalances, fetchSolanaNetworkStatus, validSolanaAddress, estimateEthereumTransfer } = require('./wallets');
const { fetchBitcoinWalletBalances, fetchBitcoinNetworkStatus, validBitcoinAddress } = require('./bitcoin');

const app = express();
const monitors = createMonitors(db.pool);
const auth = createAuth(db.pool, async (recipient,subject,fields) => {
  if (!config.resendApiKey) throw new Error('Email service not configured');
  await sendEmail(recipient,subject,fields);
});
const accounts = createAccounts(db.pool,auth);
const gasAnalytics = new GasAnalyticsCollector();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({limit:'128kb'}));
app.use((req,res,next) => {
  res.set('X-Content-Type-Options','nosniff'); res.set('Referrer-Policy','no-referrer');
  res.set('X-Frame-Options','DENY');
  res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'");
  next();
});
app.use('/api',auth.origin);
auth.routes(app);
accounts.routes(app);

function validAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ''));
}

function sanitizeSettings(body) {
  const addresses = [...new Set((Array.isArray(body.addresses) ? body.addresses : [])
    .map(value => String(value).trim().toLowerCase()))];
  if (addresses.length > 50 || addresses.some(value => !validAddress(value))) {
    throw new Error('Enter up to 50 valid Ethereum addresses');
  }
  const labels = {};
  for (const address of addresses) {
    const label = String(body.labels?.[address] || '').trim().slice(0, 80);
    if (label) labels[address] = label;
  }
  const solanaAddresses = [...new Set((Array.isArray(body.solanaAddresses) ? body.solanaAddresses : [])
    .map(value => String(value).trim()))];
  if (solanaAddresses.length > 50 || solanaAddresses.some(value => !validSolanaAddress(value))) {
    throw new Error('Enter up to 50 valid Solana addresses');
  }
  const solanaLabels = {};
  for (const address of solanaAddresses) {
    const label = String(body.solanaLabels?.[address] || '').trim().slice(0, 80);
    if (label) solanaLabels[address] = label;
  }
  const bitcoinAddresses = [...new Set((Array.isArray(body.bitcoinAddresses) ? body.bitcoinAddresses : [])
    .map(value => String(value).trim()))];
  if (bitcoinAddresses.length > 25 || bitcoinAddresses.some(value => !validBitcoinAddress(value))) {
    throw new Error('Enter up to 25 valid Bitcoin mainnet addresses');
  }
  const bitcoinLabels = {};
  for (const address of bitcoinAddresses) {
    const label = String(body.bitcoinLabels?.[address] || '').trim().slice(0, 80);
    if (label) bitcoinLabels[address] = label;
  }
  const email = String(body.email || '').trim().slice(0, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid alert email');
  const telegramChatId = String(body.telegramChatId || '').trim();
  if (telegramChatId && !validTelegramChatId(telegramChatId)) throw new Error('Enter a valid numeric Telegram chat ID');
  const sourceRules = body.notificationSettings?.rules || {};
  const rule = (name, defaults) => ({
    ...defaults,
    enabled: sourceRules[name]?.enabled !== false,
    browser: sourceRules[name]?.browser !== false,
    email: sourceRules[name]?.email !== false,
    telegram: sourceRules[name]?.telegram === undefined ? Boolean(defaults.telegram) : Boolean(sourceRules[name].telegram),
    afterMinutes: clamp(sourceRules[name]?.afterMinutes, defaults.afterMinutes, 0, 1440),
    repeatMinutes: clamp(sourceRules[name]?.repeatMinutes, defaults.repeatMinutes, 0, 1440),
    ignoreQuiet: sourceRules[name]?.ignoreQuiet === undefined ? Boolean(defaults.ignoreQuiet) : Boolean(sourceRules[name].ignoreQuiet),
  });
  const gasAddress = String(body.balanceSettings?.gasAddress || '').trim().toLowerCase();
  if (gasAddress && !validAddress(gasAddress)) throw new Error('Enter a valid Gas Station address');
  const solanaGasAddress = String(body.balanceSettings?.solanaGasAddress || '').trim();
  if (solanaGasAddress && !validSolanaAddress(solanaGasAddress)) throw new Error('Enter a valid Solana Gas Station address');
  return {
    addresses,
    labels,
    solanaAddresses,
    solanaLabels,
    bitcoinAddresses,
    bitcoinLabels,
    email,
    telegramChatId,
    timezone: safeTimezone(body.timezone),
    notificationSettings: {
      rules: {
        pending: rule('pending', { enabled: true, browser: true, email: true, telegram: true, afterMinutes: 15, repeatMinutes: 30 }),
        blocker: rule('blocker', { enabled: true, browser: true, email: true, telegram: true, afterMinutes: 15, repeatMinutes: 30, ignoreQuiet: true }),
        dropped: rule('dropped', { enabled: true, browser: true, email: true, telegram: false, afterMinutes: 30, repeatMinutes: 0 }),
        replaced: rule('replaced', { enabled: true, browser: true, email: true, telegram: false, afterMinutes: 0, repeatMinutes: 0 }),
        gasLow: rule('gasLow', { enabled: true, browser: true, email: true, telegram: false, afterMinutes: 0, repeatMinutes: 60, ignoreQuiet: true }),
        solanaGasLow: rule('solanaGasLow', { enabled: true, browser: true, email: true, telegram: false, afterMinutes: 0, repeatMinutes: 60, ignoreQuiet: true }),
      },
      quietHoursEnabled: Boolean(body.notificationSettings?.quietHoursEnabled),
      quietStart: validTime(body.notificationSettings?.quietStart) ? body.notificationSettings.quietStart : '22:00',
      quietEnd: validTime(body.notificationSettings?.quietEnd) ? body.notificationSettings.quietEnd : '08:00',
    },
    balanceSettings: {
      enabled: body.balanceSettings?.enabled !== false,
      balanceInterval: refreshInterval(body.balanceSettings?.balanceInterval, 3600000),
      gasName: String(body.balanceSettings?.gasName || 'Main Gas Station').trim().slice(0, 80),
      gasAddress,
      gasThreshold: clamp(body.balanceSettings?.gasThreshold, 0.1, 0, 1_000_000),
      gasInterval: refreshInterval(body.balanceSettings?.gasInterval, 300000),
      solanaGasName: String(body.balanceSettings?.solanaGasName || 'Solana Gas Station').trim().slice(0, 80),
      solanaGasAddress,
      solanaGasThreshold: clamp(body.balanceSettings?.solanaGasThreshold, 1, 0, 1_000_000),
      solanaGasInterval: refreshInterval(body.balanceSettings?.solanaGasInterval, 300000),
    },
  };
}

function clamp(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function refreshInterval(value, fallback) {
  return Number(value) === 0 ? 0 : clamp(value, fallback, 60000, 86400000);
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

function ethereumNetworkSummary(current, analyticsStatus, monitorStatus) {
  const lastBlockAt = current?.sampledAt || analyticsStatus.lastBlockAt;
  const blockAgeSeconds = lastBlockAt ? Math.max(0, Math.round((Date.now() - new Date(lastBlockAt).getTime()) / 1000)) : null;
  const streamsConnected = Boolean(analyticsStatus.connected && monitorStatus.connected);
  const level = streamsConnected && blockAgeSeconds !== null && blockAgeSeconds <= 45
    ? 'healthy'
    : (analyticsStatus.connected || monitorStatus.connected) && (blockAgeSeconds === null || blockAgeSeconds <= 120)
      ? 'degraded'
      : 'unavailable';
  const warnings = [];
  if (!analyticsStatus.connected) warnings.push('Block analytics stream is disconnected');
  if (!monitorStatus.connected) warnings.push('Transaction monitoring stream is disconnected');
  if (blockAgeSeconds !== null && blockAgeSeconds > 45) warnings.push(`No new block sample for ${blockAgeSeconds} seconds`);
  if (monitorStatus.error) warnings.push(monitorStatus.error);
  if (analyticsStatus.error) warnings.push(analyticsStatus.error);
  return {
    network: 'Ethereum',
    chainId: 1,
    level,
    latestBlock: current?.blockNumber ?? monitorStatus.lastConfirmedBlock,
    lastBlockAt,
    blockAgeSeconds,
    blockIntervalSeconds: analyticsStatus.blockIntervalSeconds,
    rpcLatencyMs: analyticsStatus.rpcLatencyMs,
    transactionStreamConnected: monitorStatus.connected,
    analyticsStreamConnected: analyticsStatus.connected,
    monitoredAddresses: monitorStatus.monitoredAddresses,
    lastTransactionAt: monitorStatus.lastPendingAt,
    gasStation: monitorStatus.gasStation,
    warnings: [...new Set(warnings)].slice(0, 5),
  };
}

function ethereumFeePlanner(current) {
  if (!current) return [];
  const tiers = [
    { key: 'economy', label: 'Economy', fee: current.low, confirmation: '2–5 blocks' },
    { key: 'standard', label: 'Standard', fee: current.standard, confirmation: '1–2 blocks' },
    { key: 'priority', label: 'Priority', fee: current.fast, confirmation: 'Next block target' },
  ];
  return tiers.map(tier => {
    const feeGwei = Number(tier.fee);
    return {
      ...tier,
      feeGwei: Number.isFinite(feeGwei) ? feeGwei : null,
      nativeTransferEth: Number.isFinite(feeGwei) ? Number((feeGwei * 21_000 / 1e9).toFixed(8)) : null,
      erc20TransferEth: Number.isFinite(feeGwei) ? Number((feeGwei * 65_000 / 1e9).toFixed(8)) : null,
    };
  });
}

app.get('/health', (_req,res) => res.json({status:'ok',version:packageVersion,authentication:'sessions'}));
app.use(express.static(path.join(__dirname,'../docs'),{index:'index.html',maxAge:0}));

app.get('/api/public-config', (_req, res) => {
  res.json({ pushEnabled: hasPushConfiguration(), vapidPublicKey: config.vapidPublicKey || null, telegramEnabled:hasTelegramConfiguration(), solanaEnabled:Boolean(config.solanaRpcUrl), bitcoinEnabled:Boolean(config.bitcoinRpcUrl) });
});

app.get('/api/settings', auth.requireUser, async (req, res, next) => {
  try { res.json(await db.getSettings()); } catch (error) { next(error); }
});

app.put('/api/settings', auth.requireUser, auth.requireRole('admin'), async (req, res, next) => {
  try {
    const owner=(await db.pool.query('SELECT email FROM users WHERE id=$1',[req.organization.dataOwnerId])).rows[0];
    const settings = sanitizeSettings({...req.body, email:owner?.email||req.user.email});
    await db.saveSettings(settings);
    await monitors.ensure(req.organization.dataOwnerId,settings);
    await auth.audit(req.user.id,'settings_updated',req);
    await auth.auditOrganization(req,'settings_updated','workspace',req.organization.id);
    res.json({ success: true, settings });
  } catch (error) {
    if (/Enter /.test(error.message)) return res.status(400).json({ error: error.message });
    next(error);
  }
});

app.get('/api/transactions', auth.requireUser, async (req, res, next) => {
  try {
    const [items,queue]=await Promise.all([db.recentTransactions(req.query.limit),db.pendingQueue()]);
    res.json({items,queue,monitor:monitors.get(req.organization.dataOwnerId).getStatus()});
  } catch (error) { next(error); }
});

app.get('/api/gas-analytics', auth.requireUser, async (req, res, next) => {
  try {
    const settings = await db.getSettings();
    const summary = await db.gasAnalyticsSummary(safeTimezone(settings.timezone));
    const current = gasAnalytics.status().current;
    const analyticsStatus = gasAnalytics.status();
    const monitorStatus = monitors.get(req.organization.dataOwnerId).status();
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
      network: ethereumNetworkSummary(current, analyticsStatus, monitorStatus),
      feePlanner: ethereumFeePlanner(current),
      recommendation,
      retentionDays: RETENTION_DAYS,
      ...summary,
    });
  } catch (error) { next(error); }
});

app.post('/api/providers/alchemy/rpc', auth.requireUser, async (req, res, next) => {
  try { await auth.limit('rpc:'+req.user.id,1200,60,Array.isArray(req.body)?req.body.length:1); res.json(await proxyAlchemyRpc(req.body)); }
  catch (error) {
    if (/must contain|not allowed|Invalid params/.test(error.message)) return res.status(400).json({error: error.message});
    next(error);
  }
});

app.post('/api/providers/etherscan/pending-nonces', auth.requireUser, async (req, res, next) => {
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

app.get('/api/providers/cryptocompare/news', auth.requireUser, async (req, res, next) => {
  try {
    const force = false;
    res.json(await fetchCryptoCompareNews({ force }));
  } catch (error) { next(error); }
});

app.get('/api/providers/bitget/account', auth.requireUser, async (req, res, next) => {
  try {
    res.json(await accounts.summary());
  } catch (error) {
    if (/not configured/.test(error.message)) return res.status(503).json({ error: error.message });
    console.error('Request failed', error.code || error.status || 'upstream_error');
    res.status(502).json({ error: String(error?.message || 'Bitget account request failed').slice(0, 220) });
  }
});

app.get('/api/exchanges/accounts', auth.requireUser, async (req, res) => {
  try {
    res.json(await accounts.all({force:req.query.refresh==='1'}));
  } catch (error) {
    if (/not configured/.test(error.message)) return res.status(503).json({ error: error.message });
    console.error('Request failed', error.code || error.status || 'upstream_error');
    res.status(502).json({ error: String(error?.message || 'Exchange account request failed').slice(0, 220) });
  }
});

app.post('/api/wallets/balances', auth.requireUser, async (req, res, next) => {
  try {
    res.json(await fetchWalletBalances(Array.isArray(req.body?.addresses) ? req.body.addresses : []));
  } catch (error) {
    if (/Enter 1/.test(error.message)) return res.status(400).json({ error:error.message });
    next(error);
  }
});

app.post('/api/wallets/solana/balances', auth.requireUser, async (req, res) => {
  try {
    res.json(await fetchSolanaWalletBalances(Array.isArray(req.body?.addresses) ? req.body.addresses : []));
  } catch (error) {
    const message = String(error?.message || 'Solana balance request failed').slice(0, 220);
    res.status(/Enter 1/.test(message) ? 400 : /not configured/.test(message) ? 503 : 502).json({ error:message });
  }
});

app.get('/api/networks/solana', auth.requireUser, async (_req, res) => {
  try { res.json(await fetchSolanaNetworkStatus()); }
  catch (error) {
    const message = String(error?.message || 'Solana network request failed').slice(0, 220);
    res.status(/not configured/.test(message) ? 503 : 502).json({ error:message });
  }
});

app.post('/api/wallets/bitcoin/balances', auth.requireUser, async (req, res) => {
  try {
    res.json(await fetchBitcoinWalletBalances(Array.isArray(req.body?.addresses) ? req.body.addresses : []));
  } catch (error) {
    const message = String(error?.message || 'Bitcoin balance request failed').slice(0, 220);
    res.status(/Enter 1/.test(message) ? 400 : /not configured/.test(message) ? 503 : 502).json({ error:message });
  }
});

app.get('/api/networks/bitcoin', auth.requireUser, async (_req, res) => {
  try { res.json(await fetchBitcoinNetworkStatus()); }
  catch (error) {
    const message = String(error?.message || 'Bitcoin network request failed').slice(0, 220);
    res.status(/not configured/.test(message) ? 503 : 502).json({ error:message });
  }
});

app.post('/api/transfers/estimate', auth.requireUser, async (req, res) => {
  try {
    res.json(await estimateEthereumTransfer(req.body || {}));
  } catch (error) {
    const message = String(error?.message || 'Transfer estimate failed').slice(0, 220);
    const status = /Enter |not supported|greater than|decimal places/.test(message) ? 400 : 502;
    res.status(status).json({ error:message });
  }
});

app.post('/api/push/subscribe', auth.requireUser, async (req, res, next) => {
  try {
    if (!hasPushConfiguration()) return res.status(503).json({ error: 'Web Push is not configured on the server' });
    if (!req.body?.endpoint || !req.body?.keys?.p256dh || !req.body?.keys?.auth) return res.status(400).json({ error: 'Invalid push subscription' });
    const endpoint = new URL(req.body.endpoint);
    const allowedPushHosts=['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com','notify.windows.com'];
    if(endpoint.protocol!=='https:'||endpoint.port||!allowedPushHosts.some(host=>endpoint.hostname===host||endpoint.hostname.endsWith('.'+host)))return res.status(400).json({error:'Unsupported browser push service'});
    await db.savePushSubscription(req.body,req.session.id_hash);
    res.json({ success: true });
  } catch (error) { next(error); }
});

app.post('/api/test-push', auth.requireUser, auth.requireRole('operator'), async (req, res, next) => {
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

app.post('/api/test-email', auth.requireUser, auth.requireRole('operator'), async (req, res, next) => {
  try {
    const email = req.user.email;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    await sendEmail(email, 'ETH Pending Monitor server test', {
      event: 'test',
      status: 'Server-side alerts are active',
      checked_at: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (error) { next(error); }
});

app.post('/api/test-telegram', auth.requireUser, auth.requireRole('operator'), async (req, res, next) => {
  try {
    if (!hasTelegramConfiguration()) return res.status(503).json({ error: 'Telegram bot is not configured on the server' });
    const chatId = String(req.body?.chatId || '').trim();
    if (!validTelegramChatId(chatId)) return res.status(400).json({ error: 'Enter a valid numeric Telegram chat ID' });
    await auth.limit(`telegram-test:${req.user.id}`, 5, 300);
    await sendTelegram(chatId, 'Paseqa test alert', 'Telegram notifications are connected. Ethereum pending alerts will arrive here.', config.frontendOrigins[0]);
    res.json({ success: true });
  } catch (error) { next(error); }
});

app.get('/api/preferences',auth.requireUser,async(req,res)=>{
  const r=await db.pool.query('SELECT value FROM user_monitor_state WHERE user_id=$1 AND key=$2',[req.user.id,'ui_preferences']);
  res.json(r.rows[0]?.value||{});
});
app.put('/api/preferences',auth.requireUser,async(req,res)=>{
  const allowed=['treasury-wallet-sources','treasury-transfer-drafts','treasury-exchange-selection','treasury-exchange-view'];
  const value={};for(const key of allowed)if(typeof req.body?.[key]==='string'&&req.body[key].length<=20000)value[key]=req.body[key];
  await db.saveMonitorState('ui_preferences',value);res.json({success:true});
});
app.post('/api/owner/import',auth.requireUser,auth.requireRole('owner'),async(req,res)=>{
  if(!process.env.BOOTSTRAP_OWNER_EMAIL||req.user.email!==process.env.BOOTSTRAP_OWNER_EMAIL.trim().toLowerCase())return res.status(403).json({error:'Owner access required'});
  await auth.factor(req);
  await auth.tx(async client=>{
    const user=(await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[req.user.id])).rows[0];
    if(user.legacy_imported)throw Object.assign(new Error('Previous workspace has already been imported'),{status:409});
    const old=(await client.query('SELECT settings FROM app_settings WHERE id=1')).rows[0]?.settings;
    if(old){old.email=req.user.email;await client.query('INSERT INTO user_settings(user_id,settings) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO NOTHING',[req.user.id,JSON.stringify(old)]);}
    await client.query(`INSERT INTO user_transactions(user_id,hash,from_address,to_address,nonce,status,first_seen,last_seen,missing_checks,replacement_hash,tx_data)
      SELECT $1,hash,from_address,to_address,nonce,status,first_seen,last_seen,missing_checks,replacement_hash,tx_data FROM transactions ON CONFLICT(user_id,hash) DO NOTHING`,[req.user.id]);
    await client.query("INSERT INTO user_monitor_state(user_id,key,value) SELECT $1,key,value FROM monitor_state ON CONFLICT(user_id,key) DO NOTHING",[req.user.id]);
    await client.query('UPDATE users SET legacy_imported=TRUE WHERE id=$1',[req.user.id]);
  });
  await monitors.ensure(req.user.id,await db.getSettings());await auth.audit(req.user.id,'legacy_imported',req);await auth.auditOrganization(req,'legacy_workspace_imported','workspace',req.organization.id);res.json({success:true});
});

app.use((error, _req, res, _next) => {
  console.error('Request failed', error.code || error.status || 'upstream_error');
  res.status(error.status || (error.code==='23505'?409:500)).json({error:error.status?error.message:error.code==='23505'?'This name is already in use':'Server request failed'});
});

async function boot() {
  await db.initializeDatabase();
  await auth.initialize();
  if (process.env.DISABLE_MONITORS !== 'true') gasAnalytics.start();
  await monitors.start();
  const cleanup=async()=>{
    await db.pool.query("DELETE FROM sessions WHERE expires_at<NOW() OR last_seen<NOW()-INTERVAL '7 days'; DELETE FROM email_tokens WHERE expires_at<NOW(); DELETE FROM request_limits WHERE reset_at<NOW(); DELETE FROM security_events WHERE created_at<NOW()-INTERVAL '30 days';");
    await db.pool.query(`DELETE FROM user_transactions WHERE (user_id,hash) IN (
      SELECT user_id,hash FROM (SELECT user_id,hash,ROW_NUMBER() OVER(PARTITION BY user_id ORDER BY first_seen DESC) AS row_number FROM user_transactions WHERE status<>'pending') ranked WHERE row_number>2000)`);
    await db.pool.query("DELETE FROM user_pending_queue WHERE resolved_at<NOW()-INTERVAL '7 days'");
  };
  cleanup().catch(()=>console.error('Cleanup failed'));
  setInterval(()=>cleanup().catch(()=>console.error('Cleanup failed')),3600000).unref();
  app.listen(config.port, '0.0.0.0', () => {
    const missing = validateEnvironment();
    console.log(`ETH Pending Monitor server listening on port ${config.port}`);
    if (missing.length) console.warn(`Configuration required: ${missing.join(', ')}`);
  });
}

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  monitors.stop();
  await gasAnalytics.stop();
  await db.pool.end();
  process.exit(0);
}

if (require.main === module) {
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

boot().catch(error => {
  console.error('Startup failed:', error);
  process.exit(1);
});

}
module.exports={app,auth,accounts,boot};
