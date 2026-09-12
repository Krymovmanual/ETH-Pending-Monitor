const BACKEND_URL_KEY = 'eth-pending-monitor-backend-url';
const BACKEND_TOKEN_KEY = 'eth-pending-monitor-backend-token';
const MONITORED_ADDRESSES_KEY = 'eth-pending-monitor-addresses';
const MONITORED_LABELS_KEY = 'eth-pending-monitor-address-labels';
const WALLETS_KEY = 'treasury-wallet-sources';
const DRAFTS_KEY = 'treasury-transfer-drafts';
const SUPPORTED_EVM_ASSETS = new Set(['ETH', 'USDT', 'USDC', 'LINK', 'DAI', 'USDS']);

const state = {
  mode: 'internal',
  exchangeData: null,
  walletBalances: new Map(),
  wallets: loadJson(WALLETS_KEY, []),
  drafts: loadJson(DRAFTS_KEY, []),
  sources: [],
  loading: false,
  error: '',
  estimate: null,
  estimateLoading: false,
};

const el = Object.fromEntries([
  'transferConnection','transferConnectionText','refreshTransferSources','transferFormTitle','transferSource','sourceMeta',
  'transferAsset','internalDestinationGroup','internalDestination','depositAddressGroup','internalDepositAddress',
  'externalDestinationGroup','externalDestination','externalLabel','transferNetwork','transferAmount','maxTransferAmount',
  'availableBalance','calculateTransfer','saveTransferDraft','previewStatus','previewFrom','previewTo','previewAsset',
  'previewNetwork','previewAmount','previewFee','previewBalanceAfter','transferChecks','connectMetaMask','openWatchWallet',
  'walletSourceGrid','draftCount','transferDrafts','watchWalletDialog','watchWalletForm','watchWalletName','watchWalletAddress',
  'watchWalletError',
].map(id => [id, document.querySelector(`#${id}`)]));

function loadJson(key, fallback) {
  try { return JSON.parse(Treasury.storage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}

function saveJson(key, value) { Treasury.storage.setItem(key, JSON.stringify(value)); }
function validAddress(value) { return /^0x[a-fA-F0-9]{40}$/.test(String(value || '').trim()); }
function shortAddress(value) { const address = String(value || ''); return address ? `${address.slice(0, 8)}…${address.slice(-6)}` : '—'; }
function backendUrl() { return location.origin; }
function backendToken() { return ''; }
function backendConfigured() { return Boolean(window.Treasury?.user); }
function backendHeaders(json = false) { return json ? {'Content-Type':'application/json'} : {}; }

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
}

function number(value, digits = 8) {
  if (!Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits:digits }).format(Number(value));
}

function ownWallets() {
  const labels = loadJson(MONITORED_LABELS_KEY, {});
  const monitored = loadJson(MONITORED_ADDRESSES_KEY, []);
  const combined = [
    ...monitored.filter(validAddress).map(address => ({ id:`wallet:${address.toLowerCase()}`, type:'monitored', name:labels[address.toLowerCase()] || 'Monitored wallet', address:address.toLowerCase(), chainId:1 })),
    ...state.wallets,
  ];
  const result = new Map();
  for (const wallet of combined) {
    if (!validAddress(wallet.address)) continue;
    const key = wallet.address.toLowerCase();
    const existing = result.get(key);
    result.set(key, existing?.type === 'metamask' ? existing : { ...wallet, id:`wallet:${key}`, address:key });
  }
  return [...result.values()];
}

function buildSources() {
  const exchangeSources = (state.exchangeData?.accounts || []).map(account => ({
    id:account.id,
    kind:'exchange',
    provider:account.exchangeName,
    name:`${account.exchangeName} ${account.name}`,
    accountType:account.type,
    address:null,
    assets:(account.assets || []).map(asset => ({
      symbol:String(asset.coin || '').toUpperCase(),
      balance:Number(asset.equity ?? asset.available ?? 0),
      available:Number(asset.available ?? asset.equity ?? 0),
      contract:null,
      decimals:null,
    })),
  }));
  const walletSources = ownWallets().map(wallet => {
    const balance = state.walletBalances.get(wallet.address.toLowerCase());
    return {
      id:wallet.id,
      kind:'wallet',
      provider:wallet.type === 'metamask' ? 'MetaMask' : 'Wallet',
      name:wallet.name,
      address:wallet.address,
      chainId:wallet.chainId || 1,
      walletType:wallet.type,
      assets:(balance?.assets || []).map(asset => ({ ...asset, balance:Number(asset.balance), available:Number(asset.balance) })),
    };
  });
  state.sources = [...exchangeSources, ...walletSources];
}

function currentSource() { return state.sources.find(source => source.id === el.transferSource.value) || null; }
function currentAsset() { return currentSource()?.assets.find(asset => asset.symbol === el.transferAsset.value) || null; }
function internalDestination() { return state.sources.find(source => source.id === el.internalDestination.value) || null; }

function sourceOption(source) {
  const group = source.kind === 'exchange' ? 'Exchange' : 'Wallet';
  return `<option value="${escapeHtml(source.id)}">${escapeHtml(group)} · ${escapeHtml(source.name)}</option>`;
}

function renderSourceSelectors() {
  const sourceValue = el.transferSource.value;
  el.transferSource.innerHTML = `<option value="">Select source</option>${state.sources.map(sourceOption).join('')}`;
  if (state.sources.some(source => source.id === sourceValue)) el.transferSource.value = sourceValue;
  const source = currentSource();
  const assetValue = el.transferAsset.value;
  const assets = (source?.assets || []).filter(asset => Number(asset.balance) !== 0).sort((a, b) => a.symbol.localeCompare(b.symbol));
  el.transferAsset.innerHTML = `<option value="">Select asset</option>${assets.map(asset => `<option value="${escapeHtml(asset.symbol)}">${escapeHtml(asset.symbol)} · ${number(asset.available)}</option>`).join('')}`;
  if (assets.some(asset => asset.symbol === assetValue)) el.transferAsset.value = assetValue;
  const destinationValue = el.internalDestination.value;
  const destinations = state.sources.filter(item => item.id !== source?.id);
  el.internalDestination.innerHTML = `<option value="">Select destination</option>${destinations.map(sourceOption).join('')}`;
  if (destinations.some(item => item.id === destinationValue)) el.internalDestination.value = destinationValue;
}

function updateNetwork() {
  const source = currentSource();
  const destination = internalDestination();
  const bitgetInternal = state.mode === 'internal' && source?.kind === 'exchange' && destination?.kind === 'exchange'
    && source.provider === destination.provider;
  el.transferNetwork.value = bitgetInternal ? 'internal' : 'ethereum';
  el.transferNetwork.disabled = bitgetInternal;
  el.depositAddressGroup.hidden = !(state.mode === 'internal' && source?.kind === 'wallet' && destination?.kind === 'exchange');
}

function destinationAddress() {
  if (state.mode === 'external') return el.externalDestination.value.trim();
  const destination = internalDestination();
  if (destination?.kind === 'wallet') return destination.address;
  if (currentSource()?.kind === 'wallet' && destination?.kind === 'exchange') return el.internalDepositAddress.value.trim();
  return '';
}

function validation() {
  const source = currentSource();
  const asset = currentAsset();
  const destination = state.mode === 'internal' ? internalDestination() : null;
  const amount = Number(el.transferAmount.value);
  const address = destinationAddress();
  const bitgetInternal = state.mode === 'internal' && source?.kind === 'exchange' && destination?.kind === 'exchange'
    && source.provider === destination.provider;
  const amountEntered = Number.isFinite(amount) && amount > 0;
  const sufficient = Boolean(asset) && amountEntered && amount <= Number(asset.available);
  const checks = [
    { ok:Boolean(source), text:source ? 'Source account selected' : 'Select a source account' },
    { ok:Boolean(asset), text:asset ? `${asset.symbol} balance loaded` : 'Select an asset' },
    { ok:amountEntered, text:amountEntered ? 'Amount is greater than zero' : 'Enter an amount' },
    { ok:sufficient, text:!asset ? 'Balance is not loaded' : !amountEntered ? 'Enter an amount to check the balance' : amount > Number(asset.available) ? 'Amount exceeds available balance' : 'Available balance is sufficient' },
  ];
  if (state.mode === 'internal') checks.push({ ok:Boolean(destination), text:destination ? 'Own destination selected' : 'Select a destination account' });
  if (!bitgetInternal) {
    checks.push({ ok:validAddress(address), text:validAddress(address) ? 'Ethereum destination address is valid' : 'Enter a valid Ethereum destination address' });
    checks.push({ ok:Boolean(asset && SUPPORTED_EVM_ASSETS.has(asset.symbol)), text:asset && SUPPORTED_EVM_ASSETS.has(asset.symbol) ? 'Asset supported on Ethereum preview' : 'This asset/network is not supported in the current preview' });
  } else checks.push({ ok:true, text:'Bitget internal transfer does not use a blockchain network' });
  if (source?.kind === 'wallet' && source.walletType === 'metamask') {
    checks.push({ ok:Number(source.chainId) === 1, text:Number(source.chainId) === 1 ? 'MetaMask is connected to Ethereum Mainnet' : 'Switch MetaMask to Ethereum Mainnet' });
  }
  if (source?.kind === 'wallet' && state.estimate?.feeEth) {
    const ethBalance = Number(source.assets.find(item => item.symbol === 'ETH')?.available || 0);
    const requiredEth = Number(state.estimate.feeEth) + (asset?.symbol === 'ETH' ? amount : 0);
    checks.push({ ok:ethBalance >= requiredEth, text:ethBalance >= requiredEth ? 'ETH balance covers the amount and network fee' : 'Insufficient ETH to cover the amount and network fee' });
  }
  if (source?.kind === 'exchange' && !bitgetInternal) checks.push({ ok:false, warning:true, text:'Bitget withdrawal network and provider fee are not verified in read-only mode' });
  return { checks, valid:checks.every(check => check.ok || check.warning) && !checks.some(check => !check.ok && !check.warning), bitgetInternal, source, asset, destination, amount, address };
}

function renderPreview() {
  const result = validation();
  const amountValid = Number.isFinite(result.amount) && result.amount > 0;
  el.previewFrom.textContent = result.source?.name || '—';
  el.previewTo.textContent = state.mode === 'internal' ? result.destination?.name || '—' : el.externalLabel.value.trim() || shortAddress(result.address);
  el.previewAsset.textContent = result.asset?.symbol || '—';
  el.previewNetwork.textContent = result.bitgetInternal ? 'Bitget internal' : 'Ethereum Mainnet';
  el.previewAmount.textContent = amountValid && result.asset ? `${number(result.amount)} ${result.asset.symbol}` : '—';
  el.previewFee.textContent = result.bitgetInternal ? '0 · internal' : state.estimateLoading ? 'Calculating…' : state.estimate?.feeEth ? `${number(state.estimate.feeEth)} ETH` : result.source?.kind === 'exchange' ? 'Provider fee unavailable' : 'Calculate preview';
  const feeFromSameAsset = result.source?.kind === 'wallet' && result.asset?.symbol === 'ETH' ? Number(state.estimate?.feeEth || 0) : 0;
  const after = result.asset && amountValid ? Number(result.asset.available) - result.amount - feeFromSameAsset : null;
  el.previewBalanceAfter.textContent = after !== null ? `${number(after)} ${result.asset.symbol}` : '—';
  el.availableBalance.textContent = result.asset ? `Available: ${number(result.asset.available)} ${result.asset.symbol}` : 'Available: —';
  el.sourceMeta.textContent = result.source ? `${result.source.provider} · ${result.source.kind === 'wallet' ? shortAddress(result.source.address) : result.source.accountType}` : 'Select an exchange account or wallet.';
  el.transferChecks.innerHTML = result.checks.map(check => `<div class="transfer-check ${check.ok ? 'ok' : check.warning ? 'warning' : 'failed'}"><span>${check.ok ? '✓' : check.warning ? '!' : '×'}</span>${escapeHtml(check.text)}</div>`).join('');
  el.previewStatus.textContent = result.valid ? 'Ready to save' : 'Incomplete';
  el.previewStatus.classList.toggle('ready', result.valid);
  el.saveTransferDraft.disabled = !result.valid;
  el.calculateTransfer.disabled = state.estimateLoading || !result.valid || result.bitgetInternal || result.source?.kind !== 'wallet';
  return result;
}

function renderWallets() {
  const wallets = ownWallets();
  el.walletSourceGrid.innerHTML = wallets.length ? wallets.map(wallet => {
    const balances = state.walletBalances.get(wallet.address)?.assets || [];
    const eth = balances.find(asset => asset.symbol === 'ETH');
    return `<article class="wallet-source-card"><div><span class="wallet-type">${escapeHtml(wallet.type === 'metamask' ? 'MetaMask' : wallet.type === 'monitored' ? 'Monitored' : 'Watch-only')}</span><h3>${escapeHtml(wallet.name)}</h3><code>${escapeHtml(shortAddress(wallet.address))}</code></div><div class="wallet-source-balance"><span>ETH balance</span><strong>${eth ? number(eth.balance) : '—'}</strong></div></article>`;
  }).join('') : '<div class="transfer-empty">No wallets added yet.</div>';
}

function draftDestination(draft) { return draft.mode === 'external' ? draft.recipientLabel || shortAddress(draft.destinationAddress) : draft.destinationName; }

function renderDrafts() {
  el.draftCount.textContent = `${state.drafts.length} draft${state.drafts.length === 1 ? '' : 's'}`;
  el.transferDrafts.innerHTML = state.drafts.length ? `<div class="draft-table-wrap"><table class="draft-table"><thead><tr><th>Created</th><th>Type</th><th>From</th><th>To</th><th>Amount</th><th>Network</th><th></th></tr></thead><tbody>${state.drafts.map(draft => `<tr><td>${new Date(draft.createdAt).toLocaleString()}</td><td><span class="draft-type">${escapeHtml(draft.mode)}</span></td><td>${escapeHtml(draft.sourceName)}</td><td>${escapeHtml(draftDestination(draft))}</td><td><strong>${number(draft.amount)} ${escapeHtml(draft.asset)}</strong></td><td>${escapeHtml(draft.network)}</td><td class="numeric"><button class="text-button danger" data-remove-draft="${escapeHtml(draft.id)}" type="button">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="transfer-empty">No transfer drafts yet.</div>';
}

function render() {
  buildSources();
  renderSourceSelectors();
  updateNetwork();
  renderPreview();
  renderWallets();
  renderDrafts();
  document.querySelectorAll('[data-transfer-mode]').forEach(button => {
    const active = button.dataset.transferMode === state.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  el.transferFormTitle.textContent = state.mode === 'internal' ? 'Prepare internal transfer' : 'Prepare external transfer';
  el.internalDestinationGroup.hidden = state.mode !== 'internal';
  el.externalDestinationGroup.hidden = state.mode !== 'external';
  el.transferConnection.classList.toggle('live', Boolean(state.exchangeData) && !state.error);
  el.transferConnection.classList.toggle('error', Boolean(state.error));
  el.transferConnectionText.textContent = state.error ? 'Update failed' : state.loading ? 'Refreshing' : state.exchangeData ? 'Sources connected' : 'Connecting';
  el.refreshTransferSources.disabled = state.loading || !backendConfigured();
  el.refreshTransferSources.textContent = state.loading ? 'Refreshing…' : 'Refresh balances';
}

async function refreshSources() {
  if (state.loading) return;
  if (!backendConfigured()) {
    state.error = 'Configure the Railway URL and access token on the Wallets page first.';
    render();
    return;
  }
  state.loading = true;
  state.error = '';
  render();
  try {
    const wallets = ownWallets();
    const requests = [fetch(`${backendUrl()}/api/exchanges/accounts`, { headers:backendHeaders(), cache:'no-store' })];
    if (wallets.length) requests.push(fetch(`${backendUrl()}/api/wallets/balances`, { method:'POST', headers:backendHeaders(true), body:JSON.stringify({ addresses:wallets.map(wallet => wallet.address) }), cache:'no-store' }));
    const responses = await Promise.all(requests);
    const exchangeBody = await responses[0].json().catch(() => ({}));
    if (!responses[0].ok) throw new Error(exchangeBody.error || `Exchange service returned ${responses[0].status}`);
    state.exchangeData = exchangeBody;
    if (responses[1]) {
      const walletBody = await responses[1].json().catch(() => ({}));
      if (!responses[1].ok) throw new Error(walletBody.error || `Wallet service returned ${responses[1].status}`);
      state.walletBalances = new Map((walletBody.wallets || []).map(wallet => [wallet.address.toLowerCase(), wallet]));
    }
  } catch (error) {
    state.error = error?.message || 'Could not refresh transfer sources.';
  } finally {
    state.loading = false;
    render();
  }
}

async function calculateEstimate() {
  const result = validation();
  if (!result.valid || result.bitgetInternal || result.source?.kind !== 'wallet') return;
  state.estimateLoading = true;
  state.estimate = null;
  renderPreview();
  try {
    const response = await fetch(`${backendUrl()}/api/transfers/estimate`, {
      method:'POST', headers:backendHeaders(true), cache:'no-store',
      body:JSON.stringify({ from:result.source.address, to:result.address, symbol:result.asset.symbol, amount:String(result.amount) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Estimate service returned ${response.status}`);
    state.estimate = body;
  } catch (error) {
    state.error = error?.message || 'Could not calculate the network fee.';
  } finally {
    state.estimateLoading = false;
    render();
  }
}

function saveDraft() {
  const result = validation();
  if (!result.valid) return;
  state.drafts.unshift({
    id:`draft-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt:Date.now(), mode:state.mode, sourceId:result.source.id, sourceName:result.source.name,
    destinationId:result.destination?.id || null, destinationName:result.destination?.name || null,
    destinationAddress:result.address || null, recipientLabel:el.externalLabel.value.trim(),
    asset:result.asset.symbol, amount:result.amount,
    network:result.bitgetInternal ? 'Bitget internal' : 'Ethereum Mainnet',
    estimatedFeeEth:state.estimate?.feeEth || null,
    executionEnabled:false,
  });
  state.drafts = state.drafts.slice(0, 100);
  saveJson(DRAFTS_KEY, state.drafts);
  renderDrafts();
  el.previewStatus.textContent = 'Draft saved';
  el.previewStatus.classList.add('ready');
}

async function connectMetaMask() {
  if (!window.ethereum?.request) {
    state.error = 'MetaMask is not available in this browser.';
    render();
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method:'eth_requestAccounts' });
    const chainHex = await window.ethereum.request({ method:'eth_chainId' });
    const address = String(accounts?.[0] || '').toLowerCase();
    if (!validAddress(address)) throw new Error('MetaMask did not return a valid Ethereum address');
    state.wallets = state.wallets.filter(wallet => String(wallet.address).toLowerCase() !== address);
    state.wallets.push({ id:`wallet:${address}`, type:'metamask', name:'MetaMask', address, chainId:Number.parseInt(chainHex, 16) || 1 });
    saveJson(WALLETS_KEY, state.wallets);
    state.error = Number.parseInt(chainHex, 16) === 1 ? '' : 'MetaMask is connected, but Ethereum Mainnet must be selected for transfer preview.';
    await refreshSources();
  } catch (error) {
    state.error = error?.message || 'MetaMask connection was cancelled.';
    render();
  }
}

document.querySelectorAll('[data-transfer-mode]').forEach(button => button.addEventListener('click', () => {
  state.mode = button.dataset.transferMode;
  state.estimate = null;
  render();
}));
for (const control of [el.transferSource, el.transferAsset, el.internalDestination, el.transferNetwork]) control.addEventListener('change', () => { state.estimate = null; render(); });
for (const control of [el.internalDepositAddress, el.externalDestination, el.externalLabel, el.transferAmount]) control.addEventListener('input', () => { state.estimate = null; renderPreview(); });
el.maxTransferAmount.addEventListener('click', () => { const asset = currentAsset(); if (asset) el.transferAmount.value = String(asset.available); state.estimate = null; renderPreview(); });
el.calculateTransfer.addEventListener('click', calculateEstimate);
el.saveTransferDraft.addEventListener('click', saveDraft);
el.refreshTransferSources.addEventListener('click', refreshSources);
el.connectMetaMask.addEventListener('click', connectMetaMask);
el.openWatchWallet.addEventListener('click', () => { el.watchWalletError.textContent = ''; el.watchWalletForm.reset(); el.watchWalletDialog.showModal(); });
el.watchWalletForm.addEventListener('submit', event => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  const name = el.watchWalletName.value.trim();
  const address = el.watchWalletAddress.value.trim().toLowerCase();
  if (!name || !validAddress(address)) { el.watchWalletError.textContent = 'Enter a wallet name and a valid Ethereum address.'; return; }
  state.wallets = state.wallets.filter(wallet => String(wallet.address).toLowerCase() !== address);
  state.wallets.push({ id:`wallet:${address}`, type:'watch', name, address, chainId:1 });
  saveJson(WALLETS_KEY, state.wallets);
  el.watchWalletDialog.close();
  refreshSources();
});
el.transferDrafts.addEventListener('click', event => {
  const button = event.target.closest('[data-remove-draft]');
  if (!button) return;
  state.drafts = state.drafts.filter(draft => draft.id !== button.dataset.removeDraft);
  saveJson(DRAFTS_KEY, state.drafts);
  renderDrafts();
});

render();
refreshSources();
setInterval(refreshSources, 30_000);
