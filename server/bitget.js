const crypto = require('node:crypto');
const { config } = require('./config');

const BASE_URL = 'https://api.bitget.com';
const CACHE_MS = 20_000;
const POSITION_CATEGORIES = ['USDT-FUTURES', 'USDC-FUTURES', 'COIN-FUTURES'];
const cache = { value: null, updatedAt: 0 };

function configured() {
  return Boolean(config.bitgetApiKey && config.bitgetApiSecret && config.bitgetApiPassphrase);
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function signedHeaders(method, requestPath, body = '') {
  const timestamp = String(Date.now());
  const prehash = `${timestamp}${method.toUpperCase()}${requestPath}${body}`;
  const signature = crypto.createHmac('sha256', config.bitgetApiSecret).update(prehash).digest('base64');
  return {
    'ACCESS-KEY': config.bitgetApiKey,
    'ACCESS-SIGN': signature,
    'ACCESS-TIMESTAMP': timestamp,
    'ACCESS-PASSPHRASE': config.bitgetApiPassphrase,
    'Content-Type': 'application/json',
    locale: 'en-US',
  };
}

async function request(path, query = {}) {
  if (!configured()) throw new Error('Bitget is not configured on Railway');
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== '' && value !== undefined && value !== null) params.set(key, String(value));
  }
  const requestPath = `${path}${params.size ? `?${params}` : ''}`;
  const response = await fetch(`${BASE_URL}${requestPath}`, {
    method: 'GET',
    headers: signedHeaders('GET', requestPath),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.code !== '00000') {
    const message = String(body?.msg || body?.message || `HTTP ${response.status}`).slice(0, 180);
    throw new Error(`Bitget request failed: ${message}`);
  }
  return body.data;
}

function normalizeAsset(item, account) {
  return {
    account,
    coin: String(item?.coin || '').slice(0, 30),
    equity: numberOrNull(item?.equity ?? item?.balance),
    available: numberOrNull(item?.available),
    locked: numberOrNull(item?.locked ?? item?.frozen),
    usdValue: account === 'Unified' ? numberOrNull(item?.usdValue) : null,
    debt: account === 'Unified' ? numberOrNull(item?.debt) : null,
  };
}

function normalizePosition(item) {
  return {
    category: String(item?.category || '').slice(0, 30),
    symbol: String(item?.symbol || '').slice(0, 40),
    side: String(item?.posSide || '').toLowerCase() === 'short' ? 'short' : 'long',
    marginMode: String(item?.marginMode || '').slice(0, 20),
    marginCoin: String(item?.marginCoin || '').slice(0, 20),
    size: numberOrNull(item?.total ?? item?.positionBalance),
    available: numberOrNull(item?.available),
    leverage: numberOrNull(item?.leverage),
    entryPrice: numberOrNull(item?.avgPrice),
    markPrice: numberOrNull(item?.markPrice),
    liquidationPrice: numberOrNull(item?.liquidationPrice),
    unrealisedPnl: numberOrNull(item?.unrealisedPnl),
    profitRate: numberOrNull(item?.profitRate),
    updatedAt: numberOrNull(item?.updatedTime),
  };
}

async function optional(label, promise, warnings) {
  try { return await promise; }
  catch (error) {
    warnings.push(`${label}: ${error?.message || 'request failed'}`);
    return null;
  }
}

async function fetchBitgetAccount({ force = false } = {}) {
  if (!configured()) throw new Error('Bitget is not configured on Railway');
  if (!force && cache.value && Date.now() - cache.updatedAt < CACHE_MS) {
    return { ...cache.value, cached: true };
  }

  const warnings = [];
  const unified = await request('/api/v3/account/assets');
  const [funding, ...positionResults] = await Promise.all([
    optional('Funding assets', request('/api/v3/account/funding-assets'), warnings),
    ...POSITION_CATEGORIES.map(category => optional(
      `${category} positions`,
      request('/api/v3/position/current-position', { category }),
      warnings,
    )),
  ]);

  const unifiedAssets = Array.isArray(unified?.assets) ? unified.assets : [];
  const fundingAssets = Array.isArray(funding) ? funding : [];
  const positions = positionResults
    .flatMap(result => Array.isArray(result?.list) ? result.list : [])
    .map(normalizePosition)
    .filter(item => item.symbol && Number(item.size) !== 0);
  const assets = [
    ...unifiedAssets.map(item => normalizeAsset(item, 'Unified')),
    ...fundingAssets.map(item => normalizeAsset(item, 'Funding')),
  ].filter(item => item.coin && (item.equity !== 0 || item.available !== 0 || item.locked !== 0));

  const updatedAt = Date.now();
  cache.value = {
    exchange: 'Bitget',
    accountType: 'Unified Account',
    updatedAt,
    summary: {
      accountEquity: numberOrNull(unified?.accountEquity),
      usdtEquity: numberOrNull(unified?.usdtEquity),
      unrealisedPnl: numberOrNull(unified?.usdtUnrealisedPnl ?? unified?.unrealisedPnl),
      marginRatio: numberOrNull(unified?.mgnRatio),
      positionValue: numberOrNull(unified?.positionValue),
    },
    assets,
    positions,
    warnings,
  };
  cache.updatedAt = updatedAt;
  return { ...cache.value, cached: false };
}

module.exports = { configured, fetchBitgetAccount, normalizeAsset, normalizePosition, signedHeaders };
