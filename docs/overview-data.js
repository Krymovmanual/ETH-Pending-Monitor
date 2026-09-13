(function attachTreasuryOverview(root) {
  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function accountValue(account, key) {
    const summaryValue = finite(account?.summary?.[key]);
    if (summaryValue !== null) return summaryValue;
    if (key !== 'equityUsd') return null;
    const values = (account?.assets || []).map(asset => finite(asset.usdValue)).filter(value => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }

  function summarize(data) {
    const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
    const exchanges = Array.isArray(data?.exchanges) ? data.exchanges : [];
    const positions = accounts.flatMap(account => Array.isArray(account.positions) ? account.positions : []);
    const warnings = Array.isArray(data?.warnings) ? data.warnings.filter(Boolean) : [];
    const sumKnown = key => {
      const values = accounts.map(account => accountValue(account, key)).filter(value => value !== null);
      return { value:values.length ? values.reduce((sum, value) => sum + value, 0) : null, count:values.length };
    };
    const equity = sumKnown('equityUsd');
    const available = sumKnown('availableUsd');
    const pnl = sumKnown('unrealisedPnl');
    const statusByExchange = new Map(exchanges.map(exchange => [exchange.id, exchange.status || 'connected']));
    const venueValues = new Map();
    const venueNames = new Map();
    for (const account of accounts) {
      const value = accountValue(account, 'equityUsd');
      if (value === null) continue;
      venueValues.set(account.exchangeId, (venueValues.get(account.exchangeId) || 0) + value);
      venueNames.set(account.exchangeId, account.exchangeName || account.exchangeId);
    }
    const allocation = [...venueValues].map(([id, value]) => ({ id, name:venueNames.get(id) || id, value }))
      .sort((left, right) => right.value - left.value);
    return {
      accounts,
      positions,
      warnings,
      exchangeCount:new Set(accounts.map(account => account.exchangeId).filter(Boolean)).size,
      equity,
      available,
      pnl,
      statusByExchange,
      allocation,
      updatedAt:finite(data?.updatedAt),
    };
  }

  const api = { finite, accountValue, summarize };
  root.TreasuryOverview = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
