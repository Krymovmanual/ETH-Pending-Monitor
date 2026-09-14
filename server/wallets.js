const { config } = require('./config');

const TOKENS = [
  { symbol: 'USDT', name: 'Tether USD', contract: '0xdac17f958d2ee523a2206206994597c13d831ec7', decimals: 6 },
  { symbol: 'USDC', name: 'USD Coin', contract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6 },
  { symbol: 'LINK', name: 'Chainlink', contract: '0x514910771af9ca656af840dff83e8264ecf986ca', decimals: 18 },
  { symbol: 'DAI', name: 'Dai', contract: '0x6b175474e89094c44da98b954eedeac495271d0f', decimals: 18 },
  { symbol: 'USDS', name: 'USDS', contract: '0xdc035d45d973e3ec169d2276ddab16f1e407384f', decimals: 18 },
];

function validAddress(value) { return /^0x[a-fA-F0-9]{40}$/.test(String(value || '')); }

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const SOLANA_TOKENS = new Map([
  ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', { symbol:'USDC', name:'USD Coin' }],
  ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', { symbol:'USDT', name:'Tether USD' }],
]);

function validSolanaAddress(value) {
  const text = String(value || '').trim();
  if (text.length < 32 || text.length > 44) return false;
  let decoded = 0n;
  for (const character of text) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) return false;
    decoded = decoded * 58n + BigInt(digit);
  }
  let bytes = decoded === 0n ? 0 : Math.ceil(decoded.toString(16).length / 2);
  for (const character of text) { if (character === '1') bytes += 1; else break; }
  return bytes === 32;
}

function formatUnits(value, decimals) {
  const integer = BigInt(value || 0);
  const negative = integer < 0n;
  const absolute = negative ? -integer : integer;
  const padded = absolute.toString().padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals) || '0';
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function parseUnits(value, decimals) {
  const supplied = String(value || '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(supplied)) throw new Error('Enter a valid positive amount');
  const [whole, fraction = ''] = supplied.split('.');
  if (fraction.length > decimals) throw new Error(`Amount supports up to ${decimals} decimal places`);
  const result = BigInt(`${whole}${fraction.padEnd(decimals, '0')}`);
  if (result <= 0n) throw new Error('Amount must be greater than zero');
  return result;
}

async function rpc(requests) {
  if (!/^https?:\/\//.test(config.alchemyHttpUrl)) throw new Error('Alchemy HTTP provider is not configured');
  const response = await fetch(config.alchemyHttpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requests),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(`Alchemy request failed (${response.status})`);
  const rows = Array.isArray(body) ? body : [body];
  const failed = rows.find(row => row?.error);
  if (failed) throw new Error(String(failed.error?.message || 'Ethereum RPC request failed').slice(0, 180));
  return new Map(rows.map(row => [row.id, row.result]));
}

async function solanaRpc(requests) {
  if (!/^https:\/\//.test(config.solanaRpcUrl)) throw new Error('Solana RPC provider is not configured');
  const response = await fetch(config.solanaRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requests),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(`Solana RPC request failed (${response.status})`);
  const rows = Array.isArray(body) ? body : [body];
  const failed = rows.find(row => row?.error);
  if (failed) throw new Error(String(failed.error?.message || 'Solana RPC request failed').slice(0, 180));
  return new Map(rows.map(row => [row.id, row.result]));
}

async function fetchSolanaWalletBalances(addresses) {
  const unique = [...new Set((addresses || []).map(value => String(value).trim()))];
  if (!unique.length || unique.length > 50 || unique.some(value => !validSolanaAddress(value))) {
    throw new Error('Enter 1–50 valid Solana addresses');
  }
  let id = 1;
  const requests = [];
  const fields = [];
  for (const address of unique) {
    requests.push({ jsonrpc:'2.0', id, method:'getBalance', params:[address, { commitment:'confirmed' }] });
    fields.push({ id, address, kind:'native' });
    id += 1;
    requests.push({ jsonrpc:'2.0', id, method:'getTokenAccountsByOwner', params:[address, { programId:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding:'jsonParsed', commitment:'confirmed' }] });
    fields.push({ id, address, kind:'tokens' });
    id += 1;
    requests.push({ jsonrpc:'2.0', id, method:'getTokenAccountsByOwner', params:[address, { programId:'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' }, { encoding:'jsonParsed', commitment:'confirmed' }] });
    fields.push({ id, address, kind:'tokens' });
    id += 1;
  }
  const results = await solanaRpc(requests);
  const wallets = unique.map(address => ({ address, chainName:'Solana Mainnet', assets:[] }));
  const byAddress = new Map(wallets.map(wallet => [wallet.address, wallet]));
  const tokenTotals = new Map(wallets.map(wallet => [wallet.address, new Map()]));
  for (const field of fields) {
    const wallet = byAddress.get(field.address);
    const result = results.get(field.id);
    if (field.kind === 'native') {
      const raw = BigInt(result?.value || 0);
      wallet.assets.push({ symbol:'SOL', name:'Solana', mint:null, decimals:9, raw:raw.toString(), balance:formatUnits(raw, 9) });
      continue;
    }
    for (const account of result?.value || []) {
      const info = account?.account?.data?.parsed?.info;
      const amount = info?.tokenAmount;
      if (!info?.mint || !amount?.amount || BigInt(amount.amount) === 0n) continue;
      const totals = tokenTotals.get(field.address);
      const current = totals.get(info.mint) || { raw:0n, decimals:Number(amount.decimals) || 0 };
      current.raw += BigInt(amount.amount);
      totals.set(info.mint, current);
    }
  }
  for (const wallet of wallets) {
    for (const [mint, amount] of tokenTotals.get(wallet.address)) {
      const known = SOLANA_TOKENS.get(mint);
      wallet.assets.push({
        symbol: known?.symbol || `${mint.slice(0, 4)}…${mint.slice(-4)}`,
        name: known?.name || 'SPL Token',
        mint,
        decimals: amount.decimals,
        raw: amount.raw.toString(),
        balance: formatUnits(amount.raw, amount.decimals),
      });
    }
  }
  return { updatedAt:Date.now(), network:'solana-mainnet', wallets };
}

async function fetchSolanaNativeBalance(address) {
  if (!validSolanaAddress(address)) throw new Error('Enter a valid Solana address');
  const results = await solanaRpc([
    { jsonrpc:'2.0', id:1, method:'getBalance', params:[address, { commitment:'confirmed' }] },
  ]);
  const raw = BigInt(results.get(1)?.value || 0);
  return { address, raw:raw.toString(), balance:Number(raw) / 1e9, checkedAt:new Date().toISOString() };
}

async function fetchSolanaNetworkStatus() {
  const startedAt = Date.now();
  const results = await solanaRpc([
    { jsonrpc:'2.0', id:1, method:'getHealth', params:[] },
    { jsonrpc:'2.0', id:2, method:'getSlot', params:[{ commitment:'confirmed' }] },
    { jsonrpc:'2.0', id:3, method:'getBlockHeight', params:[{ commitment:'confirmed' }] },
    { jsonrpc:'2.0', id:4, method:'getLatestBlockhash', params:[{ commitment:'confirmed' }] },
    { jsonrpc:'2.0', id:5, method:'getRecentPrioritizationFees', params:[] },
  ]);
  const fees = (results.get(5) || []).map(row => Number(row.prioritizationFee)).filter(Number.isFinite).sort((a,b) => a-b);
  const percentile = fraction => fees.length ? fees[Math.min(fees.length - 1, Math.floor((fees.length - 1) * fraction))] : null;
  return {
    network:'Solana Mainnet',
    level:results.get(1) === 'ok' ? 'healthy' : 'degraded',
    health:results.get(1) || 'unknown',
    slot:Number(results.get(2)),
    blockHeight:Number(results.get(3)),
    lastValidBlockHeight:Number(results.get(4)?.value?.lastValidBlockHeight),
    rpcLatencyMs:Date.now() - startedAt,
    priorityFeeMicroLamports:{ low:percentile(.25), median:percentile(.5), high:percentile(.75), samples:fees.length },
    sampledAt:Date.now(),
  };
}

async function fetchWalletBalances(addresses) {
  const unique = [...new Set((addresses || []).map(value => String(value).toLowerCase()))];
  if (!unique.length || unique.length > 50 || unique.some(value => !validAddress(value))) {
    throw new Error('Enter 1–50 valid Ethereum addresses');
  }
  let id = 1;
  const requests = [];
  const fields = [];
  for (const address of unique) {
    requests.push({ jsonrpc:'2.0', id, method:'eth_getBalance', params:[address, 'latest'] });
    fields.push({ id, address, symbol:'ETH', name:'Ether', contract:null, decimals:18 });
    id += 1;
    const encodedAddress = address.slice(2).padStart(64, '0');
    for (const token of TOKENS) {
      requests.push({ jsonrpc:'2.0', id, method:'eth_call', params:[{ to:token.contract, data:`0x70a08231${encodedAddress}` }, 'latest'] });
      fields.push({ id, address, ...token });
      id += 1;
    }
  }
  const results = await rpc(requests);
  const wallets = unique.map(address => ({ address, chainId:1, chainName:'Ethereum Mainnet', assets:[] }));
  const byAddress = new Map(wallets.map(wallet => [wallet.address, wallet]));
  for (const field of fields) {
    const raw = results.get(field.id) || '0x0';
    const rawInteger = BigInt(raw === '0x' ? '0x0' : raw);
    byAddress.get(field.address).assets.push({
      symbol: field.symbol,
      name: field.name,
      contract: field.contract,
      decimals: field.decimals,
      raw: rawInteger.toString(),
      balance: formatUnits(rawInteger, field.decimals),
    });
  }
  return { updatedAt:Date.now(), wallets };
}

async function estimateEthereumTransfer({ from, to, symbol, amount }) {
  if (!validAddress(from) || !validAddress(to)) throw new Error('Enter valid Ethereum source and destination addresses');
  const asset = String(symbol || '').toUpperCase() === 'ETH'
    ? { symbol:'ETH', contract:null, decimals:18 }
    : TOKENS.find(token => token.symbol === String(symbol || '').toUpperCase());
  if (!asset) throw new Error('This asset is not supported for Ethereum transfer preview');
  const units = parseUnits(amount, asset.decimals);
  const transaction = asset.contract
    ? { from, to:asset.contract, data:`0xa9059cbb${to.slice(2).padStart(64, '0')}${units.toString(16).padStart(64, '0')}`, value:'0x0' }
    : { from, to, value:`0x${units.toString(16)}` };
  const results = await rpc([
    { jsonrpc:'2.0', id:1, method:'eth_estimateGas', params:[transaction] },
    { jsonrpc:'2.0', id:2, method:'eth_gasPrice', params:[] },
  ]);
  const gasLimit = BigInt(results.get(1));
  const gasPrice = BigInt(results.get(2));
  const feeWei = gasLimit * gasPrice;
  return {
    chainId:1,
    network:'Ethereum Mainnet',
    asset,
    amount:String(amount),
    gasLimit:gasLimit.toString(),
    gasPriceGwei:formatUnits(gasPrice, 9),
    feeEth:formatUnits(feeWei, 18),
    transaction,
    estimatedAt:Date.now(),
  };
}

module.exports = { TOKENS, validAddress, validSolanaAddress, formatUnits, parseUnits, fetchWalletBalances, fetchSolanaWalletBalances, fetchSolanaNativeBalance, fetchSolanaNetworkStatus, estimateEthereumTransfer };
