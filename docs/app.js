const DEFAULT_ADDRESS = '0xced92fa7f0797cbc851b48140ae218a0b0d41ce0';
const ENDPOINT_KEY = 'eth-pending-monitor-endpoint';
const ADDRESSES_KEY = 'eth-pending-monitor-addresses';
const LABELS_KEY = 'eth-pending-monitor-address-labels';
const EMAIL_KEY = 'eth-pending-monitor-email';
const TX_KEY = 'eth-pending-monitor-transactions';
const TOKEN_CACHE_KEY = 'eth-pending-monitor-token-cache';
const BALANCE_SETTINGS_KEY = 'eth-pending-monitor-balance-settings';
const WALLET_BALANCES_KEY = 'eth-pending-monitor-wallet-balances';
const GAS_BALANCE_KEY = 'eth-pending-monitor-gas-balance';
const GAS_ALERT_KEY = 'eth-pending-monitor-gas-alert-sent';
const PAGE_SIZE_KEY = 'eth-pending-monitor-page-size';
const NOTIFICATION_SETTINGS_KEY = 'eth-pending-monitor-notification-settings';
const SUMMARY_ALERTS_KEY = 'eth-pending-monitor-summary-alerts';
const BALANCE_TOKENS = [
  { symbol: 'USDT ERC-20', contract: '0xdac17f958d2ee523a2206206994597c13d831ec7', decimals: 6 },
  { symbol: 'USDC', contract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6 },
  { symbol: 'LINK', contract: '0x514910771af9ca656af840dff83e8264ecf986ca', decimals: 18 },
  { symbol: 'DAI', contract: '0x6b175474e89094c44da98b954eedeac495271d0f', decimals: 18 },
  { symbol: 'USDS', contract: '0xdc035d45d973e3ec169d2276ddab16f1e407384f', decimals: 18 },
];

const state = {
  ws: null,
  endpoint: localStorage.getItem(ENDPOINT_KEY) || '',
  addresses: loadAddresses(),
  addressLabels: loadAddressLabels(),
  email: localStorage.getItem(EMAIL_KEY) || '',
  notificationSettings: loadNotificationSettings(),
  summaryAlerts: loadStoredObject(SUMMARY_ALERTS_KEY),
  transactions: loadTransactions(),
  tokenCache: loadTokenCache(),
  balanceSettings: loadBalanceSettings(),
  walletBalances: loadStoredObject(WALLET_BALANCES_KEY),
  gasBalance: loadStoredObject(GAS_BALANCE_KEY),
  balanceLoading: false,
  gasLoading: false,
  balanceLoadError: '',
  gasLoadError: '',
  balanceTimer: null,
  gasTimer: null,
  alertTimer: null,
  currentGasPrice: null,
  copiedHash: null,
  reconnectTimer: null,
  manualClose: false,
  searchQuery: '',
  sortKey: 'age',
  sortDirection: 'asc',
  page: 1,
  pageSize: [25, 50, 100].includes(Number(localStorage.getItem(PAGE_SIZE_KEY))) ? Number(localStorage.getItem(PAGE_SIZE_KEY)) : 25,
};

const el = {
  badge: document.querySelector('#connectionBadge'),
  connectionText: document.querySelector('#connectionText'),
  addressList: document.querySelector('#addressList'),
  pendingCount: document.querySelector('#pendingCount'),
  confirmedCount: document.querySelector('#confirmedCount'),
  problemCount: document.querySelector('#problemCount'),
  lastEvent: document.querySelector('#lastEvent'),
  txBody: document.querySelector('#txBody'),
  emptyState: document.querySelector('#emptyState'),
  emptyMessage: document.querySelector('#emptyMessage'),
  filter: document.querySelector('#statusFilter'),
  search: document.querySelector('#transactionSearch'),
  pageSize: document.querySelector('#pageSize'),
  previousPage: document.querySelector('#previousPage'),
  nextPage: document.querySelector('#nextPage'),
  paginationInfo: document.querySelector('#paginationInfo'),
  pageIndicator: document.querySelector('#pageIndicator'),
  settingsButton: document.querySelector('#settingsButton'),
  notificationSettingsButton: document.querySelector('#notificationSettingsButton'),
  clearButton: document.querySelector('#clearButton'),
  dialog: document.querySelector('#settingsDialog'),
  form: document.querySelector('#settingsForm'),
  endpoint: document.querySelector('#endpointInput'),
  addresses: document.querySelector('#addressesInput'),
  email: document.querySelector('#emailInput'),
  testEmailButton: document.querySelector('#testEmailButton'),
  testEmailStatus: document.querySelector('#testEmailStatus'),
  notificationButton: document.querySelector('#notificationButton'),
  notificationStatus: document.querySelector('#notificationStatus'),
  error: document.querySelector('#dialogError'),
  walletBalancesBody: document.querySelector('#walletBalancesBody'),
  walletBalanceMeta: document.querySelector('#walletBalanceMeta'),
  refreshBalancesButton: document.querySelector('#refreshBalancesButton'),
  balanceSettingsButton: document.querySelector('#balanceSettingsButton'),
  gasSettingsButton: document.querySelector('#gasSettingsButton'),
  gasBalanceBody: document.querySelector('#gasBalanceBody'),
  gasBalanceMeta: document.querySelector('#gasBalanceMeta'),
  balanceDialog: document.querySelector('#balanceSettingsDialog'),
  balanceForm: document.querySelector('#balanceSettingsForm'),
  showBalances: document.querySelector('#showBalancesInput'),
  balanceInterval: document.querySelector('#balanceIntervalInput'),
  gasDialog: document.querySelector('#gasSettingsDialog'),
  gasForm: document.querySelector('#gasSettingsForm'),
  gasName: document.querySelector('#gasNameInput'),
  gasAddress: document.querySelector('#gasAddressInput'),
  gasThreshold: document.querySelector('#gasThresholdInput'),
  gasInterval: document.querySelector('#gasIntervalInput'),
  balanceError: document.querySelector('#balanceDialogError'),
  gasError: document.querySelector('#gasDialogError'),
  notificationDialog: document.querySelector('#notificationSettingsDialog'),
  notificationForm: document.querySelector('#notificationSettingsForm'),
  pendingAlerts: document.querySelector('#pendingAlertsInput'),
  pendingBrowser: document.querySelector('#pendingBrowserInput'),
  pendingEmail: document.querySelector('#pendingEmailInput'),
  blockerAlerts: document.querySelector('#blockerAlertsInput'),
  blockerBrowser: document.querySelector('#blockerBrowserInput'),
  blockerEmail: document.querySelector('#blockerEmailInput'),
  blockerIgnoreQuiet: document.querySelector('#blockerIgnoreQuietInput'),
  blockerMinutes: document.querySelector('#blockerMinutesInput'),
  blockerRepeat: document.querySelector('#blockerRepeatInput'),
  droppedAlerts: document.querySelector('#droppedAlertsInput'),
  droppedBrowser: document.querySelector('#droppedBrowserInput'),
  droppedEmail: document.querySelector('#droppedEmailInput'),
  droppedMinutes: document.querySelector('#droppedMinutesInput'),
  replacedAlerts: document.querySelector('#replacedAlertsInput'),
  replacedBrowser: document.querySelector('#replacedBrowserInput'),
  replacedEmail: document.querySelector('#replacedEmailInput'),
  gasAlerts: document.querySelector('#gasAlertsInput'),
  gasBrowser: document.querySelector('#gasBrowserInput'),
  gasEmail: document.querySelector('#gasEmailInput'),
  gasIgnoreQuiet: document.querySelector('#gasIgnoreQuietInput'),
  gasRepeat: document.querySelector('#gasRepeatInput'),
  pendingMinutes: document.querySelector('#pendingMinutesInput'),
  pendingRepeat: document.querySelector('#pendingRepeatInput'),
  alertCheckInterval: document.querySelector('#alertCheckIntervalInput'),
  quietHours: document.querySelector('#quietHoursInput'),
  quietStart: document.querySelector('#quietStartInput'),
  quietEnd: document.querySelector('#quietEndInput'),
  notificationError: document.querySelector('#notificationDialogError'),
  transactionDialog: document.querySelector('#transactionDialog'),
  transactionDetails: document.querySelector('#transactionDetails'),
  closeTransactionDialog: document.querySelector('#closeTransactionDialog'),
};

function loadAddresses() {
  try {
    const stored = JSON.parse(localStorage.getItem(ADDRESSES_KEY) || '[]');
    return Array.isArray(stored) && stored.length ? stored : [DEFAULT_ADDRESS];
  } catch { return [DEFAULT_ADDRESS]; }
}

function loadTransactions() {
  try {
    const stored = JSON.parse(localStorage.getItem(TX_KEY) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch { return []; }
}

function loadAddressLabels() {
  try { return JSON.parse(localStorage.getItem(LABELS_KEY) || '{}'); }
  catch { return {}; }
}

function loadTokenCache() {
  try { return JSON.parse(localStorage.getItem(TOKEN_CACHE_KEY) || '{}'); }
  catch { return {}; }
}

function loadStoredObject(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}'); }
  catch { return {}; }
}

function loadBalanceSettings() {
  const defaults = {
    enabled: true,
    balanceInterval: 3600000,
    gasName: 'Main Gas Station',
    gasAddress: '',
    gasThreshold: 0.1,
    gasInterval: 300000,
  };
  try { return {...defaults, ...JSON.parse(localStorage.getItem(BALANCE_SETTINGS_KEY) || '{}')}; }
  catch { return defaults; }
}

function loadNotificationSettings() {
  const defaultRules = {
    pending: {enabled:true, browser:true, email:true, afterMinutes:15, repeatMinutes:30},
    blocker: {enabled:true, browser:true, email:true, afterMinutes:0, repeatMinutes:30, ignoreQuiet:true},
    dropped: {enabled:true, browser:true, email:true, afterMinutes:30, repeatMinutes:0},
    replaced: {enabled:true, browser:true, email:true, afterMinutes:0, repeatMinutes:0},
    gasLow: {enabled:true, browser:true, email:true, afterMinutes:0, repeatMinutes:60, ignoreQuiet:true},
  };
  const defaults = {
    rules: defaultRules,
    checkIntervalSeconds: 10,
    quietHoursEnabled: false,
    quietStart: '22:00',
    quietEnd: '08:00',
  };
  try {
    const stored = JSON.parse(localStorage.getItem(NOTIFICATION_SETTINGS_KEY) || '{}');
    if (stored.rules) {
      return {...defaults, ...stored, rules:Object.fromEntries(Object.entries(defaultRules).map(([key, rule]) => [key, {...rule, ...(stored.rules[key] || {})}]))};
    }
    const browser = stored.browserEnabled !== false;
    const email = stored.emailEnabled !== false;
    return {
      ...defaults,
      checkIntervalSeconds: stored.checkIntervalSeconds || defaults.checkIntervalSeconds,
      quietHoursEnabled: Boolean(stored.quietHoursEnabled),
      quietStart: stored.quietStart || defaults.quietStart,
      quietEnd: stored.quietEnd || defaults.quietEnd,
      rules: {
        pending: {...defaultRules.pending, enabled:stored.pendingEnabled !== false, browser, email, afterMinutes:Number(stored.pendingMinutes) || 15, repeatMinutes:Number(stored.repeatMinutes) || 0},
        blocker: {...defaultRules.blocker, enabled:stored.blockerEnabled !== false, browser, email, repeatMinutes:Number(stored.repeatMinutes) || 0},
        dropped: {...defaultRules.dropped, enabled:stored.droppedEnabled !== false, browser, email},
        replaced: {...defaultRules.replaced, enabled:stored.replacedEnabled !== false, browser, email},
        gasLow: {...defaultRules.gasLow, enabled:stored.gasLowEnabled !== false, browser, email, repeatMinutes:Number(stored.repeatMinutes) || 0},
      },
    };
  }
  catch { return defaults; }
}

function saveTransactions() {
  state.transactions = state.transactions.slice(0, 500);
  localStorage.setItem(TX_KEY, JSON.stringify(state.transactions));
}

function parseAddressLines(value) {
  const addresses = [];
  const labels = {};
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.lastIndexOf('|');
    const address = (separator >= 0 ? trimmed.slice(separator + 1) : trimmed).trim().toLowerCase();
    const label = separator >= 0 ? trimmed.slice(0, separator).trim() : '';
    if (!addresses.includes(address)) addresses.push(address);
    if (label) labels[address] = label.slice(0, 60);
  }
  return { addresses, labels };
}

function validAddress(value) { return /^0x[a-f0-9]{40}$/.test(value); }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }

function setConnection(status, text) {
  el.badge.className = `connection ${status}`;
  el.connectionText.textContent = text;
  render();
}

function reconnect() {
  clearTimeout(state.reconnectTimer);
  if (state.ws) {
    state.manualClose = true;
    state.ws.close();
    state.ws = null;
  }
  setTimeout(connect, 50);
}

function connect() {
  clearTimeout(state.reconnectTimer);
  if (!state.endpoint) {
    setConnection('', 'Not connected');
    if (!el.dialog.open) openSettings();
    return;
  }

  state.manualClose = false;
  setConnection('', 'Connecting…');
  try { state.ws = new WebSocket(state.endpoint); }
  catch { setConnection('error', 'Invalid URL'); return; }

  state.ws.addEventListener('open', () => {
    setConnection('live', 'Live');
    state.ws.send(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_subscribe',
      params: ['alchemy_pendingTransactions', {
        fromAddress: state.addresses,
        toAddress: state.addresses,
        hashesOnly: false,
      }],
    }));
    updateGasPrice();
  });

  state.ws.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.error) {
      setConnection('error', message.error.message || 'Alchemy error');
      return;
    }
    const tx = message?.params?.result;
    if (tx?.hash) addTransaction(tx);
  });

  state.ws.addEventListener('close', () => {
    if (state.manualClose) return;
    setConnection('error', 'Connection lost');
    state.reconnectTimer = setTimeout(connect, 5000);
  });
  state.ws.addEventListener('error', () => setConnection('error', 'Connection error'));
}

function addTransaction(tx) {
  const hash = tx.hash.toLowerCase();
  if (state.transactions.some(item => item.hash === hash)) return;

  const from = (tx.from || '').toLowerCase();
  const to = (tx.to || '').toLowerCase();
  const nonce = hexToNumber(tx.nonce);
  const replaced = state.transactions.filter(item => item.status === 'pending' && item.from === from && item.nonce === nonce);
  for (const item of replaced) {
    item.status = 'replaced';
    item.replacedBy = hash;
    sendAlert(item, 'replaced');
  }

  const tokenTransfer = parseTokenTransfer(tx.input || tx.data || '0x');
  const matchedAddress = state.addresses.find(address => [from, to, tokenTransfer?.from, tokenTransfer?.recipient].includes(address)) || '';
  const record = {
    hash,
    from,
    to,
    matchedAddress,
    nonce,
    value: hexToEth(tx.value),
    maxFee: hexToGwei(tx.maxFeePerGas || tx.gasPrice),
    maxPriorityFee: hexToGwei(tx.maxPriorityFeePerGas),
    gasPrice: hexToGwei(tx.gasPrice),
    gasLimit: hexToNumber(tx.gas),
    tokenContract: tokenTransfer ? to : '',
    tokenRecipient: tokenTransfer?.recipient || '',
    rawTokenAmount: tokenTransfer?.rawAmount || '',
    tokenSymbol: tokenTransfer ? 'ERC-20' : '',
    tokenName: tokenTransfer ? 'ERC-20 Token' : '',
    tokenDecimals: null,
    method: tokenTransfer?.method || transactionMethod(tx.input || tx.data || '0x', tx.value),
    firstSeen: Date.now(),
    status: 'pending',
    alerts: {},
  };
  state.transactions.unshift(record);
  saveTransactions();
  render();
  if (record.tokenContract) hydrateTokenMetadata(record);
}

function parseTokenTransfer(input) {
  const data = String(input).replace(/^0x/, '').toLowerCase();
  if (data.startsWith('a9059cbb') && data.length >= 136) {
    return {
      method: 'transfer',
      recipient: `0x${data.slice(32, 72)}`,
      rawAmount: BigInt(`0x${data.slice(72, 136)}`).toString(),
    };
  }
  if (data.startsWith('23b872dd') && data.length >= 200) {
    return {
      method: 'transferFrom',
      from: `0x${data.slice(32, 72)}`,
      recipient: `0x${data.slice(96, 136)}`,
      rawAmount: BigInt(`0x${data.slice(136, 200)}`).toString(),
    };
  }
  return null;
}

function transactionMethod(input, value) {
  const data = String(input || '0x').toLowerCase();
  if (!data || data === '0x') return BigInt(value || '0x0') > 0n ? 'Native transfer' : 'Empty call';
  return `Contract call (${data.slice(0, 10)})`;
}

async function hydrateTokenMetadata(tx) {
  const contract = tx.tokenContract;
  let metadata = state.tokenCache[contract];
  if (!metadata && state.endpoint) {
    try {
      const endpoint = toHttpEndpoint(state.endpoint);
      const [symbolResult, nameResult, decimalsResult] = await Promise.allSettled([
        rpc(endpoint, 'eth_call', [{to: contract, data: '0x95d89b41'}, 'latest']),
        rpc(endpoint, 'eth_call', [{to: contract, data: '0x06fdde03'}, 'latest']),
        rpc(endpoint, 'eth_call', [{to: contract, data: '0x313ce567'}, 'latest']),
      ]);
      metadata = {
        symbol: symbolResult.status === 'fulfilled' ? decodeAbiString(symbolResult.value).slice(0, 24) : 'ERC-20',
        name: nameResult.status === 'fulfilled' ? decodeAbiString(nameResult.value).slice(0, 80) : 'ERC-20 Token',
        decimals: decimalsResult.status === 'fulfilled' ? hexToNumber(decimalsResult.value) : 18,
      };
      if (!metadata.symbol) metadata.symbol = 'ERC-20';
      if (!metadata.name) metadata.name = metadata.symbol;
      if (!Number.isInteger(metadata.decimals) || metadata.decimals < 0 || metadata.decimals > 255) metadata.decimals = 18;
      state.tokenCache[contract] = metadata;
      localStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify(state.tokenCache));
    } catch { return; }
  }
  if (!metadata) return;
  tx.tokenSymbol = metadata.symbol;
  tx.tokenName = metadata.name;
  tx.tokenDecimals = metadata.decimals;
  saveTransactions();
  render();
}

function decodeAbiString(value) {
  const data = String(value || '').replace(/^0x/, '');
  if (!data) return '';
  let textHex = data;
  if (data.length >= 128) {
    const length = Number.parseInt(data.slice(64, 128), 16);
    if (Number.isFinite(length) && length >= 0) textHex = data.slice(128, 128 + length * 2);
  } else if (data.length >= 64) {
    textHex = data.slice(0, 64).replace(/(00)+$/, '');
  }
  const bytes = textHex.match(/.{1,2}/g)?.map(byte => Number.parseInt(byte, 16)) || [];
  try { return new TextDecoder().decode(new Uint8Array(bytes)).replace(/\0/g, '').trim(); }
  catch { return ''; }
}

function formatTokenAmount(rawAmount, decimals) {
  try {
    const raw = BigInt(rawAmount || '0');
    if (!Number.isInteger(decimals)) return raw.toLocaleString('en-US');
    const divisor = 10n ** BigInt(decimals);
    const whole = raw / divisor;
    const fraction = (raw % divisor).toString().padStart(decimals, '0').replace(/0+$/, '').slice(0, 6);
    return `${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`;
  } catch { return '0'; }
}

function formatSignedTokenAmount(rawAmount, decimals) {
  try {
    const raw = BigInt(rawAmount || '0');
    const sign = raw > 0n ? '+' : raw < 0n ? '−' : '';
    return `${sign}${formatTokenAmount(raw < 0n ? -raw : raw, decimals)}`;
  } catch { return '0'; }
}

function transactionAmount(tx) {
  if (!tx.tokenContract) return `${compactNumber(tx.value)} ETH`;
  if (!Number.isInteger(tx.tokenDecimals)) return `Detecting… ${tx.tokenSymbol || 'ERC-20'}`;
  return `${formatTokenAmount(tx.rawTokenAmount, tx.tokenDecimals)} ${tx.tokenSymbol || 'ERC-20'}`;
}

function hydrateStoredTokens() {
  for (const tx of state.transactions) {
    if (tx.tokenContract && !Number.isInteger(tx.tokenDecimals)) hydrateTokenMetadata(tx);
  }
}

async function checkStatuses() {
  if (!state.endpoint) return;
  const pending = state.transactions.filter(tx => tx.status === 'pending');
  if (!pending.length) return;
  const httpEndpoint = toHttpEndpoint(state.endpoint);
  try {
    const payload = pending.map((tx, index) => ({ jsonrpc: '2.0', id: index + 1, method: 'eth_getTransactionReceipt', params: [tx.hash] }));
    const response = await fetch(httpEndpoint, { method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload) });
    const results = await response.json();
    let changed = false;
    for (const answer of results) {
      const tx = pending[answer.id - 1];
      if (!tx) continue;
      if (answer.result) {
        tx.status = answer.result.status === '0x1' ? 'confirmed' : 'failed';
        tx.blockNumber = hexToNumber(answer.result.blockNumber);
        changed = true;
      } else if (Date.now() - tx.firstSeen > notificationRule('dropped').afterMinutes * 60 * 1000) {
        const stillExists = await rpc(httpEndpoint, 'eth_getTransactionByHash', [tx.hash]);
        if (!stillExists) {
          tx.status = 'dropped';
          changed = true;
          sendAlert(tx, 'dropped');
        }
      }
    }
    if (changed) { saveTransactions(); render(); }
  } catch { /* The WebSocket badge remains the primary connection signal. */ }
}

async function updateGasPrice() {
  if (!state.endpoint) return;
  try {
    const result = await rpc(toHttpEndpoint(state.endpoint), 'eth_gasPrice', []);
    state.currentGasPrice = hexToGwei(result);
    render();
  } catch { /* Keep the last successful price. */ }
}

function needsBoost(tx) {
  return tx.status === 'pending' && state.currentGasPrice > 0 && tx.maxFee > 0 && tx.maxFee < state.currentGasPrice;
}

function queueInfo(tx) {
  if (tx.status !== 'pending' || !state.addresses.includes(tx.from)) return null;
  const related = state.transactions.filter(item => item.status === 'pending' && item.from === tx.from);
  const nonces = [...new Set(related.map(item => item.nonce))].sort((a, b) => a - b);
  if (nonces.length < 2) return null;
  const blockerNonce = nonces[0];
  if (tx.nonce === blockerNonce) return { role: 'blocker', blockerNonce, count: nonces.length - 1 };
  if (tx.nonce > blockerNonce) return { role: 'blocked', blockerNonce, count: nonces.length - 1 };
  return null;
}

function evaluateAlerts() {
  const pendingAfterMs = notificationRule('pending').afterMinutes * 60 * 1000;
  for (const tx of state.transactions) {
    tx.alerts ||= {};
    if (tx.status === 'dropped' || tx.status === 'replaced') sendAlert(tx, tx.status);
    const queue = queueInfo(tx);
    if (queue?.role === 'blocker' && Date.now() - tx.firstSeen >= notificationRule('blocker').afterMinutes * 60 * 1000) {
      sendAlert(tx, 'blocker', queue);
    }
  }
  evaluatePendingSummaries(pendingAfterMs);
  if (validAddress(state.balanceSettings.gasAddress) && (state.gasBalance.raw || state.gasBalance.raw === '0')) {
    const currentGasBalance = Number(formatTokenAmount(state.gasBalance.raw, 18).replace(/,/g, ''));
    if (currentGasBalance < Number(state.balanceSettings.gasThreshold)) sendGasAlert(currentGasBalance);
  }
}

function evaluatePendingSummaries(pendingAfterMs) {
  const groups = new Map();
  for (const tx of state.transactions) {
    if (tx.status !== 'pending' || Date.now() - tx.firstSeen < pendingAfterMs) continue;
    const wallet = tx.matchedAddress || tx.from || 'unknown';
    if (!groups.has(wallet)) groups.set(wallet, []);
    groups.get(wallet).push(tx);
  }
  let changed = false;
  for (const [wallet, transactions] of groups) sendPendingSummary(wallet, transactions);
  for (const wallet of Object.keys(state.summaryAlerts)) {
    if (!groups.has(wallet)) { delete state.summaryAlerts[wallet]; changed = true; }
  }
  if (changed) localStorage.setItem(SUMMARY_ALERTS_KEY, JSON.stringify(state.summaryAlerts));
}

async function sendPendingSummary(wallet, transactions) {
  const rule = notificationRule('pending');
  if (!rule.enabled || inQuietHours('pending') || !transactions.length) return;
  const sorted = [...transactions].sort((a, b) => a.nonce - b.nonce);
  const signature = sorted.map(tx => {
    const queue = queueInfo(tx);
    return `${tx.hash}:${needsBoost(tx) ? 'boost' : 'ok'}:${queue?.role || 'none'}:${queue?.count || 0}`;
  }).sort().join(',');
  const previous = state.summaryAlerts[wallet] || {};
  if (previous.signature === signature && !alertCanRepeat(previous.sentAt, 'stuck_summary')) return;
  const channels = activeAlertChannels('pending');
  if (!channels.browser && !channels.email) return;
  const blocker = sorted.find(tx => queueInfo(tx)?.role === 'blocker');
  const boostTransactions = sorted.filter(needsBoost);
  const actionable = blocker && needsBoost(blocker) ? blocker : boostTransactions[0];
  const primary = actionable || blocker || sorted[0];
  const count = transactions.length;
  const title = actionable
    ? `Boost required: ${shortHash(actionable.hash)}${queueInfo(actionable)?.role === 'blocker' ? ` is blocking ${queueInfo(actionable).count}` : ''}`
    : `${count} transaction${count === 1 ? '' : 's'} pending for ${rule.afterMinutes}+ minutes`;
  const cause = blocker
    ? `TX ${blocker.hash} (nonce ${blocker.nonce}) is blocking ${queueInfo(blocker).count}; ${needsBoost(blocker) ? `boost required — max fee ${compactNumber(blocker.maxFee, 2)} vs network ${compactNumber(state.currentGasPrice, 2)} Gwei` : 'fee looks sufficient, cause unknown'}.`
    : boostTransactions.length
      ? `${boostTransactions.length} transaction${boostTransactions.length === 1 ? '' : 's'} need a boost.`
      : 'Fees look sufficient; cause unknown.';
  const browserCause = blocker
    ? `${actionable === blocker ? 'Blocking' : `${shortHash(blocker.hash)} is blocking`} ${queueInfo(blocker).count}; ${needsBoost(blocker) ? 'boost required' : 'fee looks sufficient'}.`
    : boostTransactions.length ? `${boostTransactions.length} need a boost.` : 'Fees look sufficient.';
  const bodyText = actionable
    ? `${walletLabel(wallet)} · ${shortHash(actionable.hash)} · nonce ${actionable.nonce} · ${browserCause}`
    : `${walletLabel(wallet)}: ${count} pending. ${browserCause}`;
  state.summaryAlerts[wallet] = {signature, sentAt:Date.now()};
  localStorage.setItem(SUMMARY_ALERTS_KEY, JSON.stringify(state.summaryAlerts));
  let browserDelivered = false;
  if (channels.browser) {
    try {
      const notification = new Notification(title, {body:bodyText, tag:`pending-summary-${wallet}`, requireInteraction:Boolean(blocker)});
      notification.onclick = () => window.open(`https://etherscan.io/tx/${primary.hash}`, '_blank', 'noopener');
      browserDelivered = true;
    } catch { /* Browser support varies. */ }
  }
  if (channels.email) {
    const emailSubject = actionable
      ? `Boost required: TX ${actionable.hash}${queueInfo(actionable)?.role === 'blocker' ? ` is blocking ${queueInfo(actionable).count} transactions` : ''}`
      : title;
    try { await sendEmail(state.email, emailSubject, primary, 'stuck_summary', {count, transactions, blocker, boostTransactions, cause}); }
    catch {
      if (!browserDelivered) delete state.summaryAlerts[wallet];
      localStorage.setItem(SUMMARY_ALERTS_KEY, JSON.stringify(state.summaryAlerts));
    }
  }
}

function ruleNameForKind(kind) {
  return ({stuck:'pending', stuck_summary:'pending', blocker:'blocker', dropped:'dropped', replaced:'replaced', gasLow:'gasLow'})[kind] || kind;
}

function notificationRule(kind) {
  return state.notificationSettings.rules[ruleNameForKind(kind)] || {enabled:false, browser:false, email:false, afterMinutes:0, repeatMinutes:0};
}

function inQuietHours(kind) {
  const settings = state.notificationSettings;
  const rule = notificationRule(kind);
  if (rule.ignoreQuiet || !settings.quietHoursEnabled || settings.quietStart === settings.quietEnd) return false;
  const toMinutes = value => {
    const [hours, minutes] = String(value || '00:00').split(':').map(Number);
    return hours * 60 + minutes;
  };
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const start = toMinutes(settings.quietStart);
  const end = toMinutes(settings.quietEnd);
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function alertCanRepeat(lastSent, kind = '') {
  if (!lastSent) return true;
  const repeatMinutes = Number(notificationRule(kind).repeatMinutes);
  return repeatMinutes > 0 && Date.now() - Number(lastSent) >= repeatMinutes * 60 * 1000;
}

function activeAlertChannels(kind) {
  const rule = notificationRule(kind);
  return {
    browser: Boolean(rule.browser && 'Notification' in window && Notification.permission === 'granted'),
    email: Boolean(rule.email && validEmail(state.email)),
  };
}

async function sendAlert(tx, kind, context = {}) {
  tx.alerts ||= {};
  const alertKey = kind === 'blocker' ? `blocker-${context.count}` : kind;
  const rule = notificationRule(kind);
  if (!rule.enabled || inQuietHours(kind) || !alertCanRepeat(tx.alerts[alertKey], kind)) return;
  const channels = activeAlertChannels(kind);
  if (!channels.browser && !channels.email) return;
  tx.alerts[alertKey] = Date.now();
  saveTransactions();

  const title = alertTitle(kind, tx, context);
  const wallet = walletLabel(tx.matchedAddress);
  const detail = kind === 'blocker'
    ? `${wallet} · ${shortHash(tx.hash)} · nonce ${tx.nonce} · blocking ${context.count} transaction${context.count === 1 ? '' : 's'}`
    : `${wallet}: ${shortHash(tx.hash)} · ${transactionAmount(tx)}`;
  let browserDelivered = false;
  if (channels.browser) {
    try {
      const notification = new Notification(title, { body: detail, tag: `${tx.hash}-${alertKey}`, requireInteraction: kind === 'blocker' });
      notification.onclick = () => window.open(`https://etherscan.io/tx/${tx.hash}`, '_blank', 'noopener');
      browserDelivered = true;
    } catch { /* Browser support varies. */ }
  }

  if (channels.email) {
    const emailTitle = kind === 'blocker' ? `URGENT: TX ${tx.hash} is blocking ${context.count} transactions` : title;
    try { await sendEmail(state.email, emailTitle, tx, kind, context); }
    catch {
      if (!browserDelivered) delete tx.alerts[alertKey];
      saveTransactions();
    }
  }
}

function alertTitle(kind, tx = null, context = {}) {
  if (kind === 'blocker') return `URGENT: ${shortHash(tx?.hash || '')} is blocking ${context.count || 0} transactions`;
  return ({
    stuck: `Transaction pending for ${notificationRule('pending').afterMinutes}+ minutes`,
    stuck_summary: `Transactions pending for ${notificationRule('pending').afterMinutes}+ minutes`,
    dropped: 'Transaction dropped',
    replaced: 'Transaction replaced',
    test: 'ETH Pending Monitor test alert',
  })[kind] || 'ETH transaction alert';
}

async function sendEmail(email, subject, tx, kind, context = {}) {
  const response = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(email)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      _subject: subject,
      _template: 'table',
      _captcha: 'false',
      event: kind,
      status: tx?.status || 'test',
      hash: tx?.hash || 'Test notification',
      monitored_wallet: tx?.matchedAddress ? walletLabel(tx.matchedAddress) : '—',
      monitored_address: tx?.matchedAddress || '—',
      from: tx?.from || '—',
      to: tx?.to || '—',
      amount: tx ? transactionAmount(tx) : '—',
      token: tx?.tokenContract ? `${tx.tokenName || 'ERC-20 Token'} (${tx.tokenSymbol || 'ERC-20'})` : 'Ether (ETH)',
      token_contract: tx?.tokenContract || '—',
      nonce: tx?.nonce ?? '—',
      blocking_transactions: kind === 'blocker' ? context.count : '—',
      blocking_cause: kind === 'blocker' ? (needsBoost(tx) ? 'Transaction fee is below the current network gas price' : 'Unknown — fee is not below the current network gas price') : '—',
      pending_transactions: kind === 'stuck_summary' ? context.count : '—',
      pending_hashes: kind === 'stuck_summary' ? context.transactions.map(item => item.hash).join(', ') : '—',
      pending_summary: kind === 'stuck_summary' ? context.cause : '—',
      boost_required_tx_hashes: kind === 'stuck_summary' && context.boostTransactions?.length ? context.boostTransactions.map(item => item.hash).join(', ') : 'None',
      boost_required_details: kind === 'stuck_summary' && context.boostTransactions?.length ? context.boostTransactions.map(item => `${item.hash} | nonce ${item.nonce} | max fee ${compactNumber(item.maxFee, 2)} Gwei`).join('; ') : 'None',
      transaction_max_fee: tx ? `${compactNumber(tx.maxFee, 2)} Gwei` : '—',
      current_network_gas: state.currentGasPrice ? `${compactNumber(state.currentGasPrice, 2)} Gwei` : 'Unavailable',
      first_seen: tx ? new Date(tx.firstSeen).toISOString() : new Date().toISOString(),
      etherscan: tx ? `https://etherscan.io/tx/${tx.hash}` : '—',
    }),
  });
  let body = {};
  try { body = await response.json(); } catch { /* HTTP status is checked below. */ }
  if (!response.ok || body.success === false) throw new Error(body.message || 'Email service rejected the request');
}

async function sendTestEmail() {
  const email = el.email.value.trim();
  if (!validEmail(email)) {
    showTestStatus('Enter a valid email address.', true);
    return;
  }
  el.testEmailButton.disabled = true;
  showTestStatus('Sending…');
  try {
    await sendEmail(email, alertTitle('test'), null, 'test');
    state.email = email;
    localStorage.setItem(EMAIL_KEY, email);
    showTestStatus('Sent. Check your inbox and confirm the address if requested.');
  } catch (error) {
    showTestStatus(error.message || 'Could not send the test email.', true);
  } finally {
    el.testEmailButton.disabled = false;
  }
}

async function enableNotifications() {
  if (!('Notification' in window)) {
    el.notificationStatus.textContent = 'This browser does not support notifications.';
    return;
  }
  const permission = await Notification.requestPermission();
  updateNotificationStatus(permission);
  if (permission === 'granted') new Notification('ETH Pending Monitor', { body: 'Browser notifications are enabled.' });
}

function updateNotificationStatus(permission = ('Notification' in window ? Notification.permission : 'unsupported')) {
  const messages = {
    granted: 'Browser notifications are enabled. Keep this page open to receive them.',
    denied: 'Notifications are blocked. Allow them in your browser site settings.',
    default: 'Click the button to allow browser notifications.',
    unsupported: 'This browser does not support notifications.',
  };
  el.notificationStatus.textContent = messages[permission] || messages.default;
  el.notificationButton.textContent = permission === 'granted' ? 'Browser notifications enabled' : 'Enable browser notifications';
  el.notificationButton.disabled = permission === 'granted';
}

async function rpc(endpoint, method, params) {
  const response = await fetch(endpoint, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({jsonrpc:'2.0', id:1, method, params}) });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error?.message || `RPC ${method} failed`);
  return body.result;
}

async function rpcBatch(requests) {
  const endpoint = toHttpEndpoint(state.endpoint);
  const answers = new Map();
  for (let start = 0; start < requests.length; start += 100) {
    const chunk = requests.slice(start, start + 100);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify(chunk.map(item => ({jsonrpc:'2.0', ...item}))),
    });
    const body = await response.json();
    if (!response.ok || !Array.isArray(body)) throw new Error('Balance request failed');
    for (const answer of body) answers.set(answer.id, answer);
  }
  return answers;
}

function balanceOfData(address) {
  return `0x70a08231${address.slice(2).padStart(64, '0')}`;
}

async function updateWalletBalances() {
  if (!state.endpoint || !state.balanceSettings.enabled || state.balanceLoading) return;
  state.balanceLoading = true;
  state.balanceLoadError = '';
  renderBalances();
  try {
    let id = 1;
    const requests = [];
    const fields = [];
    for (const address of state.addresses) {
      requests.push({id, method:'eth_getBalance', params:[address, 'latest']});
      fields.push({id, address, symbol:'ETH', decimals:18});
      id += 1;
      for (const token of BALANCE_TOKENS) {
        requests.push({id, method:'eth_call', params:[{to:token.contract, data:balanceOfData(address)}, 'latest']});
        fields.push({id, address, symbol:token.symbol, decimals:token.decimals});
        id += 1;
      }
    }
    const answers = await rpcBatch(requests);
    const updatedAt = Date.now();
    const next = {};
    for (const address of state.addresses) next[address] = {updatedAt, tokens:{}};
    for (const field of fields) {
      const answer = answers.get(field.id);
      const raw = answer?.result ? BigInt(answer.result).toString() : null;
      next[field.address].tokens[field.symbol] = {raw, decimals:field.decimals};
    }
    state.walletBalances = next;
    localStorage.setItem(WALLET_BALANCES_KEY, JSON.stringify(next));
  } catch {
    state.balanceLoadError = 'Update failed. Try again.';
  } finally {
    state.balanceLoading = false;
    renderBalances();
  }
}

async function updateGasBalance() {
  const settings = state.balanceSettings;
  if (!state.endpoint || !validAddress(settings.gasAddress) || state.gasLoading) return;
  state.gasLoading = true;
  state.gasLoadError = '';
  renderBalances();
  try {
    const result = await rpc(toHttpEndpoint(state.endpoint), 'eth_getBalance', [settings.gasAddress, 'latest']);
    const raw = BigInt(result).toString();
    const previousRaw = state.gasBalance.raw;
    const changeRaw = previousRaw !== undefined && previousRaw !== null ? (BigInt(raw) - BigInt(previousRaw)).toString() : null;
    state.gasBalance = {raw, decimals:18, updatedAt:Date.now(), changeRaw};
    localStorage.setItem(GAS_BALANCE_KEY, JSON.stringify(state.gasBalance));
    const current = Number(formatTokenAmount(state.gasBalance.raw, 18).replace(/,/g, ''));
    if (current < Number(settings.gasThreshold)) await sendGasAlert(current);
    else localStorage.removeItem(GAS_ALERT_KEY);
  } catch {
    state.gasLoadError = 'Update failed. Try again.';
  } finally {
    state.gasLoading = false;
    renderBalances();
  }
}

async function sendGasAlert(currentBalance) {
  const lastSent = Number(localStorage.getItem(GAS_ALERT_KEY) || 0);
  const rule = notificationRule('gasLow');
  if (!rule.enabled || inQuietHours('gasLow') || !alertCanRepeat(lastSent, 'gasLow')) return;
  const channels = activeAlertChannels('gasLow');
  if (!channels.browser && !channels.email) return;
  localStorage.setItem(GAS_ALERT_KEY, String(Date.now()));
  const settings = state.balanceSettings;
  const title = 'URGENT: Gas Station balance is low';
  const bodyText = `${settings.gasName}: ${compactNumber(currentBalance, 6)} ETH. Minimum: ${compactNumber(settings.gasThreshold, 6)} ETH.`;
  let browserDelivered = false;
  if (channels.browser) {
    try { new Notification(title, {body:bodyText, tag:'gas-station-low', requireInteraction:true}); browserDelivered = true; }
    catch { /* Browser support varies. */ }
  }
  if (!channels.email) return;
  try {
    const response = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(state.email)}`, {
      method:'POST',
      headers:{'Content-Type':'application/json', Accept:'application/json'},
      body:JSON.stringify({
        _subject:title,
        _template:'table',
        _captcha:'false',
        event:'gas_station_low_balance',
        gas_station:settings.gasName,
        address:settings.gasAddress,
        current_balance:`${compactNumber(currentBalance, 6)} ETH`,
        minimum_balance:`${compactNumber(settings.gasThreshold, 6)} ETH`,
        checked_at:new Date().toISOString(),
      }),
    });
    if (!response.ok) throw new Error('Email failed');
  } catch {
    if (!browserDelivered) localStorage.removeItem(GAS_ALERT_KEY);
  }
}

function intervalLabel(value) {
  return ({0:'Manual only',300000:'Every 5 min',900000:'Every 15 min',1800000:'Every 30 min',3600000:'Every 1 hour',21600000:'Every 6 hours'})[Number(value)] || 'Custom';
}

function isRefreshDue(updatedAt, interval) {
  return Number(interval) > 0 && (!updatedAt || Date.now() - updatedAt >= Number(interval));
}

function scheduleBalanceRefresh(force = false) {
  clearInterval(state.balanceTimer);
  clearInterval(state.gasTimer);
  const settings = state.balanceSettings;
  if (settings.enabled) {
    if (Number(settings.balanceInterval) > 0) state.balanceTimer = setInterval(updateWalletBalances, Number(settings.balanceInterval));
    const latest = Math.max(0, ...Object.values(state.walletBalances).map(item => item?.updatedAt || 0));
    if (force || isRefreshDue(latest, settings.balanceInterval)) updateWalletBalances();
  }
  if (validAddress(settings.gasAddress)) {
    if (Number(settings.gasInterval) > 0) state.gasTimer = setInterval(updateGasBalance, Number(settings.gasInterval));
    if (force || isRefreshDue(state.gasBalance.updatedAt, settings.gasInterval)) updateGasBalance();
  }
  renderBalances();
}

function toHttpEndpoint(value) { return value.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'); }
function hexToNumber(value) { return value ? Number.parseInt(value, 16) : 0; }
function hexToEth(value) { return value ? Number(BigInt(value)) / 1e18 : 0; }
function hexToGwei(value) { return value ? Number(BigInt(value)) / 1e9 : 0; }
function shortHash(hash) { return `${hash.slice(0, 8)}…${hash.slice(-6)}`; }
function shortAddress(address) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }
function walletLabel(address) { return state.addressLabels[address] || (address ? shortAddress(address) : 'Unknown wallet'); }
function compactNumber(value, digits = 5) { return new Intl.NumberFormat('en-US', {maximumFractionDigits: digits}).format(value); }
function age(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
function dateTime(timestamp) { return new Intl.DateTimeFormat('en-GB', {hour:'2-digit', minute:'2-digit', second:'2-digit'}).format(timestamp); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character])); }

async function copyHash(hash) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(hash);
    } else {
      const helper = document.createElement('textarea');
      helper.value = hash;
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.appendChild(helper);
      helper.select();
      document.execCommand('copy');
      helper.remove();
    }
    state.copiedHash = hash;
    render();
    const detailCopyButton = el.transactionDetails.querySelector(`[data-copy-hash="${hash}"]`);
    if (detailCopyButton) detailCopyButton.textContent = 'Copied';
    setTimeout(() => {
      if (state.copiedHash === hash) {
        state.copiedHash = null;
        render();
        const resetButton = el.transactionDetails.querySelector(`[data-copy-hash="${hash}"]`);
        if (resetButton) resetButton.textContent = 'Copy hash';
      }
    }, 1600);
  } catch {
    alert('Could not copy the transaction hash.');
  }
}

function searchableTransactionText(tx) {
  const matched = tx.matchedAddress || state.addresses.find(address => [tx.from, tx.to, tx.tokenRecipient].includes(address)) || '';
  return [tx.hash, tx.nonce, tx.from, tx.to, matched, walletLabel(matched), tx.tokenSymbol, tx.tokenName, tx.tokenContract, transactionAmount(tx), statusLabel(tx.status)]
    .filter(value => value !== undefined && value !== null)
    .join(' ')
    .toLowerCase();
}

function amountSortValue(tx) {
  if (!tx.tokenContract) return Number(tx.value) || 0;
  if (!Number.isInteger(tx.tokenDecimals)) return 0;
  return Number(tx.rawTokenAmount || 0) / (10 ** tx.tokenDecimals);
}

function sortTransactions(items) {
  const statusOrder = {pending:0, replaced:1, dropped:2, failed:3, confirmed:4};
  return items.map((tx, index) => ({tx, index})).sort((left, right) => {
    const a = left.tx;
    const b = right.tx;
    let comparison = 0;
    if (state.sortKey === 'age') comparison = b.firstSeen - a.firstSeen;
    if (state.sortKey === 'amount') comparison = amountSortValue(a) - amountSortValue(b);
    if (state.sortKey === 'nonce') comparison = a.nonce - b.nonce;
    if (state.sortKey === 'maxFee') comparison = a.maxFee - b.maxFee;
    if (state.sortKey === 'status') comparison = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
    if (comparison === 0) comparison = left.index - right.index;
    return state.sortDirection === 'asc' ? comparison : -comparison;
  }).map(item => item.tx);
}

function updateSortHeaders() {
  document.querySelectorAll('[data-sort-column]').forEach(header => {
    const active = header.dataset.sortColumn === state.sortKey;
    header.setAttribute('aria-sort', active ? (state.sortDirection === 'asc' ? 'ascending' : 'descending') : 'none');
    const indicator = header.querySelector('.sort-indicator');
    if (indicator) indicator.textContent = active ? (state.sortDirection === 'asc' ? '↑' : '↓') : '↕';
  });
}

function render() {
  const pending = state.transactions.filter(tx => tx.status === 'pending').length;
  const confirmed = state.transactions.filter(tx => ['confirmed','failed'].includes(tx.status)).length;
  const problems = state.transactions.filter(tx => ['dropped','replaced'].includes(tx.status)).length;
  el.pendingCount.textContent = pending;
  el.confirmedCount.textContent = confirmed;
  el.problemCount.textContent = problems;
  el.lastEvent.textContent = state.transactions[0] ? dateTime(state.transactions[0].firstSeen) : '—';
  el.addressList.innerHTML = state.addresses.map(address => `<a class="address-chip" href="https://etherscan.io/address/${address}" target="_blank" rel="noreferrer" title="${address}">${escapeHtml(walletLabel(address))}</a>`).join('');

  const filter = el.filter.value;
  const query = state.searchQuery.trim().toLowerCase();
  const filtered = state.transactions.filter(tx => {
    if (filter === 'all') return true;
    if (filter === 'problem') return ['dropped','replaced'].includes(tx.status);
    if (filter === 'boost') return needsBoost(tx);
    return tx.status === filter;
  }).filter(tx => !query || searchableTransactionText(tx).includes(query));
  const visible = sortTransactions(filtered);
  const totalPages = Math.max(1, Math.ceil(visible.length / state.pageSize));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * state.pageSize;
  const pageTransactions = visible.slice(start, start + state.pageSize);
  el.txBody.innerHTML = pageTransactions.map(tx => {
    const outgoing = state.addresses.includes(tx.from);
    const matched = tx.matchedAddress || state.addresses.find(address => [tx.from, tx.to, tx.tokenRecipient].includes(address)) || '';
    const boost = needsBoost(tx);
    const queue = queueInfo(tx);
    const gasLabel = tx.status !== 'pending'
      ? '<span class="gas-check"><strong>—</strong></span>'
      : `<span class="gas-check ${boost ? 'boost' : ''}"><strong>${boost ? 'Boost recommended' : 'OK'}</strong><small>Network ${state.currentGasPrice ? `${compactNumber(state.currentGasPrice, 2)} Gwei` : '—'}</small></span>`;
    const queueLabel = queue?.role === 'blocker'
      ? `<span class="queue-state"><strong>Blocking ${queue.count} transaction${queue.count === 1 ? '' : 's'}</strong><small>Nonce ${queue.blockerNonce}${boost ? ' · Low fee' : ' · Cause unknown'}</small></span>`
      : queue?.role === 'blocked'
        ? `<span class="queue-state blocked"><strong>Blocked</strong><small>By nonce ${queue.blockerNonce}</small></span>`
        : '—';
    return `<tr class="transaction-row" data-tx-hash="${tx.hash}" tabindex="0" aria-label="Open details for transaction ${tx.hash}">
      <td><span class="status ${escapeHtml(tx.status)}">${escapeHtml(statusLabel(tx.status))}</span></td>
      <td>${age(tx.firstSeen)}</td>
      <td><div class="hash-cell"><a class="hash" href="https://etherscan.io/tx/${tx.hash}" target="_blank" rel="noreferrer">${shortHash(tx.hash)}</a><button class="copy-button" type="button" data-copy-hash="${tx.hash}" aria-label="Copy full transaction hash">${state.copiedHash === tx.hash ? 'Copied' : 'Copy'}</button></div></td>
      <td title="${escapeHtml(matched)}">${matched ? escapeHtml(walletLabel(matched)) : '—'}</td>
      <td>${outgoing ? 'Outgoing' : 'Incoming'}</td>
      <td title="${escapeHtml(tx.tokenName || 'Ether')}">${escapeHtml(transactionAmount(tx))}</td>
      <td>${tx.nonce}</td>
      <td>${queueLabel}</td>
      <td>${compactNumber(tx.maxFee, 2)} Gwei</td>
      <td>${gasLabel}</td>
    </tr>`;
  }).join('');
  el.emptyState.classList.toggle('hidden', filtered.length > 0);
  el.emptyMessage.textContent = query ? 'No transactions match your search.' : state.endpoint ? 'Connection active. New events will appear here.' : 'Configure the Alchemy connection to start monitoring.';
  el.paginationInfo.textContent = visible.length ? `${start + 1}–${Math.min(start + state.pageSize, visible.length)} of ${visible.length}` : '0 transactions';
  el.pageIndicator.textContent = `Page ${state.page} of ${totalPages}`;
  el.previousPage.disabled = state.page <= 1;
  el.nextPage.disabled = state.page >= totalPages;
  el.pageSize.value = String(state.pageSize);
  updateSortHeaders();
  renderBalances();
}

function transactionMethodLabel(tx) {
  if (tx.method) return tx.method;
  if (tx.tokenContract) return 'transfer';
  return tx.value > 0 ? 'Native transfer' : 'Contract call';
}

function detailRow(label, value, className = '') {
  return `<div class="transaction-detail"><dt>${escapeHtml(label)}</dt><dd class="${className}">${escapeHtml(value ?? '—')}</dd></div>`;
}

function openTransactionDetails(hash) {
  const tx = state.transactions.find(item => item.hash === hash);
  if (!tx) return;
  const matched = tx.matchedAddress || state.addresses.find(address => [tx.from, tx.to, tx.tokenRecipient].includes(address)) || '';
  const queue = queueInfo(tx);
  const queueText = queue?.role === 'blocker'
    ? `Blocking ${queue.count} transaction${queue.count === 1 ? '' : 's'}`
    : queue?.role === 'blocked' ? `Blocked by nonce ${queue.blockerNonce}` : '—';
  const contract = tx.tokenContract || (transactionMethodLabel(tx).startsWith('Contract call') ? tx.to : '—');
  el.transactionDetails.innerHTML = `
    <div class="detail-status"><span class="status ${escapeHtml(tx.status)}">${escapeHtml(statusLabel(tx.status))}</span></div>
    <dl>
      ${detailRow('Wallet', matched ? `${walletLabel(matched)} · ${matched}` : '—', 'wrap-value')}
      ${detailRow('Transaction hash', tx.hash, 'mono wrap-value')}
      ${detailRow('From', tx.from || '—', 'mono wrap-value')}
      ${detailRow('To', tx.to || 'Contract creation', 'mono wrap-value')}
      ${detailRow('Contract', contract, 'mono wrap-value')}
      ${detailRow('Token recipient', tx.tokenRecipient || '—', 'mono wrap-value')}
      ${detailRow('Method', transactionMethodLabel(tx))}
      ${detailRow('Amount / token', transactionAmount(tx))}
      ${detailRow('Nonce', tx.nonce)}
      ${detailRow('Queue', queueText)}
      ${detailRow('Transaction max fee', `${compactNumber(tx.maxFee, 4)} Gwei`)}
      ${detailRow('Max priority fee', tx.maxPriorityFee ? `${compactNumber(tx.maxPriorityFee, 4)} Gwei` : '—')}
      ${detailRow('Legacy gas price', tx.gasPrice ? `${compactNumber(tx.gasPrice, 4)} Gwei` : '—')}
      ${detailRow('Gas limit', tx.gasLimit ? compactNumber(tx.gasLimit, 0) : '—')}
      ${detailRow('Current network gas', state.currentGasPrice ? `${compactNumber(state.currentGasPrice, 4)} Gwei` : 'Unavailable')}
      ${detailRow('Replacement hash', tx.replacedBy || '—', 'mono wrap-value')}
      ${detailRow('First seen', new Date(tx.firstSeen).toLocaleString('en-GB'))}
    </dl>
    <div class="transaction-detail-actions">
      <button class="primary" type="button" data-copy-hash="${tx.hash}">${state.copiedHash === tx.hash ? 'Copied' : 'Copy hash'}</button>
    </div>`;
  el.transactionDialog.showModal();
}

function renderBalances() {
  const settings = state.balanceSettings;
  el.refreshBalancesButton.disabled = state.balanceLoading || !settings.enabled;
  el.refreshBalancesButton.textContent = state.balanceLoading ? 'Refreshing…' : 'Refresh now';

  if (!settings.enabled) {
    el.walletBalanceMeta.textContent = 'Balance display is disabled';
    el.walletBalancesBody.innerHTML = '<div class="balance-empty">Enable wallet balances in Settings.</div>';
  } else {
    const latest = Math.max(0, ...Object.values(state.walletBalances).map(item => item?.updatedAt || 0));
    el.walletBalanceMeta.textContent = state.balanceLoadError || `${latest ? `Updated ${age(latest)} ago` : 'Not updated yet'} · ${intervalLabel(settings.balanceInterval)}`;
    el.walletBalancesBody.innerHTML = state.addresses.map(address => {
      const balance = state.walletBalances[address];
      const symbols = ['ETH', ...BALANCE_TOKENS.map(token => token.symbol)];
      const tokens = symbols.map(symbol => {
        const value = balance?.tokens?.[symbol];
        const formatted = value?.raw !== null && value?.raw !== undefined ? formatTokenAmount(value.raw, value.decimals) : '—';
        return `<div class="token-balance" title="${escapeHtml(symbol)}"><span>${escapeHtml(symbol)}</span><strong>${escapeHtml(formatted)}</strong></div>`;
      }).join('');
      return `<div class="wallet-balance-row"><div class="wallet-balance-title"><strong>${escapeHtml(walletLabel(address))}</strong><span>${shortAddress(address)}</span></div><div class="token-balances">${tokens}</div></div>`;
    }).join('');
  }

  if (!validAddress(settings.gasAddress)) {
    el.gasBalanceMeta.textContent = 'Not configured';
    el.gasBalanceBody.innerHTML = '<div class="balance-empty">Add a Gas Station address in Settings.</div>';
    return;
  }

  el.gasBalanceMeta.textContent = state.gasLoadError || `${state.gasBalance.updatedAt ? `Updated ${age(state.gasBalance.updatedAt)} ago` : 'Not updated yet'} · ${intervalLabel(settings.gasInterval)}`;
  if (!state.gasBalance.raw && state.gasBalance.raw !== '0') {
    el.gasBalanceBody.innerHTML = `<div class="balance-empty">${state.gasLoading ? 'Refreshing ETH balance…' : 'No balance data yet.'}<br><button class="secondary gas-refresh" type="button" data-refresh-gas>Refresh now</button></div>`;
    return;
  }
  const formatted = formatTokenAmount(state.gasBalance.raw, 18);
  const current = Number(formatted.replace(/,/g, ''));
  const low = current < Number(settings.gasThreshold);
  const changeRaw = state.gasBalance.changeRaw;
  const changeClass = changeRaw === null || changeRaw === undefined || BigInt(changeRaw) === 0n ? 'neutral' : BigInt(changeRaw) > 0n ? 'positive' : 'negative';
  const changeText = changeRaw === null || changeRaw === undefined
    ? 'Change will appear after the next refresh'
    : BigInt(changeRaw) === 0n ? 'No change since last refresh' : `ETH ${formatSignedTokenAmount(changeRaw, 18)} since last refresh`;
  el.gasBalanceBody.innerHTML = `
    <div class="gas-name">${escapeHtml(settings.gasName || 'Gas Station')}</div>
    <div class="gas-address">${escapeHtml(shortAddress(settings.gasAddress))}</div>
    <div class="gas-amount">${escapeHtml(formatted)} ETH</div>
    <div class="gas-change ${changeClass}">${escapeHtml(changeText)}</div>
    <div class="gas-minimum">Minimum required: ${compactNumber(settings.gasThreshold, 6)} ETH</div>
    <div class="gas-status ${low ? 'low' : ''}">${low ? 'Low balance · Refill required' : 'Balance is sufficient'}</div>
    <button class="secondary gas-refresh" type="button" data-refresh-gas ${state.gasLoading ? 'disabled' : ''}>${state.gasLoading ? 'Refreshing…' : 'Refresh now'}</button>`;
}

function statusLabel(status) {
  return ({pending:'Pending', confirmed:'Confirmed', failed:'Failed', dropped:'Dropped', replaced:'Replaced'})[status] || status;
}

function openSettings() {
  el.endpoint.value = state.endpoint;
  el.addresses.value = state.addresses.map(address => state.addressLabels[address] ? `${state.addressLabels[address]} | ${address}` : address).join('\n');
  el.error.textContent = '';
  el.dialog.showModal();
}

function showTestStatus(message, isError = false) {
  el.testEmailStatus.textContent = message;
  el.testEmailStatus.classList.toggle('error', isError);
}

function openNotificationSettings() {
  const settings = state.notificationSettings;
  const pending = notificationRule('pending');
  const blocker = notificationRule('blocker');
  const dropped = notificationRule('dropped');
  const replaced = notificationRule('replaced');
  const gasLow = notificationRule('gasLow');
  el.pendingAlerts.checked = Boolean(pending.enabled);
  el.pendingBrowser.checked = Boolean(pending.browser);
  el.pendingEmail.checked = Boolean(pending.email);
  el.pendingMinutes.value = pending.afterMinutes;
  el.pendingRepeat.value = String(pending.repeatMinutes);
  el.blockerAlerts.checked = Boolean(blocker.enabled);
  el.blockerBrowser.checked = Boolean(blocker.browser);
  el.blockerEmail.checked = Boolean(blocker.email);
  el.blockerIgnoreQuiet.checked = Boolean(blocker.ignoreQuiet);
  el.blockerMinutes.value = blocker.afterMinutes;
  el.blockerRepeat.value = String(blocker.repeatMinutes);
  el.droppedAlerts.checked = Boolean(dropped.enabled);
  el.droppedBrowser.checked = Boolean(dropped.browser);
  el.droppedEmail.checked = Boolean(dropped.email);
  el.droppedMinutes.value = dropped.afterMinutes;
  el.replacedAlerts.checked = Boolean(replaced.enabled);
  el.replacedBrowser.checked = Boolean(replaced.browser);
  el.replacedEmail.checked = Boolean(replaced.email);
  el.gasAlerts.checked = Boolean(gasLow.enabled);
  el.gasBrowser.checked = Boolean(gasLow.browser);
  el.gasEmail.checked = Boolean(gasLow.email);
  el.gasIgnoreQuiet.checked = Boolean(gasLow.ignoreQuiet);
  el.gasRepeat.value = String(gasLow.repeatMinutes);
  el.alertCheckInterval.value = String(settings.checkIntervalSeconds);
  el.quietHours.checked = Boolean(settings.quietHoursEnabled);
  el.quietStart.value = settings.quietStart;
  el.quietEnd.value = settings.quietEnd;
  el.email.value = state.email;
  el.notificationError.textContent = '';
  showTestStatus('');
  updateNotificationStatus();
  el.notificationDialog.showModal();
}

function scheduleNotificationChecks() {
  clearInterval(state.alertTimer);
  const interval = Math.max(10, Number(state.notificationSettings.checkIntervalSeconds) || 10) * 1000;
  state.alertTimer = setInterval(evaluateAlerts, interval);
  evaluateAlerts();
}

function openBalanceSettings() {
  const settings = state.balanceSettings;
  el.showBalances.checked = Boolean(settings.enabled);
  el.balanceInterval.value = String(settings.balanceInterval);
  el.balanceError.textContent = '';
  el.balanceDialog.showModal();
}

function openGasSettings() {
  const settings = state.balanceSettings;
  el.gasName.value = settings.gasName || 'Main Gas Station';
  el.gasAddress.value = settings.gasAddress || '';
  el.gasThreshold.value = settings.gasThreshold;
  el.gasInterval.value = String(settings.gasInterval);
  el.gasError.textContent = '';
  el.gasDialog.showModal();
}

el.settingsButton.addEventListener('click', openSettings);
el.notificationSettingsButton.addEventListener('click', openNotificationSettings);
el.testEmailButton.addEventListener('click', sendTestEmail);
el.notificationButton.addEventListener('click', enableNotifications);
el.form.addEventListener('submit', event => {
  if (event.submitter?.value !== 'default') return;
  event.preventDefault();
  const endpoint = el.endpoint.value.trim();
  const parsed = parseAddressLines(el.addresses.value);
  const addresses = parsed.addresses;
  if (!/^wss:\/\/eth-mainnet\.g\.alchemy\.com\/v2\/[A-Za-z0-9_-]+$/.test(endpoint)) {
    el.error.textContent = 'Enter the full WebSocket URL starting with wss://';
    return;
  }
  if (!addresses.length || addresses.length > 50 || addresses.some(address => !validAddress(address))) {
    el.error.textContent = 'Enter 1–50 valid Ethereum addresses, one per line.';
    return;
  }
  state.endpoint = endpoint;
  state.addresses = addresses;
  state.addressLabels = parsed.labels;
  localStorage.setItem(ENDPOINT_KEY, endpoint);
  localStorage.setItem(ADDRESSES_KEY, JSON.stringify(addresses));
  localStorage.setItem(LABELS_KEY, JSON.stringify(parsed.labels));
  el.dialog.close();
  reconnect();
  scheduleBalanceRefresh(true);
});

el.notificationForm.addEventListener('submit', event => {
  if (event.submitter?.value !== 'default') return;
  event.preventDefault();
  const email = el.email.value.trim();
  const pendingMinutes = Number(el.pendingMinutes.value);
  const blockerMinutes = Number(el.blockerMinutes.value);
  const droppedMinutes = Number(el.droppedMinutes.value);
  const emailRequired = [
    el.pendingAlerts.checked && el.pendingEmail.checked,
    el.blockerAlerts.checked && el.blockerEmail.checked,
    el.droppedAlerts.checked && el.droppedEmail.checked,
    el.replacedAlerts.checked && el.replacedEmail.checked,
    el.gasAlerts.checked && el.gasEmail.checked,
  ].some(Boolean);
  if (emailRequired && !validEmail(email)) {
    el.notificationError.textContent = 'Enter a valid alert email or disable Email for every active rule.';
    return;
  }
  if (!Number.isFinite(pendingMinutes) || pendingMinutes < 1 || pendingMinutes > 1440) {
    el.notificationError.textContent = 'Pending alert time must be between 1 and 1,440 minutes.';
    return;
  }
  if (!Number.isFinite(blockerMinutes) || blockerMinutes < 0 || blockerMinutes > 1440) {
    el.notificationError.textContent = 'Queue blocker alert time must be between 0 and 1,440 minutes.';
    return;
  }
  if (!Number.isFinite(droppedMinutes) || droppedMinutes < 1 || droppedMinutes > 1440) {
    el.notificationError.textContent = 'Dropped transaction check time must be between 1 and 1,440 minutes.';
    return;
  }
  state.email = email;
  state.notificationSettings = {
    rules: {
      pending: {enabled:el.pendingAlerts.checked, browser:el.pendingBrowser.checked, email:el.pendingEmail.checked, afterMinutes:pendingMinutes, repeatMinutes:Number(el.pendingRepeat.value)},
      blocker: {enabled:el.blockerAlerts.checked, browser:el.blockerBrowser.checked, email:el.blockerEmail.checked, afterMinutes:blockerMinutes, repeatMinutes:Number(el.blockerRepeat.value), ignoreQuiet:el.blockerIgnoreQuiet.checked},
      dropped: {enabled:el.droppedAlerts.checked, browser:el.droppedBrowser.checked, email:el.droppedEmail.checked, afterMinutes:droppedMinutes, repeatMinutes:0},
      replaced: {enabled:el.replacedAlerts.checked, browser:el.replacedBrowser.checked, email:el.replacedEmail.checked, afterMinutes:0, repeatMinutes:0},
      gasLow: {enabled:el.gasAlerts.checked, browser:el.gasBrowser.checked, email:el.gasEmail.checked, afterMinutes:0, repeatMinutes:Number(el.gasRepeat.value), ignoreQuiet:el.gasIgnoreQuiet.checked},
    },
    checkIntervalSeconds: Number(el.alertCheckInterval.value),
    quietHoursEnabled: el.quietHours.checked,
    quietStart: el.quietStart.value || '22:00',
    quietEnd: el.quietEnd.value || '08:00',
  };
  if (email) localStorage.setItem(EMAIL_KEY, email); else localStorage.removeItem(EMAIL_KEY);
  localStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(state.notificationSettings));
  el.notificationDialog.close();
  scheduleNotificationChecks();
});

el.balanceSettingsButton.addEventListener('click', openBalanceSettings);
el.gasSettingsButton.addEventListener('click', openGasSettings);
el.refreshBalancesButton.addEventListener('click', updateWalletBalances);
el.gasBalanceBody.addEventListener('click', event => {
  if (event.target.closest('[data-refresh-gas]')) updateGasBalance();
});
el.balanceForm.addEventListener('submit', event => {
  if (event.submitter?.value !== 'default') return;
  event.preventDefault();
  state.balanceSettings = {
    ...state.balanceSettings,
    enabled: el.showBalances.checked,
    balanceInterval: Number(el.balanceInterval.value),
  };
  localStorage.setItem(BALANCE_SETTINGS_KEY, JSON.stringify(state.balanceSettings));
  el.balanceDialog.close();
  scheduleBalanceRefresh(true);
});
el.gasForm.addEventListener('submit', event => {
  if (event.submitter?.value !== 'default') return;
  event.preventDefault();
  const gasAddress = el.gasAddress.value.trim().toLowerCase();
  const gasThreshold = Number(el.gasThreshold.value);
  if (gasAddress && !validAddress(gasAddress)) {
    el.gasError.textContent = 'Enter a valid Gas Station Ethereum address or leave it empty.';
    return;
  }
  if (!Number.isFinite(gasThreshold) || gasThreshold < 0) {
    el.gasError.textContent = 'Minimum ETH balance must be zero or greater.';
    return;
  }
  const gasChanged = gasAddress !== state.balanceSettings.gasAddress || gasThreshold !== Number(state.balanceSettings.gasThreshold);
  state.balanceSettings = {
    ...state.balanceSettings,
    gasName: el.gasName.value.trim() || 'Main Gas Station',
    gasAddress,
    gasThreshold,
    gasInterval: Number(el.gasInterval.value),
  };
  if (gasChanged) {
    state.gasBalance = {};
    localStorage.removeItem(GAS_BALANCE_KEY);
    localStorage.removeItem(GAS_ALERT_KEY);
  }
  localStorage.setItem(BALANCE_SETTINGS_KEY, JSON.stringify(state.balanceSettings));
  el.gasDialog.close();
  scheduleBalanceRefresh(true);
});

el.filter.addEventListener('change', () => { state.page = 1; render(); });
el.search.addEventListener('input', () => {
  state.searchQuery = el.search.value;
  state.page = 1;
  render();
});
el.pageSize.addEventListener('change', () => {
  state.pageSize = Number(el.pageSize.value);
  state.page = 1;
  localStorage.setItem(PAGE_SIZE_KEY, String(state.pageSize));
  render();
});
el.previousPage.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; render(); } });
el.nextPage.addEventListener('click', () => { state.page += 1; render(); });
document.querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', () => {
  const key = button.dataset.sort;
  if (state.sortKey === key) state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
  else {
    state.sortKey = key;
    state.sortDirection = ['status', 'age'].includes(key) ? 'asc' : 'desc';
  }
  state.page = 1;
  render();
}));
el.txBody.addEventListener('click', event => {
  const button = event.target.closest('[data-copy-hash]');
  if (button) { copyHash(button.dataset.copyHash); return; }
  if (event.target.closest('a')) return;
  const row = event.target.closest('[data-tx-hash]');
  if (row) openTransactionDetails(row.dataset.txHash);
});
el.txBody.addEventListener('keydown', event => {
  if (!['Enter', ' '].includes(event.key) || event.target.closest('a, button')) return;
  const row = event.target.closest('[data-tx-hash]');
  if (row) { event.preventDefault(); openTransactionDetails(row.dataset.txHash); }
});
el.closeTransactionDialog.addEventListener('click', () => el.transactionDialog.close());
el.transactionDialog.addEventListener('click', event => {
  if (event.target === el.transactionDialog) el.transactionDialog.close();
});
el.transactionDetails.addEventListener('click', event => {
  const button = event.target.closest('[data-copy-hash]');
  if (button) copyHash(button.dataset.copyHash);
});
el.clearButton.addEventListener('click', () => {
  if (!state.transactions.length || !confirm('Delete the saved transaction history?')) return;
  state.transactions = [];
  state.summaryAlerts = {};
  localStorage.removeItem(SUMMARY_ALERTS_KEY);
  saveTransactions();
  render();
});

render();
connect();
hydrateStoredTokens();
scheduleBalanceRefresh();
scheduleNotificationChecks();
setInterval(render, 1000);
setInterval(checkStatuses, 12000);
setInterval(updateGasPrice, 30000);
