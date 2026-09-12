const crypto = require('node:crypto');


function createBitgetClient(credentials) {
const config = {bitgetApiKey:credentials.apiKey,bitgetApiSecret:credentials.secret,bitgetApiPassphrase:credentials.passphrase};
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

function baseAssetFromSymbol(value) {
  const symbol = String(value || '').toUpperCase();
  return symbol
    .replace(/(?:USDT|USDC|USD)(?:_CM|_UMCBL|_DMCBL|_PERP)?$/, '')
    .replace(/(?:_CM|_UMCBL|_DMCBL|_PERP)$/, '') || symbol;
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
  const category = String(item?.category || '').slice(0, 30).toUpperCase();
  const symbol = String(item?.symbol || '').slice(0, 40);
  const contractSize = numberOrNull(item?.total ?? item?.positionBalance);
  const markPrice = numberOrNull(item?.markPrice);
  const coinMargined = category === 'COIN-FUTURES' || /USD_CM$/i.test(symbol);
  const baseAsset = baseAssetFromSymbol(symbol);
  const size = coinMargined && contractSize !== null && markPrice > 0
    ? Math.abs(contractSize) / markPrice
    : contractSize;
  const unrealisedPnl = numberOrNull(item?.unrealisedPnl);
  const pnlCurrency = coinMargined
    ? String(item?.marginCoin || baseAsset).toUpperCase()
    : category === 'USDC-FUTURES' ? 'USDC' : 'USDT';
  const pnlNeedsUsdConversion = coinMargined && !['USD', 'USDT', 'USDC'].includes(pnlCurrency);
  const unrealisedPnlUsd = unrealisedPnl === null
    ? null
    : pnlNeedsUsdConversion && markPrice !== null ? unrealisedPnl * markPrice : unrealisedPnl;
  const rawMargin = numberOrNull(item?.marginSize ?? item?.positionMargin ?? item?.margin);
  return {
    id: `bitget:${String(category || 'futures').toLowerCase()}:${symbol}:${String(item?.posSide || 'long').toLowerCase()}`,
    exchangeId: 'bitget',
    accountId: 'bitget:unified',
    category,
    symbol,
    baseAsset,
    side: String(item?.posSide || '').toLowerCase() === 'short' ? 'short' : 'long',
    marginMode: String(item?.marginMode || '').slice(0, 20),
    marginCoin: String(item?.marginCoin || '').slice(0, 20),
    size,
    contractSize,
    sizeCurrency: baseAsset,
    available: numberOrNull(item?.available),
    leverage: numberOrNull(item?.leverage),
    entryPrice: numberOrNull(item?.avgPrice),
    markPrice,
    notional: coinMargined
      ? (contractSize === null ? null : Math.abs(contractSize))
      : numberOrNull(item?.positionValue ?? item?.notional) ?? (
        size !== null && markPrice !== null ? Math.abs(size * markPrice) : null
      ),
    margin: rawMargin,
    marginUsd: rawMargin === null ? null : coinMargined && markPrice !== null ? rawMargin * markPrice : rawMargin,
    liquidationPrice: numberOrNull(item?.liquidationPrice),
    unrealisedPnl,
    unrealisedPnlUsd,
    pnlCurrency,
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
    .flatMap((result, index) => Array.isArray(result?.list)
      ? result.list.map(item => ({ ...item, category: item?.category || POSITION_CATEGORIES[index] }))
      : [])
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

function toExchangeAccounts(data) {
  const assets = Array.isArray(data?.assets) ? data.assets : [];
  const positions = Array.isArray(data?.positions) ? data.positions : [];
  const unifiedAssets = assets.filter(item => item.account === 'Unified').map(item => ({
    ...item,
    id: `bitget:unified:${item.coin}`,
    exchangeId: 'bitget',
    accountId: 'bitget:unified',
  }));
  const fundingAssets = assets.filter(item => item.account === 'Funding').map(item => ({
    ...item,
    id: `bitget:funding:${item.coin}`,
    exchangeId: 'bitget',
    accountId: 'bitget:funding',
  }));
  const accounts = [{
    id: 'bitget:unified',
    exchangeId: 'bitget',
    exchangeName: 'Bitget',
    name: 'Unified',
    type: 'unified',
    status: 'connected',
    updatedAt: data.updatedAt,
    summary: {
      equityUsd: data.summary?.accountEquity ?? null,
      availableUsd: null,
      lockedUsd: null,
      unrealisedPnl: data.summary?.unrealisedPnl ?? null,
      positionValue: data.summary?.positionValue ?? null,
    },
    assets: unifiedAssets,
    positions,
  }];
  if (fundingAssets.length) {
    accounts.push({
      id: 'bitget:funding',
      exchangeId: 'bitget',
      exchangeName: 'Bitget',
      name: 'Funding',
      type: 'funding',
      status: 'connected',
      updatedAt: data.updatedAt,
      summary: { equityUsd: null, availableUsd: null, lockedUsd: null, unrealisedPnl: null, positionValue: null },
      assets: fundingAssets,
      positions: [],
    });
  }
  return {
    version: 1,
    updatedAt: data.updatedAt,
    exchanges: [{ id: 'bitget', name: 'Bitget', status: 'connected', accountIds: accounts.map(account => account.id) }],
    accounts,
    warnings: data.warnings || [],
  };
}

async function fetchBitgetAccounts(options = {}) {
  return toExchangeAccounts(await fetchBitgetAccount(options));
}

return { fetchBitgetAccount, fetchBitgetAccounts, toExchangeAccounts, normalizeAsset, normalizePosition, signedHeaders,
  async validateReadOnly() {
    const info = await request('/api/v2/spot/account/info');
    const permissions = info?.authorities;
    if (!Array.isArray(permissions) || !permissions.length || permissions.some(p => !['readonly', 'read-only', 'read_only'].includes(String(p).toLowerCase()))) {
      throw new Error('Use an API key with read-only permission. The exchange did not confirm read-only access.');
    }
    await request('/api/v3/account/assets');
  }
};
}
module.exports = {createBitgetClient};
