const BACKEND_URL_KEY = 'eth-pending-monitor-backend-url';
const BACKEND_TOKEN_KEY = 'eth-pending-monitor-backend-token';
const SELECTION_KEY = 'treasury-exchange-selection';
const VIEW_KEY = 'treasury-exchange-view';
const REFRESH_MS = 30_000;

const state = {
  data: null,
  pendingData: null,
  selected: new Set(loadJson(SELECTION_KEY, [])),
  expanded: new Set(['bitget']),
  view: Treasury.storage.getItem(VIEW_KEY) === 'account' ? 'account' : 'consolidated',
  tab: 'assets',
  search: '',
  hideZero: true,
  loading: false,
  error: '',
  lastInteractionAt: 0,
  applyTimer: null,
};

const el = {
  tree: document.querySelector('#accountTree'),
  selectAll: document.querySelector('#selectAllAccounts'),
  connection: document.querySelector('#exchangeConnection'),
  connectionText: document.querySelector('#exchangeConnectionText'),
  refresh: document.querySelector('#exchangeRefreshButton'),
  scope: document.querySelector('#selectedScope'),
  updatedAt: document.querySelector('#exchangeUpdatedAt'),
  pendingUpdate: document.querySelector('#pendingExchangeUpdate'),
  error: document.querySelector('#exchangePageError'),
  warning: document.querySelector('#exchangePageWarning'),
  equity: document.querySelector('#totalExchangeEquity'),
  pnl: document.querySelector('#totalExchangePnl'),
  positions: document.querySelector('#totalOpenPositions'),
  positionValue: document.querySelector('#totalPositionValue'),
  accountCount: document.querySelector('#selectedAccountCount'),
  exchangeCount: document.querySelector('#selectedExchangeCount'),
  assetCount: document.querySelector('#assetCount'),
  positionCount: document.querySelector('#positionCount'),
  head: document.querySelector('#exchangeTableHead'),
  body: document.querySelector('#exchangeTableBody'),
  search: document.querySelector('#exchangeSearch'),
  hideZero: document.querySelector('#hideZeroAssets'),
  addDialog: document.querySelector('#addExchangeDialog'),
  addForm: document.querySelector('#addExchangeForm'),
  addError: document.querySelector('#addExchangeError'),
  addSubmit: document.querySelector('#submitAddExchange'),
};

function loadJson(key, fallback) {
  try { return JSON.parse(Treasury.storage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
}

function backendUrl() { return location.origin; }
function backendToken() { return ''; }
function backendConfigured() { return Boolean(window.Treasury?.user); }
function headers() { return {}; }

function money(value) {
  if (!Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits:2 }).format(Number(value));
}

function signedMoney(value) {
  if (!Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  return `${number > 0 ? '+' : ''}${money(number)}`;
}

function number(value, digits = 8) {
  if (!Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits:digits }).format(Number(value));
}

function age(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - Number(timestamp || 0)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function selectedAccounts() {
  return (state.data?.accounts || []).filter(account => state.selected.has(account.id));
}

function sumKnown(items, getter) {
  const values = items.map(getter).filter(value => Number.isFinite(Number(value))).map(Number);
  return { value: values.reduce((sum, value) => sum + value, 0), known: values.length > 0 };
}

function initializeSelection() {
  const validIds = new Set((state.data?.accounts || []).map(account => account.id));
  state.selected = new Set([...state.selected].filter(id => validIds.has(id)));
  if (!state.selected.size) state.selected = new Set(validIds);
  saveSelection();
}

function saveSelection() {
  Treasury.storage.setItem(SELECTION_KEY, JSON.stringify([...state.selected]));
}

function renderTree() {
  if (!state.data) {
    el.tree.innerHTML = '<div class="tree-loading">Waiting for exchange data…</div>';
    return;
  }
  const accounts = state.data.accounts || [];
  el.tree.innerHTML = (state.data.exchanges || []).map(exchange => {
    const children = accounts.filter(account => account.exchangeId === exchange.id);
    const selectedCount = children.filter(account => state.selected.has(account.id)).length;
    const open = state.expanded.has(exchange.id);
    return `<section class="tree-exchange">
      <div class="tree-row tree-parent">
        <button class="tree-caret" type="button" data-expand="${escapeHtml(exchange.id)}" aria-expanded="${open}">${open ? '▾' : '▸'}</button>
        <label><input type="checkbox" data-exchange="${escapeHtml(exchange.id)}" ${selectedCount === children.length && children.length ? 'checked' : ''}><span class="exchange-tree-mark">${escapeHtml(exchange.name.slice(0, 1))}</span><strong>${escapeHtml(exchange.name)}</strong></label>
        <span class="tree-status ${escapeHtml(exchange.status)}">${escapeHtml(exchange.status)}</span>
      </div>
      <div class="tree-children" ${open ? '' : 'hidden'}>${children.map(account => `<label class="tree-row tree-child"><span class="tree-spacer"></span><input type="checkbox" data-account="${escapeHtml(account.id)}" ${state.selected.has(account.id) ? 'checked' : ''}><span><strong>${escapeHtml(account.name)}</strong><small>${escapeHtml(account.type)}</small></span></label>`).join('')}</div>
    </section>`;
  }).join('') || '<div class="tree-loading">No connected exchange accounts.</div>';
  for (const input of el.tree.querySelectorAll('[data-exchange]')) {
    const children = accounts.filter(account => account.exchangeId === input.dataset.exchange);
    const count = children.filter(account => state.selected.has(account.id)).length;
    input.indeterminate = count > 0 && count < children.length;
  }
  el.selectAll.textContent = state.selected.size === accounts.length ? 'Clear' : 'Select all';
}

function aggregateAssets(accounts) {
  if (state.view === 'account') {
    return accounts.flatMap(account => (account.assets || []).map(asset => ({ ...asset, exchangeName:account.exchangeName, accountName:account.name, sources:1 })));
  }
  const grouped = new Map();
  for (const account of accounts) for (const asset of account.assets || []) {
    const key = String(asset.coin || '').toUpperCase();
    if (!grouped.has(key)) grouped.set(key, { coin:key, equity:0, available:0, locked:0, usdValue:0, usdKnown:false, accountIds:new Set(), exchanges:new Set() });
    const row = grouped.get(key);
    for (const field of ['equity', 'available', 'locked']) if (Number.isFinite(Number(asset[field]))) row[field] += Number(asset[field]);
    if (Number.isFinite(Number(asset.usdValue))) { row.usdValue += Number(asset.usdValue); row.usdKnown = true; }
    row.accountIds.add(account.id);
    row.exchanges.add(account.exchangeName);
  }
  return [...grouped.values()].map(row => ({ ...row, sources:row.accountIds.size, exchangeName:[...row.exchanges].join(', ') }));
}

function aggregatePositions(accounts) {
  const source = accounts.flatMap(account => (account.positions || []).map(position => ({ ...position, exchangeName:account.exchangeName, accountName:account.name })));
  if (state.view === 'account') return source;
  const grouped = new Map();
  for (const position of source) {
    const asset = String(position.baseAsset || position.symbol || '').toUpperCase();
    if (!grouped.has(asset)) grouped.set(asset, { asset, long:0, short:0, pnl:0, pnlKnown:false, count:0, exchanges:new Set() });
    const row = grouped.get(asset);
    const notional = Number(position.notional);
    if (Number.isFinite(notional)) row[position.side === 'short' ? 'short' : 'long'] += Math.abs(notional);
    const pnlUsd = position.unrealisedPnlUsd ?? position.unrealisedPnl;
    if (Number.isFinite(Number(pnlUsd))) { row.pnl += Number(pnlUsd); row.pnlKnown = true; }
    row.count += 1;
    row.exchanges.add(position.exchangeName);
  }
  return [...grouped.values()].map(row => ({ ...row, net:row.long - row.short, exchangeName:[...row.exchanges].join(', ') }));
}

function renderSummary(accounts) {
  const positions = accounts.flatMap(account => account.positions || []);
  const equity = sumKnown(accounts, account => account.summary?.equityUsd);
  const pnl = sumKnown(positions, position => position.unrealisedPnlUsd ?? position.unrealisedPnl);
  const positionValue = sumKnown(positions, position => position.notional);
  const exchanges = new Set(accounts.map(account => account.exchangeId));
  el.equity.textContent = equity.known ? money(equity.value) : '—';
  el.pnl.textContent = pnl.known ? signedMoney(pnl.value) : '—';
  el.pnl.className = pnl.value > 0 ? 'positive' : pnl.value < 0 ? 'negative' : '';
  el.positions.textContent = String(positions.length);
  el.positionValue.textContent = positionValue.known ? `${money(positionValue.value)} gross value` : 'No position value';
  el.accountCount.textContent = String(accounts.length);
  el.exchangeCount.textContent = `${exchanges.size} exchange${exchanges.size === 1 ? '' : 's'}`;
  el.scope.textContent = accounts.length ? accounts.map(account => `${account.exchangeName} ${account.name}`).join(' + ') : 'No accounts selected';
}

function renderAssets(accounts) {
  const rows = aggregateAssets(accounts).filter(row => {
    const queryMatch = !state.search || `${row.coin} ${row.exchangeName} ${row.accountName || ''}`.toLowerCase().includes(state.search);
    const nonZero = Number(row.equity) !== 0 || Number(row.available) !== 0 || Number(row.locked) !== 0 || Number(row.usdValue) !== 0;
    return queryMatch && (!state.hideZero || nonZero);
  }).sort((a, b) => Number(b.usdValue || b.equity || 0) - Number(a.usdValue || a.equity || 0));
  el.assetCount.textContent = String(rows.length);
  if (state.view === 'consolidated') {
    el.head.innerHTML = '<tr><th>Asset</th><th>Exchanges</th><th class="numeric">Total</th><th class="numeric">Available</th><th class="numeric">Locked</th><th class="numeric">USD value</th><th class="numeric">Accounts</th></tr>';
    el.body.innerHTML = rows.map(row => `<tr><td><strong>${escapeHtml(row.coin)}</strong></td><td>${escapeHtml(row.exchangeName)}</td><td class="numeric">${number(row.equity)}</td><td class="numeric">${number(row.available)}</td><td class="numeric">${number(row.locked)}</td><td class="numeric">${row.usdKnown ? money(row.usdValue) : '—'}</td><td class="numeric">${row.sources}</td></tr>`).join('') || '<tr><td colspan="7" class="exchange-page-empty">No assets match the selected scope.</td></tr>';
  } else {
    el.head.innerHTML = '<tr><th>Asset</th><th>Exchange</th><th>Account</th><th class="numeric">Equity</th><th class="numeric">Available</th><th class="numeric">Locked</th><th class="numeric">USD value</th></tr>';
    el.body.innerHTML = rows.map(row => `<tr><td><strong>${escapeHtml(row.coin)}</strong></td><td>${escapeHtml(row.exchangeName)}</td><td><span class="exchange-account-badge">${escapeHtml(row.accountName)}</span></td><td class="numeric">${number(row.equity)}</td><td class="numeric">${number(row.available)}</td><td class="numeric">${number(row.locked)}</td><td class="numeric">${Number.isFinite(Number(row.usdValue)) ? money(row.usdValue) : '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="exchange-page-empty">No assets match the selected scope.</td></tr>';
  }
}

function renderPositions(accounts) {
  const rows = aggregatePositions(accounts).filter(row => !state.search || `${row.asset || ''} ${row.symbol || ''} ${row.exchangeName || ''} ${row.accountName || ''}`.toLowerCase().includes(state.search));
  el.positionCount.textContent = String(accounts.flatMap(account => account.positions || []).length);
  if (state.view === 'consolidated') {
    el.head.innerHTML = '<tr><th>Asset</th><th>Exchanges</th><th class="numeric">Gross long</th><th class="numeric">Gross short</th><th class="numeric">Net exposure</th><th class="numeric">Unrealized PnL</th><th class="numeric">Positions</th></tr>';
    el.body.innerHTML = rows.map(row => `<tr><td><strong>${escapeHtml(row.asset)}</strong></td><td>${escapeHtml(row.exchangeName)}</td><td class="numeric positive">${money(row.long)}</td><td class="numeric negative">${money(row.short)}</td><td class="numeric ${row.net > 0 ? 'positive' : row.net < 0 ? 'negative' : ''}">${signedMoney(row.net)}</td><td class="numeric ${row.pnl > 0 ? 'positive' : row.pnl < 0 ? 'negative' : ''}">${row.pnlKnown ? signedMoney(row.pnl) : '—'}</td><td class="numeric">${row.count}</td></tr>`).join('') || '<tr><td colspan="7" class="exchange-page-empty">No open positions in the selected scope.</td></tr>';
  } else {
    el.head.innerHTML = '<tr><th>Market</th><th>Exchange / account</th><th>Side</th><th class="numeric">Size</th><th class="numeric">Leverage</th><th class="numeric">Entry</th><th class="numeric">Mark</th><th class="numeric">Liquidation</th><th class="numeric">PnL / ROI</th></tr>';
    el.body.innerHTML = rows.map(row => {
      const pnlUsd = row.unrealisedPnlUsd ?? row.unrealisedPnl;
      const rawPnl = Number.isFinite(Number(row.unrealisedPnl))
        ? `${number(row.unrealisedPnl)} ${escapeHtml(row.pnlCurrency || '')}`.trim()
        : '—';
      const roi = Number.isFinite(Number(row.profitRate)) ? `${number(Number(row.profitRate) * 100, 2)}%` : '—';
      return `<tr><td><strong>${escapeHtml(row.symbol)}</strong><small>${escapeHtml(String(row.category || '').replace('-FUTURES', ''))}</small></td><td>${escapeHtml(row.exchangeName)}<small>${escapeHtml(row.accountName)}</small></td><td><span class="position-side ${row.side === 'short' ? 'short' : 'long'}">${escapeHtml(row.side)}</span></td><td class="numeric">${number(row.size)}<small>${escapeHtml(row.sizeCurrency || row.baseAsset || '')}</small></td><td class="numeric">${number(row.leverage, 2)}×</td><td class="numeric">${number(row.entryPrice)}</td><td class="numeric">${number(row.markPrice)}</td><td class="numeric">${Number(row.liquidationPrice) > 0 ? number(row.liquidationPrice) : '—'}</td><td class="numeric ${Number(pnlUsd) > 0 ? 'positive' : Number(pnlUsd) < 0 ? 'negative' : ''}">${signedMoney(pnlUsd)}<small>${rawPnl} · ${roi}</small></td></tr>`;
    }).join('') || '<tr><td colspan="9" class="exchange-page-empty">No open positions in the selected scope.</td></tr>';
  }
}

function renderWarnings() {
  const warnings = Array.isArray(state.data?.warnings) ? state.data.warnings.filter(Boolean) : [];
  el.warning.hidden = !warnings.length;
  if (!warnings.length) {
    el.warning.replaceChildren();
    return;
  }
  const positionAccess = warnings.some(warning => /position|uta trade/i.test(warning));
  el.warning.innerHTML = `${positionAccess ? '<strong>Some position data is unavailable</strong><span>Keep the Bitget API key Read-only and enable Unified account → Trade, then refresh.</span>' : '<strong>Some exchange data is unavailable</strong>'}<details><summary>Technical details</summary><ul>${warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></details>`;
}

function render({ preserveScroll = true } = {}) {
  const scrollY = window.scrollY;
  const table = document.querySelector('.exchange-page-table-wrap');
  const tableTop = table?.scrollTop || 0;
  const tableLeft = table?.scrollLeft || 0;
  renderTree();
  const accounts = selectedAccounts();
  renderSummary(accounts);
  if (state.tab === 'assets') renderAssets(accounts); else renderPositions(accounts);
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === state.view));
  document.querySelectorAll('[data-tab]').forEach(button => {
    const active = button.dataset.tab === state.tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  el.hideZero.closest('label').hidden = state.tab !== 'assets';
  el.updatedAt.textContent = state.data?.updatedAt ? `Updated ${age(state.data.updatedAt)} · auto-refresh every 30 seconds` : 'Waiting for data';
  el.error.hidden = !state.error;
  el.error.textContent = state.error;
  renderWarnings();
  el.pendingUpdate.hidden = !state.pendingData;
  el.connection.classList.toggle('live', Boolean(state.data) && !state.error);
  el.connection.classList.toggle('error', Boolean(state.error));
  el.connectionText.textContent = state.error ? 'Update failed' : state.data ? 'Connected' : 'Connecting';
  el.refresh.disabled = state.loading || !backendConfigured();
  el.refresh.textContent = state.loading ? 'Refreshing…' : 'Refresh';
  if (preserveScroll && table) { table.scrollTop = tableTop; table.scrollLeft = tableLeft; }
  if (preserveScroll) requestAnimationFrame(() => window.scrollTo({ top:scrollY, behavior:'instant' }));
}

function applyData(data) {
  state.data = data;
  state.pendingData = null;
  initializeSelection();
  render();
}

function queueApplyAfterInteraction() {
  clearTimeout(state.applyTimer);
  state.applyTimer = setTimeout(() => {
    if (state.pendingData && Date.now() - state.lastInteractionAt >= 1200) applyData(state.pendingData);
  }, 1300);
}

async function loadData({ force = false } = {}) {
  if (state.loading || !backendConfigured()) {
    if (!backendConfigured()) state.error = 'Open Wallets → Connection settings and add the Railway URL and server access token.';
    render();
    return;
  }
  state.loading = true;
  if (force) state.error = '';
  render();
  try {
    const response = await fetch(`${backendUrl()}/api/exchanges/accounts${force ? '?refresh=1' : ''}`, { headers:headers(), cache:'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Exchange service returned ${response.status}`);
    state.error = '';
    if (!force && state.data && Date.now() - state.lastInteractionAt < 1500) {
      state.pendingData = body;
      queueApplyAfterInteraction();
      render();
    } else applyData(body);
  } catch (error) {
    state.error = error?.message || 'Exchange accounts are temporarily unavailable.';
    render();
  } finally {
    state.loading = false;
    render();
  }
}

el.tree.addEventListener('click', event => {
  const expand = event.target.closest('[data-expand]');
  if (!expand) return;
  const id = expand.dataset.expand;
  if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
  render();
});

el.tree.addEventListener('change', event => {
  const input = event.target;
  if (input.matches('[data-account]')) input.checked ? state.selected.add(input.dataset.account) : state.selected.delete(input.dataset.account);
  if (input.matches('[data-exchange]')) {
    for (const account of state.data?.accounts || []) if (account.exchangeId === input.dataset.exchange) input.checked ? state.selected.add(account.id) : state.selected.delete(account.id);
  }
  saveSelection();
  render();
});

el.selectAll.addEventListener('click', () => {
  const ids = (state.data?.accounts || []).map(account => account.id);
  state.selected = state.selected.size === ids.length ? new Set() : new Set(ids);
  saveSelection();
  render();
});

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  state.view = button.dataset.view;
  Treasury.storage.setItem(VIEW_KEY, state.view);
  render();
}));

document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
  state.tab = button.dataset.tab;
  render();
}));

el.search.addEventListener('input', () => { state.search = el.search.value.trim().toLowerCase(); render(); });
el.hideZero.addEventListener('change', () => { state.hideZero = el.hideZero.checked; render(); });
el.refresh.addEventListener('click', () => loadData({ force:true }));
el.pendingUpdate.addEventListener('click', () => state.pendingData && applyData(state.pendingData));

document.querySelector('#openAddExchange').addEventListener('click', () => {
  el.addError.textContent = '';
  el.addDialog.showModal();
  el.addForm.elements.name.focus();
});

function closeAddExchange() {
  if (el.addSubmit.disabled) return;
  el.addError.textContent = '';
  el.addDialog.close();
}

document.querySelector('#closeAddExchange').addEventListener('click', closeAddExchange);
document.querySelector('#cancelAddExchange').addEventListener('click', closeAddExchange);
el.addDialog.addEventListener('click', event => {
  if (event.target === el.addDialog) closeAddExchange();
});

el.addForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!el.addForm.reportValidity()) return;
  el.addSubmit.disabled = true;
  el.addSubmit.textContent = 'Verifying…';
  el.addError.textContent = '';
  try {
    const body = Object.fromEntries(new FormData(el.addForm));
    const response = await fetch('/api/connections', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Connection service returned ${response.status}`);
    el.addForm.reset();
    el.addDialog.close();
    await loadData({ force:true });
  } catch (error) {
    el.addError.textContent = error?.message || 'Could not add this exchange account.';
  } finally {
    el.addSubmit.disabled = false;
    el.addSubmit.textContent = 'Verify and add';
  }
});

for (const eventName of ['wheel', 'touchmove', 'pointerdown', 'keydown']) {
  document.addEventListener(eventName, () => { state.lastInteractionAt = Date.now(); queueApplyAfterInteraction(); }, { passive:true });
}

render({ preserveScroll:false });
loadData();
setInterval(loadData, REFRESH_MS);
setInterval(() => { if (state.data && !state.loading) render(); }, 10_000);
