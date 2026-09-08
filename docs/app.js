const DEFAULT_ADDRESS = '0xced92fa7f0797cbc851b48140ae218a0b0d41ce0';
const ENDPOINT_KEY = 'eth-pending-monitor-endpoint';
const ADDRESSES_KEY = 'eth-pending-monitor-addresses';
const LABELS_KEY = 'eth-pending-monitor-address-labels';
const EMAIL_KEY = 'eth-pending-monitor-email';
const TX_KEY = 'eth-pending-monitor-transactions';
const TOKEN_CACHE_KEY = 'eth-pending-monitor-token-cache';
const ALERT_AFTER_MS = 15 * 60 * 1000;
const DROP_CHECK_AFTER_MS = 30 * 60 * 1000;

const state = {
  ws: null,
  endpoint: localStorage.getItem(ENDPOINT_KEY) || '',
  addresses: loadAddresses(),
  addressLabels: loadAddressLabels(),
  email: localStorage.getItem(EMAIL_KEY) || '',
  transactions: loadTransactions(),
  tokenCache: loadTokenCache(),
  currentGasPrice: null,
  copiedHash: null,
  reconnectTimer: null,
  manualClose: false,
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
  settingsButton: document.querySelector('#settingsButton'),
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
    tokenContract: tokenTransfer ? to : '',
    tokenRecipient: tokenTransfer?.recipient || '',
    rawTokenAmount: tokenTransfer?.rawAmount || '',
    tokenSymbol: tokenTransfer ? 'ERC-20' : '',
    tokenName: tokenTransfer ? 'ERC-20 Token' : '',
    tokenDecimals: null,
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
      recipient: `0x${data.slice(32, 72)}`,
      rawAmount: BigInt(`0x${data.slice(72, 136)}`).toString(),
    };
  }
  if (data.startsWith('23b872dd') && data.length >= 200) {
    return {
      from: `0x${data.slice(32, 72)}`,
      recipient: `0x${data.slice(96, 136)}`,
      rawAmount: BigInt(`0x${data.slice(136, 200)}`).toString(),
    };
  }
  return null;
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
      } else if (Date.now() - tx.firstSeen > DROP_CHECK_AFTER_MS) {
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
  for (const tx of state.transactions) {
    tx.alerts ||= {};
    if (tx.status === 'pending' && Date.now() - tx.firstSeen >= ALERT_AFTER_MS) sendAlert(tx, 'stuck');
    if (tx.status === 'dropped' || tx.status === 'replaced') sendAlert(tx, tx.status);
    if (needsBoost(tx)) sendAlert(tx, 'boost');
    const queue = queueInfo(tx);
    if (queue?.role === 'blocker') sendAlert(tx, 'blocker', queue);
  }
}

async function sendAlert(tx, kind, context = {}) {
  tx.alerts ||= {};
  const alertKey = kind === 'blocker' ? `blocker-${context.count}` : kind;
  if (tx.alerts[alertKey]) return;
  tx.alerts[alertKey] = Date.now();
  saveTransactions();

  const title = alertTitle(kind, tx, context);
  const wallet = walletLabel(tx.matchedAddress);
  const detail = kind === 'blocker'
    ? `${wallet}: nonce ${tx.nonce} blocks ${context.count} transaction${context.count === 1 ? '' : 's'}`
    : `${wallet}: ${shortHash(tx.hash)} · ${transactionAmount(tx)}`;
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const notification = new Notification(title, { body: detail, tag: `${tx.hash}-${alertKey}`, requireInteraction: kind === 'blocker' });
      notification.onclick = () => window.open(`https://etherscan.io/tx/${tx.hash}`, '_blank', 'noopener');
    } catch { /* Browser support varies. */ }
  }

  if (state.email) {
    try { await sendEmail(state.email, title, tx, kind, context); }
    catch {
      delete tx.alerts[alertKey];
      saveTransactions();
    }
  }
}

function alertTitle(kind, tx = null, context = {}) {
  if (kind === 'blocker') return `URGENT: Nonce ${tx?.nonce ?? '—'} is blocking ${context.count || 0} transactions`;
  return ({
    stuck: 'Transaction pending for 15+ minutes',
    dropped: 'Transaction dropped',
    replaced: 'Transaction replaced',
    boost: 'Transaction may need a gas boost',
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
    setTimeout(() => {
      if (state.copiedHash === hash) {
        state.copiedHash = null;
        render();
      }
    }, 1600);
  } catch {
    alert('Could not copy the transaction hash.');
  }
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
  const visible = state.transactions.filter(tx => {
    if (filter === 'all') return true;
    if (filter === 'problem') return ['dropped','replaced'].includes(tx.status);
    if (filter === 'boost') return needsBoost(tx);
    return tx.status === filter;
  });
  el.txBody.innerHTML = visible.map(tx => {
    const outgoing = state.addresses.includes(tx.from);
    const matched = tx.matchedAddress || state.addresses.find(address => [tx.from, tx.to, tx.tokenRecipient].includes(address)) || '';
    const boost = needsBoost(tx);
    const queue = queueInfo(tx);
    const gasLabel = tx.status !== 'pending'
      ? '<span class="gas-check"><strong>—</strong></span>'
      : `<span class="gas-check ${boost ? 'boost' : ''}"><strong>${boost ? 'Boost recommended' : 'OK'}</strong><small>Network ${state.currentGasPrice ? `${compactNumber(state.currentGasPrice, 2)} Gwei` : '—'}</small></span>`;
    const queueLabel = queue?.role === 'blocker'
      ? `<span class="queue-state"><strong>Blocking ${queue.count} transaction${queue.count === 1 ? '' : 's'}</strong><small>Nonce ${queue.blockerNonce}</small></span>`
      : queue?.role === 'blocked'
        ? `<span class="queue-state blocked"><strong>Blocked</strong><small>By nonce ${queue.blockerNonce}</small></span>`
        : '—';
    return `<tr>
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
  el.emptyState.classList.toggle('hidden', visible.length > 0);
  el.emptyMessage.textContent = state.endpoint ? 'Connection active. New events will appear here.' : 'Configure the Alchemy connection to start monitoring.';
}

function statusLabel(status) {
  return ({pending:'Pending', confirmed:'Confirmed', failed:'Failed', dropped:'Dropped', replaced:'Replaced'})[status] || status;
}

function openSettings() {
  el.endpoint.value = state.endpoint;
  el.addresses.value = state.addresses.map(address => state.addressLabels[address] ? `${state.addressLabels[address]} | ${address}` : address).join('\n');
  el.email.value = state.email;
  el.error.textContent = '';
  showTestStatus('');
  updateNotificationStatus();
  el.dialog.showModal();
}

function showTestStatus(message, isError = false) {
  el.testEmailStatus.textContent = message;
  el.testEmailStatus.classList.toggle('error', isError);
}

el.settingsButton.addEventListener('click', openSettings);
el.testEmailButton.addEventListener('click', sendTestEmail);
el.notificationButton.addEventListener('click', enableNotifications);
el.form.addEventListener('submit', event => {
  if (event.submitter?.value !== 'default') return;
  event.preventDefault();
  const endpoint = el.endpoint.value.trim();
  const parsed = parseAddressLines(el.addresses.value);
  const addresses = parsed.addresses;
  const email = el.email.value.trim();
  if (!/^wss:\/\/eth-mainnet\.g\.alchemy\.com\/v2\/[A-Za-z0-9_-]+$/.test(endpoint)) {
    el.error.textContent = 'Enter the full WebSocket URL starting with wss://';
    return;
  }
  if (!addresses.length || addresses.length > 50 || addresses.some(address => !validAddress(address))) {
    el.error.textContent = 'Enter 1–50 valid Ethereum addresses, one per line.';
    return;
  }
  if (email && !validEmail(email)) {
    el.error.textContent = 'Enter a valid alert email or leave the field empty.';
    return;
  }
  state.endpoint = endpoint;
  state.addresses = addresses;
  state.addressLabels = parsed.labels;
  state.email = email;
  localStorage.setItem(ENDPOINT_KEY, endpoint);
  localStorage.setItem(ADDRESSES_KEY, JSON.stringify(addresses));
  localStorage.setItem(LABELS_KEY, JSON.stringify(parsed.labels));
  if (email) localStorage.setItem(EMAIL_KEY, email); else localStorage.removeItem(EMAIL_KEY);
  el.dialog.close();
  reconnect();
});

el.filter.addEventListener('change', render);
el.txBody.addEventListener('click', event => {
  const button = event.target.closest('[data-copy-hash]');
  if (button) copyHash(button.dataset.copyHash);
});
el.clearButton.addEventListener('click', () => {
  if (!state.transactions.length || !confirm('Delete the saved transaction history?')) return;
  state.transactions = [];
  saveTransactions();
  render();
});

render();
connect();
hydrateStoredTokens();
setInterval(render, 1000);
setInterval(checkStatuses, 12000);
setInterval(updateGasPrice, 30000);
setInterval(evaluateAlerts, 10000);
