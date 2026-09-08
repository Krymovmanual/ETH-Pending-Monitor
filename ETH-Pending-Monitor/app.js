const WATCH_ADDRESS = '0xced92fa7f0797cbc851b48140ae218a0b0d41ce0';
const ENDPOINT_KEY = 'eth-pending-monitor-endpoint';
const TX_KEY = 'eth-pending-monitor-transactions';

const state = {
  ws: null,
  endpoint: localStorage.getItem(ENDPOINT_KEY) || '',
  transactions: loadTransactions(),
  reconnectTimer: null,
  manualClose: false,
};

const el = {
  badge: document.querySelector('#connectionBadge'),
  connectionText: document.querySelector('#connectionText'),
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
  error: document.querySelector('#dialogError'),
};

function loadTransactions() {
  try { return JSON.parse(localStorage.getItem(TX_KEY) || '[]'); }
  catch { return []; }
}

function saveTransactions() {
  state.transactions = state.transactions.slice(0, 500);
  localStorage.setItem(TX_KEY, JSON.stringify(state.transactions));
}

function setConnection(status, text) {
  el.badge.className = `connection ${status}`;
  el.connectionText.textContent = text;
  render();
}

function connect() {
  clearTimeout(state.reconnectTimer);
  if (!state.endpoint) {
    setConnection('', 'Не подключено');
    el.dialog.showModal();
    return;
  }
  state.manualClose = false;
  setConnection('', 'Подключение…');
  try { state.ws = new WebSocket(state.endpoint); }
  catch { setConnection('error', 'Неверный URL'); return; }

  state.ws.addEventListener('open', () => {
    setConnection('live', 'Live');
    state.ws.send(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_subscribe',
      params: ['alchemy_pendingTransactions', {
        fromAddress: [WATCH_ADDRESS],
        toAddress: [WATCH_ADDRESS],
        hashesOnly: false,
      }],
    }));
  });

  state.ws.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.error) {
      setConnection('error', message.error.message || 'Ошибка Alchemy');
      return;
    }
    const tx = message?.params?.result;
    if (!tx?.hash) return;
    addTransaction(tx);
  });

  state.ws.addEventListener('close', () => {
    setConnection('error', 'Соединение потеряно');
    if (!state.manualClose) state.reconnectTimer = setTimeout(connect, 5000);
  });
  state.ws.addEventListener('error', () => setConnection('error', 'Ошибка подключения'));
}

function addTransaction(tx) {
  const hash = tx.hash.toLowerCase();
  if (state.transactions.some(item => item.hash === hash)) return;

  const from = (tx.from || '').toLowerCase();
  const nonce = hexToNumber(tx.nonce);
  for (const item of state.transactions) {
    if (item.status === 'pending' && item.from === from && item.nonce === nonce) item.status = 'replaced';
  }

  state.transactions.unshift({
    hash,
    from,
    to: (tx.to || '').toLowerCase(),
    nonce,
    value: hexToEth(tx.value),
    maxFee: hexToGwei(tx.maxFeePerGas || tx.gasPrice),
    firstSeen: Date.now(),
    status: 'pending',
  });
  saveTransactions();
  render();
}

async function checkStatuses() {
  if (!state.endpoint) return;
  const pending = state.transactions.filter(tx => tx.status === 'pending');
  if (!pending.length) return;
  const httpEndpoint = state.endpoint.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  try {
    const payload = pending.map((tx, index) => ({ jsonrpc: '2.0', id: index + 1, method: 'eth_getTransactionReceipt', params: [tx.hash] }));
    const response = await fetch(httpEndpoint, { method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload) });
    const results = await response.json();
    let changed = false;
    for (const answer of results) {
      const tx = pending[answer.id - 1];
      if (answer.result) {
        tx.status = answer.result.status === '0x1' ? 'confirmed' : 'failed';
        tx.blockNumber = hexToNumber(answer.result.blockNumber);
        changed = true;
      } else if (Date.now() - tx.firstSeen > 30 * 60 * 1000) {
        const stillExists = await rpc(httpEndpoint, 'eth_getTransactionByHash', [tx.hash]);
        if (!stillExists) { tx.status = 'dropped'; changed = true; }
      }
    }
    if (changed) { saveTransactions(); render(); }
  } catch { /* WebSocket status remains the primary connection signal. */ }
}

async function rpc(endpoint, method, params) {
  const response = await fetch(endpoint, { method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc:'2.0', id:1, method, params}) });
  const body = await response.json();
  return body.result;
}

function hexToNumber(value) { return value ? Number.parseInt(value, 16) : 0; }
function hexToEth(value) { return value ? Number(BigInt(value)) / 1e18 : 0; }
function hexToGwei(value) { return value ? Number(BigInt(value)) / 1e9 : 0; }
function shortHash(hash) { return `${hash.slice(0, 8)}…${hash.slice(-6)}`; }
function compactNumber(value, digits = 5) { return new Intl.NumberFormat('en-US', {maximumFractionDigits: digits}).format(value); }
function age(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds} сек`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} ч`;
  return `${Math.floor(seconds / 86400)} д`;
}
function dateTime(timestamp) { return new Intl.DateTimeFormat('ru-RU', {hour:'2-digit', minute:'2-digit', second:'2-digit'}).format(timestamp); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function render() {
  const pending = state.transactions.filter(tx => tx.status === 'pending').length;
  const confirmed = state.transactions.filter(tx => ['confirmed','failed'].includes(tx.status)).length;
  const problems = state.transactions.filter(tx => ['dropped','replaced'].includes(tx.status)).length;
  el.pendingCount.textContent = pending;
  el.confirmedCount.textContent = confirmed;
  el.problemCount.textContent = problems;
  el.lastEvent.textContent = state.transactions[0] ? dateTime(state.transactions[0].firstSeen) : '—';

  const filter = el.filter.value;
  const visible = state.transactions.filter(tx => {
    if (filter === 'all') return true;
    if (filter === 'problem') return ['dropped','replaced'].includes(tx.status);
    return tx.status === filter;
  });
  el.txBody.innerHTML = visible.map(tx => {
    const outgoing = tx.from === WATCH_ADDRESS;
    return `<tr>
      <td><span class="status ${escapeHtml(tx.status)}">${escapeHtml(statusLabel(tx.status))}</span></td>
      <td data-time="${tx.firstSeen}">${age(tx.firstSeen)}</td>
      <td><a class="hash" href="https://etherscan.io/tx/${tx.hash}" target="_blank" rel="noreferrer">${shortHash(tx.hash)}</a></td>
      <td>${outgoing ? 'Исходящая' : 'Входящая'}</td>
      <td>${compactNumber(tx.value)} ETH</td>
      <td>${tx.nonce}</td>
      <td>${compactNumber(tx.maxFee, 2)} Gwei</td>
    </tr>`;
  }).join('');
  el.emptyState.classList.toggle('hidden', visible.length > 0);
  el.emptyMessage.textContent = state.endpoint ? 'Подключение активно. Новые события появятся здесь.' : 'Настрой подключение к Alchemy, чтобы начать мониторинг.';
}

function statusLabel(status) {
  return ({pending:'Pending', confirmed:'Confirmed', failed:'Failed', dropped:'Dropped', replaced:'Replaced'})[status] || status;
}

el.settingsButton.addEventListener('click', () => {
  el.endpoint.value = state.endpoint;
  el.error.textContent = '';
  el.dialog.showModal();
});
el.form.addEventListener('submit', event => {
  if (event.submitter?.value !== 'default') return;
  event.preventDefault();
  const value = el.endpoint.value.trim();
  if (!/^wss:\/\/eth-mainnet\.g\.alchemy\.com\/v2\/[A-Za-z0-9_-]+$/.test(value)) {
    el.error.textContent = 'Вставь полный WebSocket URL, начинающийся с wss://';
    return;
  }
  if (state.ws) { state.manualClose = true; state.ws.close(); }
  state.endpoint = value;
  localStorage.setItem(ENDPOINT_KEY, value);
  el.dialog.close();
  connect();
});
el.filter.addEventListener('change', render);
el.clearButton.addEventListener('click', () => {
  if (!state.transactions.length || !confirm('Удалить сохранённую историю транзакций?')) return;
  state.transactions = [];
  saveTransactions();
  render();
});

render();
connect();
setInterval(render, 1000);
setInterval(checkStatuses, 12000);
