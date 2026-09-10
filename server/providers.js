const { config } = require('./config');

const NEWS_CACHE_MS = 15 * 60 * 1000;
const newsCache = { items: null, updatedAt: 0 };

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
  return body;
}

async function fetchEtherscanPendingNonces(addresses) {
  if (!config.etherscanApiKey) throw new Error('ETHERSCAN_API_KEY is not configured on Railway');
  const items = [];
  const errors = [];
  const batchSize = 3;

  for (let start = 0; start < addresses.length; start += batchSize) {
    const batch = addresses.slice(start, start + batchSize);
    const results = await Promise.all(batch.map(async address => {
      const params = new URLSearchParams({
        chainid: '1',
        module: 'proxy',
        action: 'eth_getTransactionCount',
        address,
        tag: 'pending',
        apikey: config.etherscanApiKey,
      });
      try {
        const body = await fetchJson(`https://api.etherscan.io/v2/api?${params}`);
        if (body.error || !/^0x[0-9a-f]+$/i.test(body.result || '')) {
          throw new Error(body.error?.message || body.result || body.message || 'Etherscan request failed');
        }
        return { address, pendingNonce: Number.parseInt(body.result, 16) };
      } catch (error) {
        errors.push({ address, error: error?.message || 'Etherscan request failed' });
        return null;
      }
    }));
    items.push(...results.filter(Boolean));
    if (start + batchSize < addresses.length) await delay(1100);
  }

  return { items, errors };
}

async function fetchCryptoCompareNews({ force = false } = {}) {
  if (!force && newsCache.items && Date.now() - newsCache.updatedAt < NEWS_CACHE_MS) {
    return { items: newsCache.items, updatedAt: newsCache.updatedAt, cached: true };
  }
  const params = new URLSearchParams({ lang: 'EN', excludeCategories: 'Sponsored', extraParams: 'ETHPendingMonitor' });
  if (config.cryptoCompareApiKey) params.set('api_key', config.cryptoCompareApiKey);
  const body = await fetchJson(`https://min-api.cryptocompare.com/data/v2/news/?${params}`);
  if (!Array.isArray(body?.Data)) throw new Error(body?.Message || 'CryptoCompare news request failed');
  newsCache.items = body.Data.slice(0, 40);
  newsCache.updatedAt = Date.now();
  return { items: newsCache.items, updatedAt: newsCache.updatedAt, cached: false };
}

module.exports = { fetchEtherscanPendingNonces, fetchCryptoCompareNews };
