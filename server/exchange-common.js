function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonZero(...values) {
  return values.some(value => Number.isFinite(Number(value)) && Number(value) !== 0);
}

function baseAsset(symbol) {
  const value = String(symbol || '').toUpperCase();
  return value.split(/[-_]/)[0]
    .replace(/(?:USDT|USDC|BUSD|USD)$/, '') || value;
}

function stablecoin(value) {
  return ['USD', 'USDT', 'USDC', 'BUSD', 'FDUSD', 'DAI'].includes(String(value || '').toUpperCase());
}

async function optional(label, work, warnings) {
  try { return await work(); }
  catch (error) {
    warnings.push(`${label}: ${String(error?.message || 'request failed').slice(0, 180)}`);
    return null;
  }
}

function account({ exchangeId, exchangeName, name, type, updatedAt, summary = {}, assets = [], positions = [] }) {
  return { id:`${exchangeId}:${type}`, exchangeId, exchangeName, name, type, status:'connected', updatedAt,
    summary:{ equityUsd:null, availableUsd:null, lockedUsd:null, unrealisedPnl:null, positionValue:null, ...summary }, assets, positions };
}

module.exports={numberOrNull,nonZero,baseAsset,stablecoin,optional,account};
