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

const ALLOWED_RPC_METHODS = new Set([
  'eth_getBlockByNumber',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_call',
]);

async function postAlchemyRpc(payload) {
  const response = await fetch(config.alchemyHttpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Alchemy returned HTTP ${response.status}`);
  return body;
}

async function proxyAlchemyRpc(payload) {
  if (!config.alchemyHttpUrl) throw new Error('ALCHEMY_WSS_URL is not configured on Railway');
  const isBatch = Array.isArray(payload);
  const requests = isBatch ? payload : [payload];
  if (!requests.length || requests.length > 100) throw new Error('RPC requests must contain 1–100 items');
  const sanitized = requests.map((request, index) => {
    const method = String(request?.method || '');
    if (!ALLOWED_RPC_METHODS.has(method)) throw new Error(`RPC method is not allowed: ${method || 'missing'}`);
    if (!Array.isArray(request.params)) throw new Error(`Invalid params for ${method}`);
    return { jsonrpc: '2.0', id: request.id ?? index + 1, method, params: request.params };
  });
  if (!isBatch) return postAlchemyRpc(sanitized[0]);

  const batchResponse = await postAlchemyRpc(sanitized);
  if (Array.isArray(batchResponse)) return batchResponse;

  // Some Alchemy plans or gateways reject JSON-RPC batches. Fall back to
  // small groups of individual read-only requests so the dashboard still works.
  const answers = [];
  const fallbackBatchSize = 5;
  for (let start = 0; start < sanitized.length; start += fallbackBatchSize) {
    const group = sanitized.slice(start, start + fallbackBatchSize);
    answers.push(...await Promise.all(group.map(request => postAlchemyRpc(request))));
    if (start + fallbackBatchSize < sanitized.length) await delay(200);
  }
  return answers;
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

module.exports = { proxyAlchemyRpc, fetchEtherscanPendingNonces, fetchCryptoCompareNews };
