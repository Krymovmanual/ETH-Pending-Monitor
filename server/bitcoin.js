const crypto = require('node:crypto');
const { config } = require('./config');

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function decodeBase58(value) {
  let number = 0n;
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) return null;
    number = number * 58n + BigInt(digit);
  }
  let hex = number.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const decoded = number ? Buffer.from(hex, 'hex') : Buffer.alloc(0);
  let leading = 0;
  while (value[leading] === '1') leading += 1;
  return Buffer.concat([Buffer.alloc(leading), decoded]);
}

function bech32Polymod(values) {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let index = 0; index < 5; index += 1) if ((top >>> index) & 1) checksum ^= generators[index];
  }
  return checksum >>> 0;
}

function validBech32Address(address) {
  if (address !== address.toLowerCase() && address !== address.toUpperCase()) return false;
  const text = address.toLowerCase();
  if (!text.startsWith('bc1') || text.length > 90) return false;
  const separator = text.lastIndexOf('1');
  const data = [...text.slice(separator + 1)].map(character => BECH32.indexOf(character));
  if (separator !== 2 || data.length < 7 || data.some(value => value < 0)) return false;
  const expanded = [...text.slice(0, separator)].flatMap(character => [character.charCodeAt(0) >>> 5]).concat([0], [...text.slice(0, separator)].map(character => character.charCodeAt(0) & 31));
  const witnessVersion = data[0];
  const checksum = bech32Polymod(expanded.concat(data));
  return witnessVersion <= 16 && (witnessVersion === 0 ? checksum === 1 : checksum === 0x2bc830a3);
}

function validBitcoinAddress(value) {
  const address = String(value || '').trim();
  if (/^bc1/i.test(address)) return validBech32Address(address);
  if (!/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(address)) return false;
  const decoded = decodeBase58(address);
  if (!decoded || decoded.length !== 25 || ![0x00, 0x05].includes(decoded[0])) return false;
  const checksum = crypto.createHash('sha256').update(crypto.createHash('sha256').update(decoded.subarray(0, 21)).digest()).digest().subarray(0, 4);
  return crypto.timingSafeEqual(checksum, decoded.subarray(21));
}

function rpcNumber(value) {
  if (typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value)) return Number.parseInt(value.slice(2), 16);
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function bitcoinRpc(requests) {
  if (!/^https:\/\//.test(config.bitcoinRpcUrl)) throw new Error('Bitcoin RPC provider is not configured');
  const response = await fetch(config.bitcoinRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requests),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(`Bitcoin RPC request failed (${response.status})`);
  const rows = Array.isArray(body) ? body : [body];
  const failed = rows.find(row => row?.error);
  if (failed) throw new Error(String(failed.error?.message || 'Bitcoin RPC request failed').slice(0, 180));
  return new Map(rows.map(row => [row.id, row.result]));
}

function satPerVbyte(result) {
  const btcPerKvB = Number(result?.feerate);
  return Number.isFinite(btcPerKvB) ? Number((btcPerKvB * 100_000).toFixed(2)) : null;
}

async function fetchBitcoinNetworkStatus() {
  const startedAt = Date.now();
  const results = await bitcoinRpc([
    { jsonrpc:'2.0', id:1, method:'getblockchaininfo', params:[] },
    { jsonrpc:'2.0', id:2, method:'getmempoolinfo', params:[] },
    { jsonrpc:'2.0', id:3, method:'estimatesmartfee', params:[1, 'conservative'] },
    { jsonrpc:'2.0', id:4, method:'estimatesmartfee', params:[3, 'conservative'] },
    { jsonrpc:'2.0', id:5, method:'estimatesmartfee', params:[6, 'conservative'] },
    { jsonrpc:'2.0', id:6, method:'getnetworkhashps', params:[120] },
  ]);
  const chain = results.get(1) || {};
  const mempool = results.get(2) || {};
  const blocks = rpcNumber(chain.blocks);
  const headers = rpcNumber(chain.headers);
  const verificationProgress = Number(chain.verificationprogress);
  const level = blocks !== null && (!Number.isFinite(verificationProgress) || verificationProgress >= 0.999) && (headers === null || headers - blocks <= 2) ? 'healthy' : 'degraded';
  return {
    network:'Bitcoin Mainnet',
    level,
    blocks,
    headers,
    bestBlockHash:chain.bestblockhash || null,
    difficulty:rpcNumber(chain.difficulty),
    verificationProgress:Number.isFinite(verificationProgress) ? verificationProgress : null,
    mempool:{ transactions:rpcNumber(mempool.size), vsize:rpcNumber(mempool.vsize), bytes:rpcNumber(mempool.bytes), totalFeeBtc:rpcNumber(mempool.total_fee) },
    feeSatVbyte:{ priority:satPerVbyte(results.get(3)), standard:satPerVbyte(results.get(4)), economy:satPerVbyte(results.get(5)) },
    networkHashrate:rpcNumber(results.get(6)),
    rpcLatencyMs:Date.now() - startedAt,
    sampledAt:Date.now(),
  };
}

function inputVbytes(address) {
  const lower = address.toLowerCase();
  if (lower.startsWith('bc1p')) return 58;
  if (lower.startsWith('bc1q')) return 68;
  if (address.startsWith('3')) return 91;
  return 148;
}

function payoutEstimate(address,utxos,feeSatVbyte,payoutBtc=0.01){
  const target=Math.max(1,Math.round(Number(payoutBtc||0)*100_000_000));
  const values=utxos.filter(item=>item?.status?.confirmed).map(item=>Number(item.value)).filter(value=>Number.isFinite(value)&&value>0).sort((a,b)=>b-a);
  let selected=0,total=0,fee=null;
  for(const value of values){
    selected+=1;total+=value;
    const vbytes=10+selected*inputVbytes(address)+68;
    fee=Number.isFinite(feeSatVbyte)?Math.ceil(vbytes*feeSatVbyte):null;
    if(total>=target+(fee||0))return{available:true,payoutSats:target,payoutBtc:(target/100_000_000).toFixed(8),inputs:selected,vbytes,feeSats:fee,totalDebitSats:fee===null?null:target+fee,changeSats:fee===null?null:total-target-fee};
  }
  return{available:false,payoutSats:target,payoutBtc:(target/100_000_000).toFixed(8),inputs:selected,vbytes:selected?10+selected*inputVbytes(address)+68:0,feeSats:fee,totalDebitSats:fee===null?null:target+fee,shortfallSats:Math.max(0,target+(fee||0)-total)};
}

function utxoHealth(address, utxos, feeSatVbyte, payoutBtc=0.01) {
  const values = utxos.map(item => Number(item.value)).filter(Number.isFinite);
  const totalSats = values.reduce((sum, value) => sum + value, 0);
  const confirmed = utxos.filter(item => item?.status?.confirmed).length;
  const dust = values.filter(value => value <= 546).length;
  const small = values.filter(value => value <= 10_000).length;
  const estimatedVbytes = values.length ? 10 + values.length * inputVbytes(address) + 34 : 0;
  const fee = Number.isFinite(feeSatVbyte) ? Math.ceil(estimatedVbytes * feeSatVbyte) : null;
  const level = dust > 0 || values.length > 50 ? 'attention' : values.length > 15 || small > 5 ? 'watch' : 'healthy';
  const recommendation = !values.length ? 'No spendable outputs' : level === 'attention' ? 'Consider consolidating when fees are low' : level === 'watch' ? 'Monitor fragmentation' : 'UTXO set is efficient';
  return {
    level,
    recommendation,
    count:values.length,
    confirmed,
    unconfirmed:values.length - confirmed,
    dust,
    small,
    totalSats,
    totalBtc:(totalSats / 100_000_000).toFixed(8),
    largestSats:values.length ? Math.max(...values) : 0,
    averageSats:values.length ? Math.round(totalSats / values.length) : 0,
    estimatedConsolidation:{ vbytes:estimatedVbytes, feeSats:fee, feeSatVbyte:Number.isFinite(feeSatVbyte) ? feeSatVbyte : null },
    estimatedPayout:payoutEstimate(address,utxos,feeSatVbyte,payoutBtc),
  };
}

async function fetchAddressUtxos(address) {
  const base = String(config.bitcoinIndexerUrl || '').replace(/\/$/, '');
  if (!/^https:\/\//.test(base)) throw new Error('Bitcoin UTXO indexer is not configured');
  const response = await fetch(`${base}/address/${encodeURIComponent(address)}/utxo`, { headers:{ Accept:'application/json' }, signal:AbortSignal.timeout(20_000) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body)) throw new Error(`Bitcoin UTXO indexer request failed (${response.status})`);
  return body.slice(0, 10_000);
}

async function fetchBitcoinWalletBalances(addresses, options={}) {
  const unique = [...new Set((addresses || []).map(value => String(value).trim()))];
  if (!unique.length || unique.length > 25 || unique.some(value => !validBitcoinAddress(value))) throw new Error('Enter 1–25 valid Bitcoin mainnet addresses');
  let feeSatVbyte = null;
  try {
    const result = await bitcoinRpc({ jsonrpc:'2.0', id:1, method:'estimatesmartfee', params:[6, 'conservative'] });
    feeSatVbyte = satPerVbyte(result.get(1));
  } catch { /* UTXO balances still work if the fee estimate is temporarily unavailable. */ }
  const wallets = await Promise.all(unique.map(async address => {
    const utxos = await fetchAddressUtxos(address);
    return { address, chainName:'Bitcoin Mainnet', balance:utxoHealth(address, utxos, feeSatVbyte,options.expectedPayoutBtc), utxos };
  }));
  return { updatedAt:Date.now(), network:'bitcoin-mainnet', wallets };
}

module.exports = { validBitcoinAddress, fetchBitcoinNetworkStatus, fetchBitcoinWalletBalances, utxoHealth, payoutEstimate };
