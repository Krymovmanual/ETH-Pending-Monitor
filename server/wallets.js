const { config } = require('./config');

const TOKENS = [
  { symbol: 'USDT', name: 'Tether USD', contract: '0xdac17f958d2ee523a2206206994597c13d831ec7', decimals: 6 },
  { symbol: 'USDC', name: 'USD Coin', contract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6 },
  { symbol: 'LINK', name: 'Chainlink', contract: '0x514910771af9ca656af840dff83e8264ecf986ca', decimals: 18 },
  { symbol: 'DAI', name: 'Dai', contract: '0x6b175474e89094c44da98b954eedeac495271d0f', decimals: 18 },
  { symbol: 'USDS', name: 'USDS', contract: '0xdc035d45d973e3ec169d2276ddab16f1e407384f', decimals: 18 },
];

function validAddress(value) { return /^0x[a-fA-F0-9]{40}$/.test(String(value || '')); }

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

module.exports = { TOKENS, validAddress, formatUnits, parseUnits, fetchWalletBalances, estimateEthereumTransfer };
