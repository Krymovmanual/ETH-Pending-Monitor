const DEFAULT_ADDRESS = '';
const ENDPOINT_KEY = 'eth-pending-monitor-endpoint';
const ADDRESSES_KEY = 'eth-pending-monitor-addresses';
const LABELS_KEY = 'eth-pending-monitor-address-labels';
const EMAIL_KEY = 'eth-pending-monitor-email';
const TELEGRAM_CHAT_KEY = 'paseqa-telegram-chat-id';
const TX_KEY = 'eth-pending-monitor-transactions';
const TOKEN_CACHE_KEY = 'eth-pending-monitor-token-cache';
const BALANCE_SETTINGS_KEY = 'eth-pending-monitor-balance-settings';
const WALLET_BALANCES_KEY = 'eth-pending-monitor-wallet-balances';
const GAS_BALANCE_KEY = 'eth-pending-monitor-gas-balance';
const GAS_ALERT_KEY = 'eth-pending-monitor-gas-alert-sent';
const SOLANA_ADDRESSES_KEY = 'paseqa-solana-addresses';
const SOLANA_LABELS_KEY = 'paseqa-solana-address-labels';
const SOLANA_WALLET_BALANCES_KEY = 'paseqa-solana-wallet-balances';
const SOLANA_GAS_BALANCE_KEY = 'paseqa-solana-gas-balance';
const SOLANA_GAS_ALERT_KEY = 'paseqa-solana-gas-alert-sent';
const BITCOIN_ADDRESSES_KEY = 'paseqa-bitcoin-addresses';
const BITCOIN_LABELS_KEY = 'paseqa-bitcoin-address-labels';
const BITCOIN_WALLET_BALANCES_KEY = 'paseqa-bitcoin-wallet-balances';
const BITCOIN_SETTINGS_KEY = 'paseqa-bitcoin-intelligence-settings';
const PAGE_SIZE_KEY = 'eth-pending-monitor-page-size';
const NOTIFICATION_SETTINGS_KEY = 'eth-pending-monitor-notification-settings';
const SUMMARY_ALERTS_KEY = 'eth-pending-monitor-summary-alerts';
const NEWS_CACHE_KEY = 'eth-pending-monitor-news-cache';
const BACKEND_URL_KEY = 'eth-pending-monitor-backend-url';
const BACKEND_TOKEN_KEY = 'eth-pending-monitor-backend-token';
const PUSH_REGISTERED_KEY = 'eth-pending-monitor-server-push-registered';
const NEWS_REFRESH_MS = 15 * 60 * 1000;
const EXCHANGE_REFRESH_MS = 30 * 1000;
const TRANSACTION_REFRESH_MS = 15 * 1000;
const REQUESTED_VIEW = new URLSearchParams(window.location.search).get('view');
const CURRENT_VIEW = ['wallets', 'networks', 'market'].includes(REQUESTED_VIEW) ? REQUESTED_VIEW : 'overview';

document.body.dataset.view = CURRENT_VIEW;
const VIEW_META={
  overview:{title:'Operations overview',eyebrow:'TREASURY CONTROL PLANE'},
  wallets:{title:'Wallets & transactions',eyebrow:'ON-CHAIN OPERATIONS'},
  networks:{title:'Network operations',eyebrow:'CHAIN INTELLIGENCE'},
  market:{title:'Market intelligence',eyebrow:'DIGITAL ASSET MARKETS'}
};
document.title = `${VIEW_META[CURRENT_VIEW].title} · Treasury Operations Center`;
const pageTitle=document.querySelector('#pageTitle'),pageEyebrow=document.querySelector('#pageEyebrow');
if(pageTitle)pageTitle.textContent=VIEW_META[CURRENT_VIEW].title;
if(pageEyebrow)pageEyebrow.textContent=VIEW_META[CURRENT_VIEW].eyebrow;
document.querySelectorAll('[data-nav-view]').forEach(link => {
  const active = link.dataset.navView === CURRENT_VIEW;
  link.classList.toggle('active', active);
  if (active) link.setAttribute('aria-current', 'page');
  else link.removeAttribute('aria-current');
});

// Remove provider secrets saved by older browser-only versions.
Treasury.storage.removeItem(ENDPOINT_KEY);
Treasury.storage.removeItem('eth-pending-monitor-etherscan-key');
Treasury.storage.removeItem('eth-pending-monitor-cryptocompare-key');
const BALANCE_TOKENS = [
  { symbol: 'USDT ERC-20', contract: '0xdac17f958d2ee523a2206206994597c13d831ec7', decimals: 6 },
  { symbol: 'USDC', contract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6 },
  { symbol: 'LINK', contract: '0x514910771af9ca656af840dff83e8264ecf986ca', decimals: 18 },
  { symbol: 'DAI', contract: '0x6b175474e89094c44da98b954eedeac495271d0f', decimals: 18 },
  { symbol: 'USDS', contract: '0xdc035d45d973e3ec169d2276ddab16f1e407384f', decimals: 18 },
];
const storedNews = loadStoredObject(NEWS_CACHE_KEY);

const state = {
  ws: null,
  endpoint: '',
  backendUrl: location.origin,
  backendToken: '',
  addresses: loadAddresses(),
  addressLabels: loadAddressLabels(),
  solanaAddresses: loadSolanaAddresses(),
  solanaLabels: loadStoredObject(SOLANA_LABELS_KEY),
  bitcoinAddresses: loadBitcoinAddresses(),
  bitcoinLabels: loadStoredObject(BITCOIN_LABELS_KEY),
  bitcoinSettings: {...{lowFeeThreshold:5,expectedPayoutBtc:0.01,checkInterval:600000},...loadStoredObject(BITCOIN_SETTINGS_KEY)},
  email: Treasury.storage.getItem(EMAIL_KEY) || '',
  telegramChatId: Treasury.storage.getItem(TELEGRAM_CHAT_KEY) || '',
  notificationSettings: loadNotificationSettings(),
  summaryAlerts: loadStoredObject(SUMMARY_ALERTS_KEY),
  transactions: loadTransactions(),
  pendingQueue: [],
  tokenCache: loadTokenCache(),
  balanceSettings: loadBalanceSettings(),
  walletBalances: loadStoredObject(WALLET_BALANCES_KEY),
  gasBalance: loadStoredObject(GAS_BALANCE_KEY),
  solanaWalletBalances: loadStoredObject(SOLANA_WALLET_BALANCES_KEY),
  solanaGasBalance: loadStoredObject(SOLANA_GAS_BALANCE_KEY),
  bitcoinWalletBalances: loadStoredObject(BITCOIN_WALLET_BALANCES_KEY),
  balanceLoading: false,
  gasLoading: false,
  balanceLoadError: '',
  gasLoadError: '',
  balanceTimer: null,
  gasTimer: null,
  solanaBalanceLoading: false,
  solanaGasLoading: false,
  solanaGasTimer: null,
  bitcoinBalanceLoading: false,
  alertTimer: null,
  pendingSyncTimer: null,
  transactionSyncTimer: null,
  transactionSyncRunning: false,
  transactionSyncUpdatedAt: 0,
  transactionSyncError: '',
  serverMonitorStatus: null,
  alertEvaluationRunning: false,
  pendingSyncRunning: false,
  pendingSyncUpdatedAt: 0,
  pendingSyncError: '',
  pendingSnapshotError: '',
  pendingDiagnostics: {},
  etherscanDiagnostics: {},
  etherscanSyncError: '',
  newsItems: Array.isArray(storedNews.items) ? storedNews.items : [],
  newsUpdatedAt: Number(storedNews.updatedAt) || 0,
  newsLoading: false,
  newsError: '',
  newsTimer: null,
  newsFilter: 'all',
  newsSource: Array.isArray(storedNews.items) && storedNews.items.length ? 'saved Railway feed' : '',
  gasAnalytics: null,
  gasAnalyticsLoading: false,
  gasAnalyticsError: '',
  gasAnalyticsTimer: null,
  solanaNetwork: null,
  solanaNetworkLoading: false,
  solanaNetworkError: '',
  solanaNetworkTimer: null,
  bitcoinNetwork: null,
  bitcoinNetworkLoading: false,
  bitcoinNetworkError: '',
  bitcoinNetworkTimer: null,
  activeNetwork: 'ethereum',
  exchangeData: null,
  exchangeLoading: false,
  exchangeError: '',
  exchangeTimer: null,
  currentGasPrice: null,
  copiedHash: null,
  reconnectTimer: null,
  manualClose: false,
  searchQuery: '',
  sortKey: 'age',
  sortDirection: 'asc',
  page: 1,
  pageSize: [25, 50, 100].includes(Number(Treasury.storage.getItem(PAGE_SIZE_KEY))) ? Number(Treasury.storage.getItem(PAGE_SIZE_KEY)) : 25,
};

const el = {
  badge: document.querySelector('#connectionBadge'),
  connectionText: document.querySelector('#connectionText'),
  addressList: document.querySelector('#addressList'),
  pendingCount: document.querySelector('#pendingCount'),
  confirmedCount: document.querySelector('#confirmedCount'),
  problemCount: document.querySelector('#problemCount'),
  lastEvent: document.querySelector('#lastEvent'),
  pendingSyncNotice: document.querySelector('#pendingSyncNotice'),
  pendingSyncTitle: document.querySelector('#pendingSyncTitle'),
  pendingSyncMessage: document.querySelector('#pendingSyncMessage'),
  pendingSyncNoticeButton: document.querySelector('#pendingSyncNoticeButton'),
  pendingEtherscanLink: document.querySelector('#pendingEtherscanLink'),
  pendingSyncStatus: document.querySelector('#pendingSyncStatus'),
  pendingSyncButton: document.querySelector('#pendingSyncButton'),
  newsStatus: document.querySelector('#newsStatus'),
  newsGrid: document.querySelector('#newsGrid'),
  newsFilter: document.querySelector('#newsFilter'),
  refreshNewsButton: document.querySelector('#refreshNewsButton'),
  newsStatusSide: document.querySelector('#newsStatusSide'),
  newsGridLeft: document.querySelector('#newsGridLeft'),
  newsGridRight: document.querySelector('#newsGridRight'),
  newsFilterSide: document.querySelector('#newsFilterSide'),
  refreshNewsSideButton: document.querySelector('#refreshNewsSideButton'),
  gasAnalyticsStatus: document.querySelector('#gasAnalyticsStatus'),
  refreshGasAnalyticsButton: document.querySelector('#refreshGasAnalyticsButton'),
  gasAnalyticsBase: document.querySelector('#gasAnalyticsBase'),
  gasAnalyticsLow: document.querySelector('#gasAnalyticsLow'),
  gasAnalyticsStandard: document.querySelector('#gasAnalyticsStandard'),
  gasAnalyticsFast: document.querySelector('#gasAnalyticsFast'),
  gasRecommendation: document.querySelector('#gasRecommendation'),
  gasRecommendationLabel: document.querySelector('#gasRecommendationLabel'),
  gasRecommendationDetail: document.querySelector('#gasRecommendationDetail'),
  gasAnalyticsChange: document.querySelector('#gasAnalyticsChange'),
  gasHourlyBody: document.querySelector('#gasHourlyBody'),
  gasHeatmap: document.querySelector('#gasHeatmap'),
  gasWeekdayChart: document.querySelector('#gasWeekdayChart'),
  gasHourChart: document.querySelector('#gasHourChart'),
  gasTrendChart: document.querySelector('#gasTrendChart'),
  networkHealthBadge: document.querySelector('#networkHealthBadge'),
  networkHealthStatus: document.querySelector('#networkHealthStatus'),
  networkHealthDetail: document.querySelector('#networkHealthDetail'),
  refreshNetworkHealthButton: document.querySelector('#refreshNetworkHealthButton'),
  networkLatestBlock: document.querySelector('#networkLatestBlock'),
  networkBlockAge: document.querySelector('#networkBlockAge'),
  networkBlockTime: document.querySelector('#networkBlockTime'),
  networkRpcLatency: document.querySelector('#networkRpcLatency'),
  networkWalletCount: document.querySelector('#networkWalletCount'),
  networkReadinessList: document.querySelector('#networkReadinessList'),
  feePlannerBody: document.querySelector('#feePlannerBody'),
  solanaNetworkBadge: document.querySelector('#solanaNetworkBadge'),
  solanaNetworkStatus: document.querySelector('#solanaNetworkStatus'),
  solanaNetworkDetail: document.querySelector('#solanaNetworkDetail'),
  refreshSolanaNetworkButton: document.querySelector('#refreshSolanaNetworkButton'),
  solanaNetworkSlot: document.querySelector('#solanaNetworkSlot'),
  solanaNetworkAge: document.querySelector('#solanaNetworkAge'),
  solanaBlockHeight: document.querySelector('#solanaBlockHeight'),
  solanaRpcLatency: document.querySelector('#solanaRpcLatency'),
  solanaPriorityFee: document.querySelector('#solanaPriorityFee'),
  solanaFeeBand: document.querySelector('#solanaFeeBand'),
  bitcoinNetworkBadge: document.querySelector('#bitcoinNetworkBadge'),
  bitcoinNetworkStatus: document.querySelector('#bitcoinNetworkStatus'),
  bitcoinNetworkDetail: document.querySelector('#bitcoinNetworkDetail'),
  refreshBitcoinNetworkButton: document.querySelector('#refreshBitcoinNetworkButton'),
  bitcoinBlockHeight: document.querySelector('#bitcoinBlockHeight'),
  bitcoinNetworkAge: document.querySelector('#bitcoinNetworkAge'),
  bitcoinMempoolCount: document.querySelector('#bitcoinMempoolCount'),
  bitcoinMempoolSize: document.querySelector('#bitcoinMempoolSize'),
  bitcoinStandardFee: document.querySelector('#bitcoinStandardFee'),
  bitcoinRpcLatency: document.querySelector('#bitcoinRpcLatency'),
  bitcoinFeeBand: document.querySelector('#bitcoinFeeBand'),
  bitcoinUtxoHealth: document.querySelector('#bitcoinUtxoHealth'),
  bitcoinWindowSignal:document.querySelector('#bitcoinWindowSignal'),
  bitcoinFeeBaseline:document.querySelector('#bitcoinFeeBaseline'),
  bitcoinFeeThreshold:document.querySelector('#bitcoinFeeThreshold'),
  bitcoinPayoutAmount:document.querySelector('#bitcoinPayoutAmount'),
  saveBitcoinIntelligence:document.querySelector('#saveBitcoinIntelligence'),
  bitcoinPayoutEstimate:document.querySelector('#bitcoinPayoutEstimate'),
  exchangeAccountStatus: document.querySelector('#exchangeAccountStatus'),
  exchangeAccountBody: document.querySelector('#exchangeAccountBody'),
  refreshExchangeButton: document.querySelector('#refreshExchangeButton'),
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
  backendUrl: document.querySelector('#backendUrlInput'),
  backendToken: document.querySelector('#backendTokenInput'),
  backendStatus: document.querySelector('#backendStatus'),
  addresses: document.querySelector('#addressesInput'),
  solanaAddresses: document.querySelector('#solanaAddressesInput'),
  bitcoinAddresses: document.querySelector('#bitcoinAddressesInput'),
  email: document.querySelector('#emailInput'),
  testEmailButton: document.querySelector('#testEmailButton'),
  testEmailStatus: document.querySelector('#testEmailStatus'),
  telegramChatId: document.querySelector('#telegramChatIdInput'),
  testTelegramButton: document.querySelector('#testTelegramButton'),
  testTelegramStatus: document.querySelector('#testTelegramStatus'),
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
  solanaGasName: document.querySelector('#solanaGasNameInput'),
  solanaGasAddress: document.querySelector('#solanaGasAddressInput'),
  solanaGasThreshold: document.querySelector('#solanaGasThresholdInput'),
  solanaGasInterval: document.querySelector('#solanaGasIntervalInput'),
  balanceError: document.querySelector('#balanceDialogError'),
  gasError: document.querySelector('#gasDialogError'),
  notificationDialog: document.querySelector('#notificationSettingsDialog'),
  notificationForm: document.querySelector('#notificationSettingsForm'),
  pendingAlerts: document.querySelector('#pendingAlertsInput'),
  pendingBrowser: document.querySelector('#pendingBrowserInput'),
  pendingEmail: document.querySelector('#pendingEmailInput'),
  pendingTelegram: document.querySelector('#pendingTelegramInput'),
  blockerAlerts: document.querySelector('#blockerAlertsInput'),
  blockerBrowser: document.querySelector('#blockerBrowserInput'),
  blockerEmail: document.querySelector('#blockerEmailInput'),
  blockerTelegram: document.querySelector('#blockerTelegramInput'),
  blockerIgnoreQuiet: document.querySelector('#blockerIgnoreQuietInput'),
  blockerMinutes: document.querySelector('#blockerMinutesInput'),
  blockerRepeat: document.querySelector('#blockerRepeatInput'),
  droppedAlerts: document.querySelector('#droppedAlertsInput'),
  droppedBrowser: document.querySelector('#droppedBrowserInput'),
  droppedEmail: document.querySelector('#droppedEmailInput'),
  droppedTelegram: document.querySelector('#droppedTelegramInput'),
  droppedMinutes: document.querySelector('#droppedMinutesInput'),
  replacedAlerts: document.querySelector('#replacedAlertsInput'),
  replacedBrowser: document.querySelector('#replacedBrowserInput'),
  replacedEmail: document.querySelector('#replacedEmailInput'),
  replacedTelegram: document.querySelector('#replacedTelegramInput'),
  gasAlerts: document.querySelector('#gasAlertsInput'),
  gasBrowser: document.querySelector('#gasBrowserInput'),
  gasEmail: document.querySelector('#gasEmailInput'),
  gasTelegram: document.querySelector('#gasTelegramInput'),
  gasIgnoreQuiet: document.querySelector('#gasIgnoreQuietInput'),
  gasRepeat: document.querySelector('#gasRepeatInput'),
  solanaGasAlerts: document.querySelector('#solanaGasAlertsInput'),
  solanaGasBrowser: document.querySelector('#solanaGasBrowserInput'),
  solanaGasEmail: document.querySelector('#solanaGasEmailInput'),
  solanaGasTelegram: document.querySelector('#solanaGasTelegramInput'),
  solanaGasIgnoreQuiet: document.querySelector('#solanaGasIgnoreQuietInput'),
  solanaGasRepeat: document.querySelector('#solanaGasRepeatInput'),
  bitcoinConsolidationAlerts:document.querySelector('#bitcoinConsolidationAlertsInput'),
  bitcoinConsolidationBrowser:document.querySelector('#bitcoinConsolidationBrowserInput'),
  bitcoinConsolidationEmail:document.querySelector('#bitcoinConsolidationEmailInput'),
  bitcoinConsolidationTelegram:document.querySelector('#bitcoinConsolidationTelegramInput'),
  bitcoinConsolidationIgnoreQuiet:document.querySelector('#bitcoinConsolidationIgnoreQuietInput'),
  bitcoinConsolidationRepeat:document.querySelector('#bitcoinConsolidationRepeatInput'),
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
  overviewSettingsButton: document.querySelector('#overviewSettingsButton'),
  refreshOverviewButton: document.querySelector('#refreshOverviewButton'),
  overviewExchangeEquity: document.querySelector('#overviewExchangeEquity'),
  overviewExchangeScope: document.querySelector('#overviewExchangeScope'),
  overviewUnrealizedPnl: document.querySelector('#overviewUnrealizedPnl'),
  overviewAvailableBalance: document.querySelector('#overviewAvailableBalance'),
  overviewAttentionMetric: document.querySelector('#overviewAttentionMetric'),
  overviewAttentionContext: document.querySelector('#overviewAttentionContext'),
  overviewAttentionCount: document.querySelector('#overviewAttentionCount'),
  overviewAttentionList: document.querySelector('#overviewAttentionList'),
  overviewSystemBadge: document.querySelector('#overviewSystemBadge'),
  overviewSystemLabel: document.querySelector('#overviewSystemLabel'),
  overviewUpdatedAt: document.querySelector('#overviewUpdatedAt'),
  overviewAccountGrid: document.querySelector('#overviewAccountGrid'),
  overviewAccountsMeta: document.querySelector('#overviewAccountsMeta'),
  overviewAccountsFoot: document.querySelector('#overviewAccountsFoot'),
  overviewExposureBody: document.querySelector('#overviewExposureBody'),
  overviewAllocationBody: document.querySelector('#overviewAllocationBody'),
};
const canManageWorkspace = typeof Treasury.can==='function' ? Treasury.can('admin') : true;
[el.settingsButton,el.overviewSettingsButton,el.notificationSettingsButton,el.gasSettingsButton].filter(Boolean).forEach(button=>button.hidden=!canManageWorkspace);

function loadAddresses() {
  try {
    const stored = JSON.parse(Treasury.storage.getItem(ADDRESSES_KEY) || '[]');
    const addresses = Array.isArray(stored) ? stored.filter(address => typeof address === 'string' && validAddress(address)).map(address => address.toLowerCase()) : [];
    return addresses.length ? [...new Set(addresses)].slice(0,50) : [];
  } catch { return []; }
}

function loadSolanaAddresses() {
  try {
    const stored = JSON.parse(Treasury.storage.getItem(SOLANA_ADDRESSES_KEY) || '[]');
    return Array.isArray(stored) ? [...new Set(stored.filter(address => typeof address === 'string' && validSolanaAddress(address)))].slice(0, 50) : [];
  } catch { return []; }
}

function loadBitcoinAddresses() {
  try {
    const stored = JSON.parse(Treasury.storage.getItem(BITCOIN_ADDRESSES_KEY) || '[]');
    return Array.isArray(stored) ? [...new Set(stored.filter(address => typeof address === 'string' && validBitcoinAddress(address)))].slice(0, 25) : [];
  } catch { return []; }
}

function loadTransactions() {
  try {
    const stored = JSON.parse(Treasury.storage.getItem(TX_KEY) || '[]');
    return Array.isArray(stored) ? stored.filter(tx => tx && typeof tx.hash === 'string' && /^0x[0-9a-f]{64}$/i.test(tx.hash) && Number.isFinite(tx.firstSeen) && Number.isInteger(tx.nonce)) : [];
  } catch { return []; }
}

function loadAddressLabels() { return loadStoredObject(LABELS_KEY); }

function loadTokenCache() { return loadStoredObject(TOKEN_CACHE_KEY); }

function loadStoredObject(key) {
  try { const value = JSON.parse(Treasury.storage.getItem(key) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
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
    solanaGasName: 'Solana Gas Station',
    solanaGasAddress: '',
    solanaGasThreshold: 1,
    solanaGasInterval: 300000,
  };
  try { return {...defaults, ...JSON.parse(Treasury.storage.getItem(BALANCE_SETTINGS_KEY) || '{}')}; }
  catch { return defaults; }
}

function loadNotificationSettings() {
  const defaultRules = {
    pending: {enabled:true, browser:true, email:true, telegram:true, afterMinutes:15, repeatMinutes:30},
    blocker: {enabled:true, browser:true, email:true, telegram:true, afterMinutes:15, repeatMinutes:30, ignoreQuiet:true},
    dropped: {enabled:true, browser:true, email:true, telegram:false, afterMinutes:30, repeatMinutes:0},
    replaced: {enabled:true, browser:true, email:true, telegram:false, afterMinutes:0, repeatMinutes:0},
    gasLow: {enabled:true, browser:true, email:true, telegram:false, afterMinutes:0, repeatMinutes:60, ignoreQuiet:true},
    solanaGasLow: {enabled:true, browser:true, email:true, telegram:false, afterMinutes:0, repeatMinutes:60, ignoreQuiet:true},
    bitcoinConsolidation:{enabled:true,browser:true,email:false,telegram:true,afterMinutes:0,repeatMinutes:720,ignoreQuiet:false},
  };
  const defaults = {
    rules: defaultRules,
    checkIntervalSeconds: 10,
    quietHoursEnabled: false,
    quietStart: '22:00',
    quietEnd: '08:00',
  };
  try {
    const stored = JSON.parse(Treasury.storage.getItem(NOTIFICATION_SETTINGS_KEY) || '{}');
    if (stored.rules) {
      const rules = Object.fromEntries(Object.entries(defaultRules).map(([key, rule]) => [key, {...rule, ...(stored.rules[key] || {})}]));
      // Older builds used an immediate (0 minute) blocker alert. Migrate that
      // unsafe default so an old browser configuration cannot bypass the wait.
      if (Number(rules.blocker.afterMinutes) <= 0) rules.blocker.afterMinutes = defaultRules.blocker.afterMinutes;
      return {...defaults, ...stored, rules};
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
        solanaGasLow: {...defaultRules.solanaGasLow, enabled:stored.gasLowEnabled !== false, browser, email, repeatMinutes:Number(stored.repeatMinutes) || 0},
      },
    };
  }
  catch { return defaults; }
}

function saveTransactions() {
  state.transactions = state.transactions.slice(0, 500);
  Treasury.storage.setItem(TX_KEY, JSON.stringify(state.transactions));
}

function parseAddressLines(value, { lowercase = true } = {}) {
  const addresses = [];
  const labels = {};
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.lastIndexOf('|');
    const supplied = (separator >= 0 ? trimmed.slice(separator + 1) : trimmed).trim();
    const address = lowercase ? supplied.toLowerCase() : supplied;
    const label = separator >= 0 ? trimmed.slice(0, separator).trim() : '';
    if (!addresses.includes(address)) addresses.push(address);
    if (label) labels[address] = label.slice(0, 60);
  }
  return { addresses, labels };
}

function validAddress(value) { return /^0x[a-f0-9]{40}$/.test(value); }
function validSolanaAddress(value) {
  const text = String(value || '').trim();
  if (text.length < 32 || text.length > 44) return false;
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let decoded = 0n;
  for (const character of text) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return false;
    decoded = decoded * 58n + BigInt(digit);
  }
  let bytes = decoded === 0n ? 0 : Math.ceil(decoded.toString(16).length / 2);
  for (const character of text) { if (character === '1') bytes += 1; else break; }
  return bytes === 32;
}
function validBitcoinAddress(value) {
  const text = String(value || '').trim();
  return /^(?:[13][1-9A-HJ-NP-Za-km-z]{25,34}|bc1[ac-hj-np-z02-9]{11,87})$/i.test(text) && !(text !== text.toLowerCase() && text !== text.toUpperCase() && /^bc1/i.test(text));
}
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }

function setConnection(status, text) {
  el.badge.className = `connection ${status}`;
  el.connectionText.textContent = text;
  render();
}

function reconnect() {
  clearTimeout(state.reconnectTimer);
  clearInterval(state.pendingSyncTimer);
  if (state.ws) {
    state.manualClose = true;
    state.ws.close();
    state.ws = null;
  }
  setTimeout(connect, 50);
}

async function connect() {
  clearTimeout(state.reconnectTimer);
  if (!backendConfigured()) {
    setConnection('', 'Setup required');
    if (!el.dialog.open) openSettings();
    return;
  }
  if (canManageWorkspace && !state.addresses.length && !state.solanaAddresses.length && !state.bitcoinAddresses.length && !el.dialog.open) openSettings();
  setConnection('', 'Connecting to Railway…');
  await syncServerTransactions();
  updateGasPrice();
  schedulePendingSync(true);
}

function addTransaction(tx, discoveredBy = 'live') {
  const hash = tx.hash.toLowerCase();
  if (state.transactions.some(item => item.hash === hash)) return;

  const from = (tx.from || '').toLowerCase();
  const to = (tx.to || '').toLowerCase();
  const nonce = Number.isInteger(tx.nonce) ? tx.nonce : hexToNumber(tx.nonce);
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
    discoveredBy,
    firstSeen: Date.now(),
    status: 'pending',
    alerts: {},
  };
  state.transactions.unshift(record);
  saveTransactions();
  render();
  if (record.tokenContract) hydrateTokenMetadata(record);
  return record;
}

function serverTransactionRecord(row, existing = null) {
  const raw = row?.tx_data && typeof row.tx_data === 'object' ? row.tx_data : {};
  const hash = String(row?.hash || raw.hash || '').toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(hash)) return null;
  const from = String(row?.from_address || raw.from || '').toLowerCase();
  const to = String(row?.to_address || raw.to || '').toLowerCase();
  const tokenTransfer = parseTokenTransfer(raw.input || raw.data || '0x');
  const matchedAddress = state.addresses.find(address => [from, to, tokenTransfer?.from, tokenTransfer?.recipient].includes(address)) || '';
  let value = 0;
  try { value = Number(BigInt(raw.valueWei ?? raw.value ?? 0)) / 1e18; }
  catch { value = hexToEth(raw.value || '0x0'); }
  const serverStatus = ['pending', 'confirmed', 'failed', 'dropped', 'replaced'].includes(row?.status) ? row.status : 'pending';
  const existingFinal = existing && ['confirmed', 'failed', 'dropped', 'replaced'].includes(existing.status);
  const firstSeen = new Date(row?.first_seen || raw.observedAt || Date.now()).getTime();
  const record = {
    ...(existing || {}),
    hash,
    from,
    to,
    matchedAddress,
    nonce: Number(row?.nonce ?? raw.nonce) || 0,
    value,
    maxFee: Number(raw.maxFeePerGasGwei) || hexToGwei(raw.maxFeePerGas || raw.gasPrice),
    maxPriorityFee: hexToGwei(raw.maxPriorityFeePerGas),
    gasPrice: hexToGwei(raw.gasPrice),
    gasLimit: hexToNumber(raw.gas),
    tokenContract: tokenTransfer ? to : '',
    tokenRecipient: tokenTransfer?.recipient || '',
    rawTokenAmount: tokenTransfer?.rawAmount || '',
    tokenSymbol: existing?.tokenSymbol || (tokenTransfer ? 'ERC-20' : ''),
    tokenName: existing?.tokenName || (tokenTransfer ? 'ERC-20 Token' : ''),
    tokenDecimals: Number.isInteger(existing?.tokenDecimals) ? existing.tokenDecimals : null,
    method: tokenTransfer?.method || raw.method || transactionMethod(raw.input || raw.data || '0x', raw.value || '0x0'),
    discoveredBy: existing?.discoveredBy || 'Railway monitor',
    firstSeen: Number.isFinite(firstSeen) ? firstSeen : Date.now(),
    status: existingFinal && serverStatus === 'pending' ? existing.status : serverStatus,
    replacedBy: row?.replacement_hash || existing?.replacedBy || '',
    alerts: existing?.alerts || {},
  };
  return record;
}

async function syncServerTransactions({ force = false } = {}) {
  if (!backendConfigured() || state.transactionSyncRunning) return;
  state.transactionSyncRunning = true;
  if (force) state.transactionSyncError = '';
  try {
    const response = await fetch(`${normalizedBackendUrl()}/api/transactions?limit=500`, {
      headers: backendHeaders(), cache: 'no-store', signal: AbortSignal.timeout(20000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(body.items)) throw new Error(body.error || `Transaction history returned ${response.status}`);
    state.serverMonitorStatus = body.monitor || null;
    state.pendingQueue = Array.isArray(body.queue) ? body.queue : [];
    const merged = new Map(state.transactions.map(tx => [tx.hash, tx]));
    const tokensToHydrate = [];
    for (const row of body.items) {
      const existing = merged.get(String(row?.hash || '').toLowerCase());
      const record = serverTransactionRecord(row, existing);
      if (!record) continue;
      merged.set(record.hash, record);
      if (record.tokenContract && !Number.isInteger(record.tokenDecimals)) tokensToHydrate.push(record);
    }
    state.transactions = [...merged.values()].sort((a, b) => b.firstSeen - a.firstSeen).slice(0, 500);
    state.transactionSyncUpdatedAt = Date.now();
    state.transactionSyncError = '';
    const monitor = state.serverMonitorStatus;
    setConnection(monitor?.connected && monitor?.subscriptions >= 2 ? 'live' : 'error', monitor?.connected && monitor?.subscriptions >= 2 ? 'Railway · Live' : 'Railway online · Stream unavailable');
    saveTransactions();
    render();
    tokensToHydrate.slice(0, 20).forEach(record => hydrateTokenMetadata(record));
  } catch (error) {
    state.transactionSyncError = error?.message || 'Railway transaction history sync failed';
    setConnection('error', 'Railway sync failed');
    render();
  } finally {
    state.transactionSyncRunning = false;
  }
}

function scheduleServerTransactionSync() {
  clearInterval(state.transactionSyncTimer);
  state.transactionSyncTimer = setInterval(syncServerTransactions, TRANSACTION_REFRESH_MS);
  syncServerTransactions({ force:true });
}

function transactionMatchesMonitoredAddress(tx) {
  const from = (tx.from || '').toLowerCase();
  const to = (tx.to || '').toLowerCase();
  const tokenTransfer = parseTokenTransfer(tx.input || tx.data || '0x');
  return state.addresses.some(address =>
    [from, to, tokenTransfer?.from, tokenTransfer?.recipient].includes(address),
  );
}

function pendingNonceDiagnosticsFromAnswers(answers, fields) {
  const diagnostics = {};
  for (const address of state.addresses) diagnostics[address] = {address, latestNonce:null, pendingNonce:null, expected:0, tracked:0, missing:0};
  for (const field of fields) {
    const answer = answers.get(field.id);
    if (!answer || answer.error || answer.result === undefined || answer.result === null) continue;
    diagnostics[field.address][field.type] = hexToNumber(answer.result);
  }
  for (const diagnostic of Object.values(diagnostics)) {
    const {address, latestNonce, pendingNonce} = diagnostic;
    if (!Number.isInteger(latestNonce) || !Number.isInteger(pendingNonce)) continue;
    diagnostic.expected = Math.max(0, pendingNonce - latestNonce);
    diagnostic.tracked = new Set(state.transactions
      .filter(tx => tx.status === 'pending' && tx.from === address && tx.nonce >= latestNonce && tx.nonce < pendingNonce)
      .map(tx => tx.nonce)).size;
    diagnostic.missing = Math.max(0, diagnostic.expected - diagnostic.tracked);
  }
  return diagnostics;
}

async function fetchPendingNonceDiagnostics() {
  let id = 200000;
  const requests = [];
  const fields = [];
  for (const address of state.addresses) {
    requests.push({id, method:'eth_getTransactionCount', params:[address, 'latest']});
    fields.push({id, address, type:'latestNonce'});
    id += 1;
    requests.push({id, method:'eth_getTransactionCount', params:[address, 'pending']});
    fields.push({id, address, type:'pendingNonce'});
    id += 1;
  }
  const answers = await rpcBatch(requests);
  return {answers, fields, diagnostics:pendingNonceDiagnosticsFromAnswers(answers, fields)};
}

async function fetchEtherscanPendingDiagnostics(alchemyDiagnostics) {
  if (!backendConfigured()) throw new Error('Connect the Railway backend to enable Etherscan cross-checks');
  const diagnostics = {};
  const response = await fetch(`${normalizedBackendUrl()}/api/providers/etherscan/pending-nonces`, {
    method: 'POST', headers: backendHeaders(), body: JSON.stringify({ addresses: state.addresses }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Etherscan proxy returned ${response.status}`);
  for (const item of body.items || []) {
    const address = String(item.address || '').toLowerCase();
    const pendingNonce = Number(item.pendingNonce);
    if (!validAddress(address) || !Number.isInteger(pendingNonce)) continue;
    const alchemy = alchemyDiagnostics[address] || {};
    const latestNonce = Number.isInteger(alchemy.latestNonce) ? alchemy.latestNonce : null;
    const alchemyPendingNonce = Number.isInteger(alchemy.pendingNonce) ? alchemy.pendingNonce : null;
    const expected = latestNonce === null ? 0 : Math.max(0, pendingNonce - latestNonce);
    const tracked = latestNonce === null
      ? 0
      : new Set(state.transactions
        .filter(tx => tx.status === 'pending' && tx.from === address && tx.nonce >= latestNonce && tx.nonce < pendingNonce)
        .map(tx => tx.nonce)).size;
    diagnostics[address] = {
      address, pendingNonce, expected, tracked,
      missing: Math.max(0, expected - tracked),
      extraVsAlchemy: alchemyPendingNonce === null ? 0 : Math.max(0, pendingNonce - alchemyPendingNonce),
    };
  }

  return {
    diagnostics,
    error: body.errors?.length ? `${body.errors.length} Etherscan check${body.errors.length === 1 ? '' : 's'} failed` : '',
  };
}

async function loadPendingBlockSnapshot() {
  const block = await rpc(toHttpEndpoint(state.endpoint), 'eth_getBlockByNumber', ['pending', true]);
  const transactions = Array.isArray(block?.transactions) ? block.transactions : [];
  let added = 0;
  for (const tx of transactions) {
    if (!tx?.hash || tx.blockNumber || !transactionMatchesMonitoredAddress(tx)) continue;
    if (state.transactions.some(item => item.hash === tx.hash.toLowerCase())) continue;
    if (addTransaction(tx, 'pending snapshot')) added += 1;
  }
  return added;
}

async function syncPendingState(scanSnapshot = false) {
  if (!backendConfigured() || !state.addresses.length || state.pendingSyncRunning) return;
  state.pendingSyncRunning = true;
  state.pendingSyncError = '';
  renderPendingSync();
  try {
    let result = await fetchPendingNonceDiagnostics();
    const missingBeforeSnapshot = Object.values(result.diagnostics).reduce((total, item) => total + item.missing, 0);
    if (scanSnapshot || missingBeforeSnapshot > 0) {
      try {
        await loadPendingBlockSnapshot();
        state.pendingSnapshotError = '';
      } catch (error) {
        state.pendingSnapshotError = error?.message || 'Pending block snapshot failed';
      }
      result = {...result, diagnostics:pendingNonceDiagnosticsFromAnswers(result.answers, result.fields)};
    }
    state.pendingDiagnostics = result.diagnostics;
    if (backendConfigured()) {
      try {
        const etherscanResult = await fetchEtherscanPendingDiagnostics(result.diagnostics);
        state.etherscanDiagnostics = etherscanResult.diagnostics;
        state.etherscanSyncError = etherscanResult.error;
      } catch (error) {
        state.etherscanDiagnostics = {};
        state.etherscanSyncError = error?.message || 'Etherscan cross-check failed';
      }
    } else {
      state.etherscanDiagnostics = {};
      state.etherscanSyncError = '';
    }
    state.pendingSyncUpdatedAt = Date.now();
  } catch (error) {
    state.pendingSyncError = error?.message || 'Pending synchronization failed';
  } finally {
    state.pendingSyncRunning = false;
    render();
  }
}

function schedulePendingSync(runImmediately = false) {
  clearInterval(state.pendingSyncTimer);
  state.pendingSyncTimer = setInterval(syncPendingState, 60000);
  if (runImmediately) syncPendingState(true);
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
  if (!metadata && backendConfigured()) {
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
      Treasury.storage.setItem(TOKEN_CACHE_KEY, JSON.stringify(state.tokenCache));
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
  if (!backendConfigured()) return;
  const pending = state.transactions.filter(tx => tx.status === 'pending');
  if (!pending.length) return;
  try {
    const results = await rpcBatch(pending.map((tx, index) => ({
      id: index + 1, method: 'eth_getTransactionReceipt', params: [tx.hash],
    })));
    let changed = false;
    for (const [index, tx] of pending.entries()) {
      const answer = results.get(index + 1);
      if (!answer || answer.error) continue;
      if (answer.result) {
        tx.status = answer.result.status === '0x1' ? 'confirmed' : 'failed';
        tx.blockNumber = hexToNumber(answer.result.blockNumber);
        changed = true;
      } else if (Date.now() - tx.firstSeen > notificationRule('dropped').afterMinutes * 60 * 1000) {
        const stillExists = await rpc('', 'eth_getTransactionByHash', [tx.hash]);
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

async function verifyTransactionsStillPending(transactions) {
  if (!backendConfigured()) return [];
  const candidates = [...new Map(
    transactions
      .filter(tx => tx?.status === 'pending' && tx.hash)
      .map(tx => [tx.hash, tx]),
  ).values()];
  if (!candidates.length) return [];

  try {
    const receiptPayload = candidates.map((tx, index) => ({
      id: index + 1, method: 'eth_getTransactionReceipt', params: [tx.hash],
    }));
    const receipts = await rpcBatch(receiptPayload);
    const unresolved = [];
    let changed = false;

    candidates.forEach((tx, index) => {
      const answer = receipts.get(index + 1);
      if (!answer || answer.error) return;
      if (answer.result) {
        tx.status = answer.result.status === '0x1' ? 'confirmed' : 'failed';
        tx.blockNumber = hexToNumber(answer.result.blockNumber);
        changed = true;
      } else {
        unresolved.push(tx);
      }
    });

    const live = [];
    if (unresolved.length) {
      const transactionPayload = unresolved.map((tx, index) => ({
        id: index + 1, method: 'eth_getTransactionByHash', params: [tx.hash],
      }));
      const currentTransactions = await rpcBatch(transactionPayload);

      unresolved.forEach((tx, index) => {
        const answer = currentTransactions.get(index + 1);
        // Fail closed: a missing/error response, a missing transaction, or a
        // transaction with a block number must never produce a pending alert.
        if (!answer || answer.error || !answer.result || answer.result.blockNumber) return;
        live.push(tx);
      });
    }

    if (changed) {
      saveTransactions();
      render();
    }
    return live;
  } catch {
    // If Alchemy cannot confirm the current state, skip this alert cycle.
    return [];
  }
}

async function verifyLiveBlocker(tx) {
  if (!tx || tx.status !== 'pending' || !state.addresses.includes(tx.from)) return null;
  const requiredAgeMs = Number(notificationRule('blocker').afterMinutes) * 60 * 1000;
  if (Date.now() - tx.firstSeen < requiredAgeMs) return null;

  const possibleQueue = state.transactions.filter(item =>
    item.status === 'pending' && item.from === tx.from && item.nonce >= tx.nonce,
  );
  const live = await verifyTransactionsStillPending(possibleQueue);
  if (!live.includes(tx) || tx.status !== 'pending') return null;

  const higher = live.filter(item => item.nonce > tx.nonce);
  const blockedNonceCount = new Set(higher.map(item => item.nonce)).size;
  if (!blockedNonceCount) return null;

  // A new lower nonce may have arrived while the RPC verification was running.
  if (queueInfo(tx)?.role !== 'blocker') return null;
  return {role: 'blocker', blockerNonce: tx.nonce, count: blockedNonceCount, transactions: higher};
}

async function updateGasPrice() {
  if (!backendConfigured()) return;
  try {
    const result = await rpc(toHttpEndpoint(state.endpoint), 'eth_gasPrice', []);
    state.currentGasPrice = hexToGwei(result);
    render();
  } catch { /* Keep the last successful price. */ }
}

function needsBoost(tx) {
  return !tx.queueSlot && tx.status === 'pending' && state.currentGasPrice > 0 && tx.maxFee > 0 && tx.maxFee < state.currentGasPrice;
}

function transactionRows() {
  const known = new Set(state.transactions
    .filter(tx => tx.status === 'pending')
    .map(tx => `${String(tx.from || '').toLowerCase()}:${Number(tx.nonce)}`));
  const queueSlots = state.pendingQueue
    .filter(slot => !slot.has_full_transaction && !known.has(`${String(slot.from_address || '').toLowerCase()}:${Number(slot.nonce)}`))
    .map(slot => ({
      queueSlot: true,
      id: `queue:${slot.from_address}:${slot.nonce}`,
      hash: '',
      from: String(slot.from_address || '').toLowerCase(),
      to: '',
      matchedAddress: String(slot.from_address || '').toLowerCase(),
      nonce: Number(slot.nonce),
      value: 0,
      maxFee: 0,
      tokenSymbol: '',
      tokenName: '',
      method: '',
      discoveredBy: slot.source || 'Railway nonce reconciliation',
      firstSeen: new Date(slot.first_seen).getTime() || Date.now(),
      lastSeen: new Date(slot.last_seen).getTime() || Date.now(),
      status: 'pending',
    }));
  return [...state.transactions, ...queueSlots];
}

function queueInfo(tx) {
  if (tx.status !== 'pending' || !state.addresses.includes(tx.from)) return null;
  const related = transactionRows().filter(item => item.status === 'pending' && item.from === tx.from);
  const nonces = [...new Set(related.map(item => item.nonce))].sort((a, b) => a - b);
  if (nonces.length < 2) return null;
  const blockerNonce = nonces[0];
  if (tx.nonce === blockerNonce) return { role: 'blocker', blockerNonce, count: nonces.length - 1 };
  if (tx.nonce > blockerNonce) return { role: 'blocked', blockerNonce, count: nonces.length - 1 };
  return null;
}

async function evaluateAlerts() {
  if (state.alertEvaluationRunning) return;
  state.alertEvaluationRunning = true;
  try {
    const pendingAfterMs = notificationRule('pending').afterMinutes * 60 * 1000;
    for (const tx of state.transactions) {
      tx.alerts ||= {};
      if (tx.status === 'dropped' || tx.status === 'replaced') await sendAlert(tx, tx.status);
      const queue = queueInfo(tx);
      if (queue?.role === 'blocker' && Date.now() - tx.firstSeen >= notificationRule('blocker').afterMinutes * 60 * 1000) {
        await sendAlert(tx, 'blocker', queue);
      }
    }
    await evaluatePendingSummaries(pendingAfterMs);
    if (validAddress(state.balanceSettings.gasAddress) && (state.gasBalance.raw || state.gasBalance.raw === '0')) {
      const currentGasBalance = Number(formatTokenAmount(state.gasBalance.raw, 18).replace(/,/g, ''));
      if (currentGasBalance < Number(state.balanceSettings.gasThreshold)) await sendGasAlert(currentGasBalance);
    }
  } finally {
    state.alertEvaluationRunning = false;
  }
}

async function evaluatePendingSummaries(pendingAfterMs) {
  const groups = new Map();
  for (const tx of state.transactions) {
    if (tx.status !== 'pending' || Date.now() - tx.firstSeen < pendingAfterMs) continue;
    const wallet = tx.matchedAddress || tx.from || 'unknown';
    if (!groups.has(wallet)) groups.set(wallet, []);
    groups.get(wallet).push(tx);
  }
  let changed = false;
  for (const [wallet, transactions] of groups) await sendPendingSummary(wallet, transactions);
  for (const wallet of Object.keys(state.summaryAlerts)) {
    if (!groups.has(wallet)) { delete state.summaryAlerts[wallet]; changed = true; }
  }
  if (changed) Treasury.storage.setItem(SUMMARY_ALERTS_KEY, JSON.stringify(state.summaryAlerts));
}

async function sendPendingSummary(wallet, transactions) {
  const rule = notificationRule('pending');
  if (!rule.enabled || inQuietHours('pending') || !transactions.length) return;
  const walletPending = state.transactions.filter(tx =>
    tx.status === 'pending' && (tx.matchedAddress || tx.from || 'unknown') === wallet,
  );
  const verifiedPending = await verifyTransactionsStillPending(walletPending);
  const sorted = verifiedPending
    .filter(tx => Date.now() - tx.firstSeen >= rule.afterMinutes * 60 * 1000)
    .sort((a, b) => a.nonce - b.nonce);
  if (!sorted.length) return;
  const verifiedQueueInfo = tx => {
    if (!verifiedPending.includes(tx) || !state.addresses.includes(tx.from)) return null;
    const nonces = [...new Set(
      verifiedPending.filter(item => item.from === tx.from).map(item => item.nonce),
    )].sort((a, b) => a - b);
    if (nonces.length < 2) return null;
    const blockerNonce = nonces[0];
    if (tx.nonce === blockerNonce) return {role:'blocker', blockerNonce, count:nonces.length - 1};
    if (tx.nonce > blockerNonce) return {role:'blocked', blockerNonce, count:nonces.length - 1};
    return null;
  };
  const signature = sorted.map(tx => {
    const queue = verifiedQueueInfo(tx);
    return `${tx.hash}:${needsBoost(tx) ? 'boost' : 'ok'}:${queue?.role || 'none'}:${queue?.count || 0}`;
  }).sort().join(',');
  const previous = state.summaryAlerts[wallet] || {};
  if (previous.signature === signature && !alertCanRepeat(previous.sentAt, 'stuck_summary')) return;
  const channels = activeAlertChannels('pending');
  if (!channels.browser && !channels.email) return;
  const blocker = sorted.find(tx => verifiedQueueInfo(tx)?.role === 'blocker');
  const boostTransactions = sorted.filter(needsBoost);
  const actionable = blocker && needsBoost(blocker) ? blocker : boostTransactions[0];
  const primary = actionable || blocker || sorted[0];
  const count = sorted.length;
  const title = actionable
    ? `Boost required: ${shortHash(actionable.hash)}${verifiedQueueInfo(actionable)?.role === 'blocker' ? ` is blocking ${verifiedQueueInfo(actionable).count}` : ''}`
    : `${count} transaction${count === 1 ? '' : 's'} pending for ${rule.afterMinutes}+ minutes`;
  const cause = blocker
    ? `TX ${blocker.hash} (nonce ${blocker.nonce}) is blocking ${verifiedQueueInfo(blocker).count}; ${needsBoost(blocker) ? `boost required — max fee ${compactNumber(blocker.maxFee, 2)} vs network ${compactNumber(state.currentGasPrice, 2)} Gwei` : 'fee looks sufficient, cause unknown'}.`
    : boostTransactions.length
      ? `${boostTransactions.length} transaction${boostTransactions.length === 1 ? '' : 's'} need a boost.`
      : 'Fees look sufficient; cause unknown.';
  const browserCause = blocker
    ? `${actionable === blocker ? 'Blocking' : `${shortHash(blocker.hash)} is blocking`} ${verifiedQueueInfo(blocker).count}; ${needsBoost(blocker) ? 'boost required' : 'fee looks sufficient'}.`
    : boostTransactions.length ? `${boostTransactions.length} need a boost.` : 'Fees look sufficient.';
  const bodyText = actionable
    ? `${walletLabel(wallet)} · ${shortHash(actionable.hash)} · nonce ${actionable.nonce} · ${browserCause}`
    : `${walletLabel(wallet)}: ${count} pending. ${browserCause}`;
  state.summaryAlerts[wallet] = {signature, sentAt:Date.now()};
  Treasury.storage.setItem(SUMMARY_ALERTS_KEY, JSON.stringify(state.summaryAlerts));
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
      ? `Boost required: TX ${actionable.hash}${verifiedQueueInfo(actionable)?.role === 'blocker' ? ` is blocking ${verifiedQueueInfo(actionable).count} transactions` : ''}`
      : title;
    try { await sendEmail(state.email, emailSubject, primary, 'stuck_summary', {count, transactions:sorted, blocker, boostTransactions, cause}); }
    catch {
      if (!browserDelivered) delete state.summaryAlerts[wallet];
      Treasury.storage.setItem(SUMMARY_ALERTS_KEY, JSON.stringify(state.summaryAlerts));
    }
  }
}

function ruleNameForKind(kind) {
  return ({stuck:'pending', stuck_summary:'pending', blocker:'blocker', dropped:'dropped', replaced:'replaced', gasLow:'gasLow', solanaGasLow:'solanaGasLow'})[kind] || kind;
}

function notificationRule(kind) {
  return state.notificationSettings.rules[ruleNameForKind(kind)] || {enabled:false, browser:false, email:false, telegram:false, afterMinutes:0, repeatMinutes:0};
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
  if (backendConfigured()) return { browser: false, email: false };
  return {
    browser: Boolean(rule.browser && 'Notification' in window && Notification.permission === 'granted'),
    email: Boolean(rule.email && validEmail(state.email)),
  };
}

async function sendAlert(tx, kind, context = {}) {
  tx.alerts ||= {};
  const rule = notificationRule(kind);
  if (!rule.enabled || inQuietHours(kind)) return;
  if (kind === 'blocker') {
    const verifiedContext = await verifyLiveBlocker(tx);
    if (!verifiedContext) return;
    context = verifiedContext;
  }
  const alertKey = kind === 'blocker' ? `blocker-${context.count}` : kind;
  if (!alertCanRepeat(tx.alerts[alertKey], kind)) return;
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
    const emailTitle = kind === 'blocker' ? `URGENT: TX ${tx.hash} is blocking ${context.count} transaction${context.count === 1 ? '' : 's'}` : title;
    try { await sendEmail(state.email, emailTitle, tx, kind, context); }
    catch {
      if (!browserDelivered) delete tx.alerts[alertKey];
      saveTransactions();
    }
  }
}

function alertTitle(kind, tx = null, context = {}) {
  if (kind === 'blocker') {
    const count = context.count || 0;
    return `URGENT: ${shortHash(tx?.hash || '')} is blocking ${count} transaction${count === 1 ? '' : 's'}`;
  }
  return ({
    stuck: `Transaction pending for ${notificationRule('pending').afterMinutes}+ minutes`,
    stuck_summary: `Transactions pending for ${notificationRule('pending').afterMinutes}+ minutes`,
    dropped: 'Transaction dropped',
    replaced: 'Transaction replaced',
    test: 'Treasury Operations Center test alert',
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
    if (backendConfigured()) {
      const response = await fetch(`${normalizedBackendUrl()}/api/test-email`, {
        method: 'POST', headers: backendHeaders(), body: JSON.stringify({ email }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Server email test failed');
    } else {
      await sendEmail(email, alertTitle('test'), null, 'test');
    }
    state.email = email;
    Treasury.storage.setItem(EMAIL_KEY, email);
    showTestStatus('Sent. Check your inbox and confirm the address if requested.');
  } catch (error) {
    showTestStatus(error.message || 'Could not send the test email.', true);
  } finally {
    el.testEmailButton.disabled = false;
  }
}

function showTelegramTestStatus(message, isError = false) {
  el.testTelegramStatus.textContent = message;
  el.testTelegramStatus.classList.toggle('error', isError);
}

async function sendTestTelegram() {
  const chatId = el.telegramChatId.value.trim();
  if (!/^-?\d{5,20}$/.test(chatId)) {
    showTelegramTestStatus('Enter the numeric group chat ID, for example -1001234567890.', true);
    return;
  }
  el.testTelegramButton.disabled = true;
  showTelegramTestStatus('Sending…');
  try {
    const response = await fetch(`${normalizedBackendUrl()}/api/test-telegram`, {
      method: 'POST', headers: backendHeaders(), body: JSON.stringify({chatId}),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Telegram test failed');
    state.telegramChatId = chatId;
    Treasury.storage.setItem(TELEGRAM_CHAT_KEY, chatId);
    showTelegramTestStatus('Sent. The group is connected.');
  } catch (error) {
    showTelegramTestStatus(error.message || 'Could not send the Telegram test.', true);
  } finally {
    el.testTelegramButton.disabled = false;
  }
}

async function enableNotifications() {
  if (!('Notification' in window)) {
    el.notificationStatus.textContent = 'This browser does not support notifications.';
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    try {
      const serverPush = await subscribeServerPush();
      updateNotificationStatus(permission, serverPush);
      if (serverPush) {
        const response = await fetch(`${normalizedBackendUrl()}/api/test-push`, {
          method: 'POST', headers: backendHeaders(), body: JSON.stringify({ url: location.href }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Server push test failed');
      } else {
        new Notification('Treasury Operations Center', { body: 'Browser notifications are enabled.' });
      }
    } catch (error) {
      updateNotificationStatus(permission, false);
      el.notificationStatus.textContent = error.message || 'Browser notifications work while this page is open; server push setup failed.';
    }
  } else updateNotificationStatus(permission);
}

function updateNotificationStatus(permission = ('Notification' in window ? Notification.permission : 'unsupported'), serverPush = Treasury.storage.getItem(PUSH_REGISTERED_KEY) === 'true') {
  const registered = Boolean(serverPush && backendConfigured());
  const messages = {
    granted: registered ? '24/7 browser push notifications are enabled.' : 'Browser notifications are enabled. Connect this browser to Railway for 24/7 alerts.',
    denied: 'Notifications are blocked. Allow them in your browser site settings.',
    default: 'Click the button to allow browser notifications.',
    unsupported: 'This browser does not support notifications.',
  };
  el.notificationStatus.textContent = messages[permission] || messages.default;
  el.notificationButton.textContent = permission === 'granted'
    ? (registered ? '24/7 browser notifications enabled' : 'Connect browser to 24/7 alerts')
    : 'Enable browser notifications';
  el.notificationButton.disabled = permission === 'granted' && registered;
}

async function rpc(_endpoint, method, params) {
  if (!backendConfigured()) throw new Error('Configure Railway connection first');
  const response = await fetch(`${normalizedBackendUrl()}/api/providers/alchemy/rpc`, {
    method: 'POST', headers: backendHeaders(), signal: AbortSignal.timeout(25000),
    body: JSON.stringify({jsonrpc:'2.0', id:1, method, params}),
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(response.status === 401 ? 'Access denied: check your server access token' : body.error?.message || body.error || `RPC ${method} failed (${response.status})`);
  return body.result;
}

async function rpcBatch(requests) {
  const endpoint = `${normalizedBackendUrl()}/api/providers/alchemy/rpc`;
  const answers = new Map();
  for (let start = 0; start < requests.length; start += 100) {
    const chunk = requests.slice(start, start + 100);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: backendHeaders(), signal: AbortSignal.timeout(25000),
      body: JSON.stringify(chunk.map(item => ({jsonrpc:'2.0', ...item}))),
    });
    const body = await response.json();
    if (!response.ok || !Array.isArray(body)) throw new Error('RPC batch request failed');
    for (const answer of body) answers.set(answer.id, answer);
  }
  return answers;
}

function balanceOfData(address) {
  return `0x70a08231${address.slice(2).padStart(64, '0')}`;
}

async function updateWalletBalances() {
  if (!backendConfigured() || !state.balanceSettings.enabled || state.balanceLoading) return;
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
    Treasury.storage.setItem(WALLET_BALANCES_KEY, JSON.stringify(next));
  } catch {
    state.balanceLoadError = 'Update failed. Try again.';
  } finally {
    state.balanceLoading = false;
    renderBalances();
  }
}

async function updateSolanaWalletBalances() {
  if (!backendConfigured() || !state.balanceSettings.enabled || !state.solanaAddresses.length || state.solanaBalanceLoading) return;
  state.solanaBalanceLoading = true;
  state.balanceLoadError = '';
  renderBalances();
  try {
    const response = await fetch(`${normalizedBackendUrl()}/api/wallets/solana/balances`, {
      method:'POST', headers:backendHeaders(), signal:AbortSignal.timeout(25_000),
      body:JSON.stringify({addresses:state.solanaAddresses}),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(body.wallets)) throw new Error(body.error || 'Solana balance request failed');
    state.solanaWalletBalances = Object.fromEntries(body.wallets.map(wallet => [wallet.address, {updatedAt:body.updatedAt, assets:wallet.assets || []}]));
    Treasury.storage.setItem(SOLANA_WALLET_BALANCES_KEY, JSON.stringify(state.solanaWalletBalances));
  } catch (error) {
    state.balanceLoadError = error?.message || 'Solana balance update failed';
  } finally {
    state.solanaBalanceLoading = false;
    renderBalances();
  }
}

async function updateBitcoinWalletBalances() {
  if (!backendConfigured() || !state.balanceSettings.enabled || !state.bitcoinAddresses.length || state.bitcoinBalanceLoading) return;
  state.bitcoinBalanceLoading = true;
  state.balanceLoadError = '';
  renderBalances();
  try {
    const response = await fetch(`${normalizedBackendUrl()}/api/wallets/bitcoin/balances`, {
      method:'POST', headers:backendHeaders(), signal:AbortSignal.timeout(30_000),
      body:JSON.stringify({addresses:state.bitcoinAddresses,expectedPayoutBtc:state.bitcoinSettings.expectedPayoutBtc}),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(body.wallets)) throw new Error(body.error || 'Bitcoin balance request failed');
    state.bitcoinWalletBalances = Object.fromEntries(body.wallets.map(wallet => [wallet.address, {updatedAt:body.updatedAt, balance:wallet.balance, utxos:wallet.utxos || []}]));
    Treasury.storage.setItem(BITCOIN_WALLET_BALANCES_KEY, JSON.stringify(state.bitcoinWalletBalances));
  } catch (error) {
    state.balanceLoadError = error?.message || 'Bitcoin balance update failed';
  } finally {
    state.bitcoinBalanceLoading = false;
    renderBalances();
    renderBitcoinNetwork();
  }
}

async function updateGasBalance() {
  const settings = state.balanceSettings;
  if (!backendConfigured() || !validAddress(settings.gasAddress) || state.gasLoading) return;
  state.gasLoading = true;
  state.gasLoadError = '';
  renderBalances();
  try {
    const result = await rpc(toHttpEndpoint(state.endpoint), 'eth_getBalance', [settings.gasAddress, 'latest']);
    const raw = BigInt(result).toString();
    const previousRaw = state.gasBalance.raw;
    const changeRaw = previousRaw !== undefined && previousRaw !== null ? (BigInt(raw) - BigInt(previousRaw)).toString() : null;
    state.gasBalance = {raw, decimals:18, updatedAt:Date.now(), changeRaw};
    Treasury.storage.setItem(GAS_BALANCE_KEY, JSON.stringify(state.gasBalance));
    const current = Number(formatTokenAmount(state.gasBalance.raw, 18).replace(/,/g, ''));
    if (current < Number(settings.gasThreshold)) await sendGasAlert(current);
    else Treasury.storage.removeItem(GAS_ALERT_KEY);
  } catch {
    state.gasLoadError = 'Update failed. Try again.';
  } finally {
    state.gasLoading = false;
    renderBalances();
  }
}

async function updateSolanaGasBalance() {
  const settings = state.balanceSettings;
  if (!backendConfigured() || !validSolanaAddress(settings.solanaGasAddress) || state.solanaGasLoading) return;
  state.solanaGasLoading = true;
  state.gasLoadError = '';
  renderBalances();
  try {
    const response = await fetch(`${normalizedBackendUrl()}/api/wallets/solana/balances`, {
      method:'POST', headers:backendHeaders(), signal:AbortSignal.timeout(25_000),
      body:JSON.stringify({addresses:[settings.solanaGasAddress]}),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Solana Gas Station request failed');
    const asset = body.wallets?.[0]?.assets?.find(item => item.symbol === 'SOL');
    if (!asset) throw new Error('SOL balance was not returned');
    const previousRaw = state.solanaGasBalance.raw;
    const raw = String(asset.raw);
    const changeRaw = previousRaw !== undefined && previousRaw !== null ? (BigInt(raw) - BigInt(previousRaw)).toString() : null;
    state.solanaGasBalance = {raw, decimals:9, updatedAt:Number(body.updatedAt) || Date.now(), changeRaw};
    Treasury.storage.setItem(SOLANA_GAS_BALANCE_KEY, JSON.stringify(state.solanaGasBalance));
    const current = Number(formatTokenAmount(raw, 9).replace(/,/g, ''));
    if (current < Number(settings.solanaGasThreshold)) await sendGasAlert(current, 'solana');
    else Treasury.storage.removeItem(SOLANA_GAS_ALERT_KEY);
  } catch (error) {
    state.gasLoadError = error?.message || 'Solana Gas Station update failed';
  } finally {
    state.solanaGasLoading = false;
    renderBalances();
  }
}

async function sendGasAlert(currentBalance, network = 'ethereum') {
  const solana = network === 'solana';
  const alertKey = solana ? SOLANA_GAS_ALERT_KEY : GAS_ALERT_KEY;
  const lastSent = Number(Treasury.storage.getItem(alertKey) || 0);
  const ruleName = solana ? 'solanaGasLow' : 'gasLow';
  const rule = notificationRule(ruleName);
  if (!rule.enabled || inQuietHours(ruleName) || !alertCanRepeat(lastSent, ruleName)) return;
  const channels = activeAlertChannels(ruleName);
  if (!channels.browser && !channels.email) return;
  Treasury.storage.setItem(alertKey, String(Date.now()));
  const settings = state.balanceSettings;
  const symbol = solana ? 'SOL' : 'ETH';
  const name = solana ? settings.solanaGasName : settings.gasName;
  const threshold = solana ? settings.solanaGasThreshold : settings.gasThreshold;
  const address = solana ? settings.solanaGasAddress : settings.gasAddress;
  const title = `URGENT: ${symbol} Gas Station balance is low`;
  const bodyText = `${name}: ${compactNumber(currentBalance, 6)} ${symbol}. Minimum: ${compactNumber(threshold, 6)} ${symbol}.`;
  let browserDelivered = false;
  if (channels.browser) {
    try { new Notification(title, {body:bodyText, tag:solana ? 'solana-gas-station-low' : 'ethereum-gas-station-low', requireInteraction:true}); browserDelivered = true; }
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
        network:solana ? 'Solana' : 'Ethereum',
        gas_station:name,
        address,
        current_balance:`${compactNumber(currentBalance, 6)} ${symbol}`,
        minimum_balance:`${compactNumber(threshold, 6)} ${symbol}`,
        checked_at:new Date().toISOString(),
      }),
    });
    if (!response.ok) throw new Error('Email failed');
  } catch {
    if (!browserDelivered) Treasury.storage.removeItem(alertKey);
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
  clearInterval(state.solanaGasTimer);
  const settings = state.balanceSettings;
  if (settings.enabled) {
    if (Number(settings.balanceInterval) > 0) state.balanceTimer = setInterval(() => {
      updateWalletBalances();
      updateSolanaWalletBalances();
      updateBitcoinWalletBalances();
    }, Number(settings.balanceInterval));
    const latest = Math.max(0, ...Object.values(state.walletBalances).map(item => item?.updatedAt || 0));
    if (force || isRefreshDue(latest, settings.balanceInterval)) updateWalletBalances();
    const solanaLatest = Math.max(0, ...Object.values(state.solanaWalletBalances).map(item => item?.updatedAt || 0));
    if (state.solanaAddresses.length && (force || isRefreshDue(solanaLatest, settings.balanceInterval))) updateSolanaWalletBalances();
    const bitcoinLatest = Math.max(0, ...Object.values(state.bitcoinWalletBalances).map(item => item?.updatedAt || 0));
    if (state.bitcoinAddresses.length && (force || isRefreshDue(bitcoinLatest, settings.balanceInterval))) updateBitcoinWalletBalances();
  }
  if (validSolanaAddress(settings.solanaGasAddress)) {
    if (Number(settings.solanaGasInterval) > 0) state.solanaGasTimer = setInterval(updateSolanaGasBalance, Number(settings.solanaGasInterval));
    if (force || isRefreshDue(state.solanaGasBalance.updatedAt, settings.solanaGasInterval)) updateSolanaGasBalance();
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

function cleanNewsText(value, maximumLength = 500) {
  const entities = {'&amp;':'&', '&quot;':'"', '&#39;':"'", '&apos;':"'", '&lt;':'<', '&gt;':'>'};
  const text = String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|quot|#39|apos|lt|gt);/g, entity => entities[entity] || entity)
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maximumLength ? `${text.slice(0, maximumLength - 1).trim()}…` : text;
}

function safeNewsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}

function normalizeNewsItem(item) {
  const url = safeNewsUrl(item?.url || item?.guid);
  const title = cleanNewsText(item?.title, 220);
  if (!url || !title) return null;
  const publishedSeconds = Number(item.published_on);
  const categories = String(item.categories || '')
    .split(/[|,]/)
    .map(category => cleanNewsText(category, 30))
    .filter(Boolean)
    .slice(0, 8);
  return {
    id: String(item.id || url),
    title,
    summary: cleanNewsText(item.body, 420),
    url,
    source: cleanNewsText(item.source_info?.name || item.source || 'Crypto news', 60),
    publishedAt: Number.isFinite(publishedSeconds) && publishedSeconds > 0 ? publishedSeconds * 1000 : Date.now(),
    categories,
  };
}

function newsMatchesFilter(item, filter) {
  if (filter === 'all') return true;
  const text = [item.title, item.summary, item.categories.join(' ')].join(' ').toLowerCase();
  const patterns = {
    ethereum: /\b(ethereum|ether|eth|erc-?20|defi|stablecoin|usdt|usdc|dai|gas fee)\b/i,
    bitcoin: /\b(bitcoin|btc|satoshi|lightning)\b/i,
    market: /\b(market|price|trading|exchange|etf|bull|bear|rally|institutional|liquidity)\b/i,
    regulation: /\b(regulation|regulator|regulated|sec|policy|law|legal|compliance|court|government)\b/i,
  };
  return patterns[filter]?.test(text) || false;
}

function renderNews() {
  el.refreshNewsButton.disabled = state.newsLoading;
  el.refreshNewsButton.textContent = state.newsLoading ? 'Refreshing…' : 'Refresh news';
  el.refreshNewsSideButton.disabled = state.newsLoading;
  el.refreshNewsSideButton.textContent = state.newsLoading ? 'Refreshing…' : 'Refresh';
  let statusText = 'News not loaded yet';
  if (state.newsLoading && !state.newsItems.length) statusText = 'Loading market updates…';
  else if (state.newsLoading) statusText = 'Updating news…';
  else if (state.newsError && state.newsItems.length) statusText = 'Showing saved news · update unavailable';
  else if (state.newsError) statusText = 'News temporarily unavailable';
  else if (state.newsUpdatedAt) statusText = `Updated ${age(state.newsUpdatedAt)} ago · every 15 minutes · ${state.newsSource || 'public feed'}`;
  el.newsStatus.textContent = statusText;
  el.newsStatusSide.textContent = statusText;
  el.newsFilter.value = state.newsFilter;
  el.newsFilterSide.value = state.newsFilter;

  const visible = state.newsItems
    .filter(item => newsMatchesFilter(item, state.newsFilter))
    .sort((left, right) => right.publishedAt - left.publishedAt)
    .slice(0, 6);
  if (!visible.length) {
    const message = state.newsError && !state.newsItems.length
      ? 'The Railway news feed is unavailable. Check the server connection and try again.'
      : 'No recent stories match this filter.';
    el.newsGrid.innerHTML = `<div class="news-empty">${escapeHtml(message)}</div>`;
    el.newsGridLeft.innerHTML = `<div class="news-side-empty">${escapeHtml(message)}</div>`;
    el.newsGridRight.innerHTML = '';
    return;
  }
  const cardMarkup = (item, compact = false) => {
    const tags = item.categories.slice(0, 2).map(category => `<span class="news-tag">${escapeHtml(category)}</span>`).join('');
    return `<article class="news-card${compact ? ' compact' : ''}">
      <div class="news-meta"><span class="news-source">${escapeHtml(item.source)}</span><time datetime="${new Date(item.publishedAt).toISOString()}">${age(item.publishedAt)} ago</time></div>
      <h3><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h3>
      <p class="news-summary">${escapeHtml(item.summary || 'Open the article to read the full story.')}</p>
      <div class="news-footer"><div class="news-tags">${tags}</div><a class="news-read" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Read article ↗</a></div>
    </article>`;
  };
  el.newsGrid.innerHTML = visible.slice(0, 6).map(item => cardMarkup(item)).join('');
  el.newsGridLeft.innerHTML = visible.slice(0, 4).map(item => cardMarkup(item, true)).join('');
  el.newsGridRight.innerHTML = visible.slice(4, 8).map(item => cardMarkup(item, true)).join('');
}

async function updateNews({ force = false } = {}) {
  if (state.newsLoading) return;
  state.newsLoading = true;
  state.newsError = '';
  renderNews();
  try {
    if (!backendConfigured()) throw new Error('Connect Railway to load crypto news');
    const url = `${normalizedBackendUrl()}/api/providers/cryptocompare/news${force ? '?refresh=1' : ''}`;
    const response = await fetch(url, { headers: backendHeaders() });
    const body = await response.json();
    const providerItems = body?.items;
    if (!response.ok || !Array.isArray(providerItems)) throw new Error(body?.error || 'News request failed');
    const items = providerItems.map(normalizeNewsItem).filter(Boolean).slice(0, 40);
    if (!items.length) throw new Error('No news returned');
    state.newsItems = items;
    state.newsUpdatedAt = Number(body.updatedAt) || Date.now();
    state.newsSource = 'Railway feed';
    Treasury.storage.setItem(NEWS_CACHE_KEY, JSON.stringify({updatedAt:state.newsUpdatedAt, items}));
  } catch (error) {
    state.newsError = error?.message || 'News update failed';
  } finally {
    state.newsLoading = false;
    renderNews();
  }
}

function scheduleNewsRefresh() {
  clearInterval(state.newsTimer);
  state.newsTimer = setInterval(updateNews, NEWS_REFRESH_MS);
  if (!state.newsUpdatedAt || Date.now() - state.newsUpdatedAt >= NEWS_REFRESH_MS) updateNews();
  else renderNews();
}

function gasNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? compactNumber(number, number < 1 ? 3 : 2) : '—';
}

function gasLevel(value, baseline) {
  const gas = Number(value);
  const p35 = Number(baseline?.p35);
  const p70 = Number(baseline?.p70);
  if (!Number.isFinite(gas) || !Number.isFinite(p35) || !Number.isFinite(p70)) return 'collecting';
  return gas <= p35 ? 'low' : gas <= p70 ? 'normal' : 'high';
}

function renderGasHourly(hourly, baseline) {
  if (!hourly.length) {
    el.gasHourlyBody.innerHTML = '<tr><td colspan="5" class="gas-history-empty">Collecting the first hourly samples…</td></tr>';
    return;
  }
  el.gasHourlyBody.innerHTML = hourly.slice(0, 24).map(row => {
    const level = gasLevel(row.standard, baseline);
    const label = ({low:'Low', normal:'Normal', high:'High', collecting:'New'})[level];
    const hour = new Intl.DateTimeFormat(undefined, {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}).format(new Date(row.hour));
    return `<tr>
      <td><time datetime="${new Date(row.hour).toISOString()}">${escapeHtml(hour)}</time></td>
      <td>${gasNumber(row.minimum)}</td>
      <td><strong>${gasNumber(row.standard)}</strong></td>
      <td>${gasNumber(row.maximum)}</td>
      <td><span class="gas-level ${level}">${label}</span></td>
    </tr>`;
  }).join('');
}

function renderGasHeatmap(items) {
  if (!items.length) {
    el.gasHeatmap.innerHTML = '<div class="gas-history-empty">The heatmap will fill as gas history is collected.</div>';
    return;
  }
  const values = items.map(item => Number(item.value)).filter(Number.isFinite);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = Math.max(0.0001, maximum - minimum);
  const lookup = new Map(items.map(item => [`${item.weekday}-${item.hour}`, item]));
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let markup = '<div class="gas-heatmap-grid"><span class="heatmap-corner"></span>';
  for (let hour = 0; hour < 24; hour += 1) markup += `<span class="heatmap-hour">${hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}</span>`;
  weekdays.forEach((day, dayIndex) => {
    markup += `<strong class="heatmap-day">${day}</strong>`;
    for (let hour = 0; hour < 24; hour += 1) {
      const item = lookup.get(`${dayIndex + 1}-${hour}`);
      if (!item) {
        markup += '<span class="heatmap-cell missing" title="No data yet"></span>';
        continue;
      }
      const value = Number(item.value);
      const ratio = (value - minimum) / range;
      const alpha = (0.16 + ratio * 0.76).toFixed(2);
      markup += `<span class="heatmap-cell" style="background:rgba(98,126,234,${alpha})" title="${day} ${String(hour).padStart(2, '0')}:00 · ${gasNumber(value)} Gwei · ${Number(item.minutes)} min"></span>`;
    }
  });
  el.gasHeatmap.innerHTML = `${markup}</div><div class="heatmap-scale"><span>${gasNumber(minimum)} Gwei</span><span>${gasNumber(maximum)} Gwei</span></div>`;
}

function renderGasDistributionChart(container, items, labels, accessibleLabel) {
  const rows = (Array.isArray(items) ? items : []).map(item => ({
    bucket:Number(item.bucket), minutes:Number(item.minutes), minimum:Number(item.minimum),
    q1:Number(item.q1), median:Number(item.median), q3:Number(item.q3), maximum:Number(item.maximum),
  })).filter(item => labels[item.bucket] !== undefined && ['minimum','q1','median','q3','maximum'].every(key => Number.isFinite(item[key])));
  if (!container || !rows.length) {
    if (container) container.innerHTML = '<div class="gas-history-empty">More history is needed for this chart.</div>';
    return;
  }
  const width=960,height=270,left=52,right=18,top=18,bottom=42,plotWidth=width-left-right,plotHeight=height-top-bottom;
  const highest=Math.max(...rows.map(row=>row.maximum),.01),step=10**Math.floor(Math.log10(highest)),ceiling=Math.ceil(highest/step)*step;
  const y=value=>top+plotHeight-(Math.max(0,value)/ceiling)*plotHeight;
  const slot=plotWidth/rows.length,boxWidth=Math.max(8,Math.min(46,slot*.48));
  let grid='';
  for(let index=0;index<=4;index+=1){const value=ceiling*index/4,position=y(value);grid+=`<line x1="${left}" y1="${position}" x2="${width-right}" y2="${position}" class="chart-grid"/><text x="${left-10}" y="${position+4}" class="chart-axis" text-anchor="end">${gasNumber(value)}</text>`;}
  const boxes=rows.map((row,index)=>{const x=left+slot*(index+.5),label=labels[row.bucket];return `<g><title>${escapeHtml(String(label))}: median ${gasNumber(row.median)} Gwei · range ${gasNumber(row.minimum)}–${gasNumber(row.maximum)} · ${row.minutes.toLocaleString()} samples</title><line x1="${x}" y1="${y(row.maximum)}" x2="${x}" y2="${y(row.minimum)}" class="box-whisker"/><line x1="${x-boxWidth*.3}" y1="${y(row.maximum)}" x2="${x+boxWidth*.3}" y2="${y(row.maximum)}" class="box-whisker"/><line x1="${x-boxWidth*.3}" y1="${y(row.minimum)}" x2="${x+boxWidth*.3}" y2="${y(row.minimum)}" class="box-whisker"/><rect x="${x-boxWidth/2}" y="${y(row.q3)}" width="${boxWidth}" height="${Math.max(2,y(row.q1)-y(row.q3))}" class="box-range"/><line x1="${x-boxWidth/2}" y1="${y(row.median)}" x2="${x+boxWidth/2}" y2="${y(row.median)}" class="box-median"/><text x="${x}" y="${height-16}" class="chart-axis" text-anchor="middle">${escapeHtml(String(label))}</text></g>`;}).join('');
  container.innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(accessibleLabel)}">${grid}${boxes}<text x="${left}" y="11" class="chart-unit">Gwei</text></svg>`;
}

function renderGasTrendChart(hourly) {
  const rows=(Array.isArray(hourly)?hourly:[]).map(row=>({hour:new Date(row.hour),value:Number(row.standard)})).filter(row=>Number.isFinite(row.hour.getTime())&&Number.isFinite(row.value)).sort((a,b)=>a.hour-b.hour).slice(-24);
  if(!el.gasTrendChart||rows.length<2){if(el.gasTrendChart)el.gasTrendChart.innerHTML='<div class="gas-history-empty">At least two hourly samples are needed.</div>';return;}
  const recent=rows.slice(-Math.min(8,rows.length)),count=recent.length,meanX=(count-1)/2,meanY=recent.reduce((sum,row)=>sum+row.value,0)/count;
  const denominator=recent.reduce((sum,_row,index)=>sum+(index-meanX)**2,0)||1;
  const slope=recent.reduce((sum,row,index)=>sum+(index-meanX)*(row.value-meanY),0)/denominator;
  const last=rows.at(-1),projection=Array.from({length:6},(_item,index)=>({hour:new Date(last.hour.getTime()+(index+1)*3600000),value:Math.max(0,last.value+slope*(index+1)*(.82**index))}));
  const all=[...rows,...projection],width=960,height=250,left=52,right=18,top=18,bottom=40,plotWidth=width-left-right,plotHeight=height-top-bottom;
  const maximum=Math.max(...all.map(row=>row.value),.01)*1.12,y=value=>top+plotHeight-(value/maximum)*plotHeight,x=index=>left+(index/(all.length-1))*plotWidth;
  let grid='';for(let index=0;index<=4;index+=1){const value=maximum*index/4,position=y(value);grid+=`<line x1="${left}" y1="${position}" x2="${width-right}" y2="${position}" class="chart-grid"/><text x="${left-10}" y="${position+4}" class="chart-axis" text-anchor="end">${gasNumber(value)}</text>`;}
  const actualPath=rows.map((row,index)=>`${index?'L':'M'}${x(index).toFixed(1)},${y(row.value).toFixed(1)}`).join(' ');
  const projectedRows=[last,...projection],offset=rows.length-1,projectedPath=projectedRows.map((row,index)=>`${index?'L':'M'}${x(offset+index).toFixed(1)},${y(row.value).toFixed(1)}`).join(' ');
  const labels=all.map((row,index)=>index%4===0||index===all.length-1?`<text x="${x(index)}" y="${height-14}" class="chart-axis" text-anchor="middle">${escapeHtml(new Intl.DateTimeFormat(undefined,{hour:'2-digit'}).format(row.hour))}</text>`:'').join('');
  const dots=rows.map((row,index)=>`<circle cx="${x(index)}" cy="${y(row.value)}" r="2.5" class="trend-dot"><title>${row.hour.toLocaleString()} · ${gasNumber(row.value)} Gwei</title></circle>`).join('');
  el.gasTrendChart.innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Observed standard gas price and six-hour statistical projection">${grid}<path d="${actualPath}" class="trend-actual"/><path d="${projectedPath}" class="trend-projected"/>${dots}${labels}<text x="${left}" y="11" class="chart-unit">Gwei</text></svg>`;
}

function renderNetworkHealth() {
  const data = state.gasAnalytics;
  const network = data?.network;
  const level = network?.level || (state.gasAnalyticsError ? 'unavailable' : 'checking');
  const labels = { healthy:'Operational', degraded:'Degraded', unavailable:'Unavailable', checking:'Checking' };
  el.networkHealthBadge.className = `connection compact ${level === 'healthy' ? 'live' : level === 'checking' ? '' : 'error'}`;
  el.networkHealthStatus.textContent = labels[level] || 'Checking';
  el.networkHealthDetail.textContent = state.gasAnalyticsError
    ? state.gasAnalyticsError
    : network
      ? `${network.analyticsStreamConnected && network.transactionStreamConnected ? 'Both live streams connected' : 'One or more streams require attention'} · Ethereum chain ID ${network.chainId}`
      : 'Checking block delivery, RPC and transaction streams…';
  el.refreshNetworkHealthButton.disabled = state.gasAnalyticsLoading;
  el.refreshNetworkHealthButton.textContent = state.gasAnalyticsLoading ? 'Refreshing…' : 'Refresh';
  const hasValue = value => value !== null && value !== undefined && Number.isFinite(Number(value));
  el.networkLatestBlock.textContent = hasValue(network?.latestBlock) ? Number(network.latestBlock).toLocaleString() : '—';
  el.networkBlockAge.textContent = hasValue(network?.blockAgeSeconds) ? `Received ${Number(network.blockAgeSeconds)}s ago` : 'Waiting for data';
  el.networkBlockTime.textContent = hasValue(network?.blockIntervalSeconds) ? `${Number(network.blockIntervalSeconds)} sec` : '—';
  el.networkRpcLatency.textContent = hasValue(network?.rpcLatencyMs) ? `${Number(network.rpcLatencyMs)} ms` : '—';
  el.networkWalletCount.textContent = hasValue(network?.monitoredAddresses) ? String(network.monitoredAddresses) : '—';

  const readiness = [
    {
      label:'Transaction monitoring',
      detail:network?.lastTransactionAt ? `Last pending event ${age(new Date(network.lastTransactionAt).getTime())} ago` : 'Waiting for a monitored transaction',
      value:network?.transactionStreamConnected ? 'Connected' : 'Disconnected',
      level:network?.transactionStreamConnected ? 'ok' : 'critical',
    },
    {
      label:'Block analytics',
      detail:hasValue(network?.blockAgeSeconds) ? `Latest block sample is ${Number(network.blockAgeSeconds)} seconds old` : 'No block sample received yet',
      value:network?.analyticsStreamConnected ? 'Connected' : 'Disconnected',
      level:network?.analyticsStreamConnected ? 'ok' : 'critical',
    },
  ];
  if (network?.gasStation) {
    readiness.push({
      label:network.gasStation.name || 'Gas Station',
      detail:`Minimum reserve ${compactNumber(network.gasStation.threshold, 6)} ETH`,
      value:`${compactNumber(network.gasStation.balance, 6)} ETH`,
      level:network.gasStation.sufficient ? 'ok' : 'critical',
    });
  } else {
    readiness.push({ label:'Gas reserve', detail:'Configure a Gas Station wallet in Wallets', value:'Not configured', level:'warning' });
  }
  const warning = Array.isArray(network?.warnings) ? network.warnings[0] : '';
  readiness.push(warning
    ? { label:'Network warning', detail:warning, value:'Review', level:'warning' }
    : { label:'Network incidents', detail:'No active infrastructure warnings', value:'Clear', level:'ok' });
  el.networkReadinessList.innerHTML = readiness.map(item => `<div class="network-readiness-item"><span class="overview-status-dot ${item.level}" aria-hidden="true"></span><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></span><span class="network-readiness-value ${item.level}">${escapeHtml(item.value)}</span></div>`).join('');

  const feePlanner = Array.isArray(data?.feePlanner) ? data.feePlanner : [];
  el.feePlannerBody.innerHTML = feePlanner.length ? feePlanner.map(tier => `<tr><td><span class="fee-mode ${escapeHtml(tier.key)}">${escapeHtml(tier.label)}</span></td><td><strong>${gasNumber(tier.feeGwei)} Gwei</strong></td><td>${escapeHtml(tier.confirmation)}</td><td><strong>${compactNumber(tier.nativeTransferEth, 8)} ETH</strong><small>21,000 gas</small></td><td><strong>${compactNumber(tier.erc20TransferEth, 8)} ETH</strong><small>65,000 gas estimate</small></td></tr>`).join('') : '<tr><td colspan="5">Waiting for fee data…</td></tr>';
}

function renderGasAnalytics() {
  el.refreshGasAnalyticsButton.disabled = state.gasAnalyticsLoading;
  el.refreshGasAnalyticsButton.textContent = state.gasAnalyticsLoading ? 'Refreshing…' : 'Refresh';
  const data = state.gasAnalytics;
  const current = data?.current;
  if (state.gasAnalyticsLoading && !data) el.gasAnalyticsStatus.textContent = 'Loading live gas data…';
  else if (state.gasAnalyticsError && data) el.gasAnalyticsStatus.textContent = `Showing saved analytics · ${state.gasAnalyticsError}`;
  else if (state.gasAnalyticsError) el.gasAnalyticsStatus.textContent = state.gasAnalyticsError;
  else if (current?.sampledAt) el.gasAnalyticsStatus.textContent = `Block ${current.blockNumber?.toLocaleString() || '—'} · updated ${age(new Date(current.sampledAt).getTime())} ago · 180-day history`;
  else el.gasAnalyticsStatus.textContent = data?.status?.error || 'Waiting for the next Ethereum block…';

  el.gasAnalyticsBase.textContent = gasNumber(current?.baseFee);
  el.gasAnalyticsLow.textContent = gasNumber(current?.low);
  el.gasAnalyticsStandard.textContent = gasNumber(current?.standard);
  el.gasAnalyticsFast.textContent = gasNumber(current?.fast);
  const recommendation = data?.recommendation || {level:'collecting', label:'Building baseline', confidence:'Low'};
  el.gasRecommendation.className = `gas-recommendation ${recommendation.level}`;
  el.gasRecommendationLabel.textContent = recommendation.label;
  const minutes = Number(data?.baseline?.minutes) || 0;
  el.gasRecommendationDetail.textContent = recommendation.level === 'collecting'
    ? `${minutes} of 60 baseline minutes collected.`
    : `${recommendation.confidence} confidence · compared with ${minutes.toLocaleString()} stored minutes.`;
  const change = Number(current?.changePercent);
  el.gasAnalyticsChange.textContent = Number.isFinite(change) ? `${change >= 0 ? '+' : ''}${change.toFixed(1)}% / block` : '—';
  el.gasAnalyticsChange.classList.toggle('spike', Boolean(current?.spike));
  renderGasHourly(Array.isArray(data?.hourly) ? data.hourly : [], data?.baseline);
  renderGasHeatmap(Array.isArray(data?.heatmap) ? data.heatmap : []);
  renderGasDistributionChart(el.gasWeekdayChart, data?.distributions?.weekday, {1:'Mon',2:'Tue',3:'Wed',4:'Thu',5:'Fri',6:'Sat',7:'Sun'}, 'Standard gas price distribution by weekday');
  renderGasDistributionChart(el.gasHourChart, data?.distributions?.hour, Object.fromEntries(Array.from({length:24},(_item,hour)=>[hour,String(hour).padStart(2,'0')])), 'Standard gas price distribution by hour');
  renderGasTrendChart(data?.hourly);
  renderNetworkHealth();
}

async function updateGasAnalytics() {
  if (state.gasAnalyticsLoading) return;
  state.gasAnalyticsLoading = true;
  state.gasAnalyticsError = '';
  renderGasAnalytics();
  try {
    if (!backendConfigured()) throw new Error('Connect Railway to load Gas Analytics.');
    const response = await fetch(`${normalizedBackendUrl()}/api/gas-analytics`, { headers: backendHeaders(), cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Gas Analytics request failed');
    state.gasAnalytics = body;
  } catch (error) {
    state.gasAnalyticsError = error?.message || 'Gas Analytics temporarily unavailable.';
  } finally {
    state.gasAnalyticsLoading = false;
    renderGasAnalytics();
  }
}

function scheduleGasAnalyticsRefresh() {
  clearInterval(state.gasAnalyticsTimer);
  state.gasAnalyticsTimer = setInterval(updateGasAnalytics, 15_000);
  updateGasAnalytics();
}

function renderSolanaNetwork() {
  if (!el.solanaNetworkBadge) return;
  const data = state.solanaNetwork;
  const unavailable = Boolean(state.solanaNetworkError);
  const healthy = data?.level === 'healthy' && !unavailable;
  el.solanaNetworkBadge.className = `connection compact ${healthy ? 'live' : unavailable ? 'error' : ''}`;
  el.solanaNetworkStatus.textContent = healthy ? 'Operational' : unavailable ? 'Unavailable' : 'Checking';
  el.solanaNetworkDetail.textContent = unavailable ? state.solanaNetworkError : data ? `Alchemy RPC is healthy · confirmed commitment` : 'Checking Solana RPC health and priority fees…';
  el.refreshSolanaNetworkButton.disabled = state.solanaNetworkLoading;
  el.refreshSolanaNetworkButton.textContent = state.solanaNetworkLoading ? 'Refreshing…' : 'Refresh';
  el.solanaNetworkSlot.textContent = Number.isFinite(data?.slot) ? data.slot.toLocaleString() : '—';
  el.solanaNetworkAge.textContent = data?.sampledAt ? `Updated ${age(data.sampledAt)} ago` : 'Waiting for data';
  el.solanaBlockHeight.textContent = Number.isFinite(data?.blockHeight) ? data.blockHeight.toLocaleString() : '—';
  el.solanaRpcLatency.textContent = Number.isFinite(data?.rpcLatencyMs) ? `${data.rpcLatencyMs} ms` : '—';
  const fee = data?.priorityFeeMicroLamports || {};
  el.solanaPriorityFee.textContent = Number.isFinite(fee.median) ? compactNumber(fee.median, 0) : '—';
  el.solanaFeeBand.innerHTML = Number.isFinite(fee.median)
    ? `<article><span>Economy</span><strong>${compactNumber(fee.low, 0)}</strong><small>µ-lamports / CU</small></article><article class="solana-fee-primary"><span>Typical</span><strong>${compactNumber(fee.median, 0)}</strong><small>µ-lamports / CU</small></article><article><span>Priority</span><strong>${compactNumber(fee.high, 0)}</strong><small>µ-lamports / CU</small></article><article><span>Samples</span><strong>${Number(fee.samples || 0).toLocaleString()}</strong><small>recent fee observations</small></article>`
    : `<div class="network-empty">${escapeHtml(state.solanaNetworkError || 'Waiting for Solana priority fee samples…')}</div>`;
}

async function updateSolanaNetwork() {
  if (state.solanaNetworkLoading || !backendConfigured()) return;
  state.solanaNetworkLoading = true;
  state.solanaNetworkError = '';
  renderSolanaNetwork();
  try {
    const response = await fetch(`${normalizedBackendUrl()}/api/networks/solana`, {headers:backendHeaders(), cache:'no-store', signal:AbortSignal.timeout(25_000)});
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Solana network request failed');
    state.solanaNetwork = body;
  } catch (error) {
    state.solanaNetworkError = error?.message || 'Solana network data is unavailable';
  } finally {
    state.solanaNetworkLoading = false;
    renderSolanaNetwork();
  }
}

function scheduleSolanaNetworkRefresh() {
  clearInterval(state.solanaNetworkTimer);
  state.solanaNetworkTimer = setInterval(() => { if (state.activeNetwork === 'solana') updateSolanaNetwork(); }, 30_000);
  renderSolanaNetwork();
}

function renderBitcoinNetwork() {
  if (!el.bitcoinNetworkBadge) return;
  const data = state.bitcoinNetwork;
  const unavailable = Boolean(state.bitcoinNetworkError);
  const healthy = data?.level === 'healthy' && !unavailable;
  el.bitcoinNetworkBadge.className = `connection compact ${healthy ? 'live' : unavailable ? 'error' : ''}`;
  el.bitcoinNetworkStatus.textContent = healthy ? 'Operational' : unavailable ? 'Unavailable' : data ? 'Degraded' : 'Checking';
  el.bitcoinNetworkDetail.textContent = unavailable ? state.bitcoinNetworkError : data ? 'Alchemy RPC · chain, mempool and fee market' : 'Checking chain synchronization, mempool and fee estimates…';
  el.refreshBitcoinNetworkButton.disabled = state.bitcoinNetworkLoading;
  el.refreshBitcoinNetworkButton.textContent = state.bitcoinNetworkLoading ? 'Refreshing…' : 'Refresh';
  el.bitcoinBlockHeight.textContent = Number.isFinite(data?.blocks) ? data.blocks.toLocaleString() : '—';
  el.bitcoinNetworkAge.textContent = data?.sampledAt ? `Updated ${age(data.sampledAt)} ago` : 'Waiting for data';
  el.bitcoinMempoolCount.textContent = Number.isFinite(data?.mempool?.transactions) ? data.mempool.transactions.toLocaleString() : '—';
  el.bitcoinMempoolSize.textContent = Number.isFinite(data?.mempool?.vsize) ? `${compactNumber(data.mempool.vsize / 1_000_000, 2)} MvB queued` : 'Unconfirmed transactions';
  el.bitcoinStandardFee.textContent = Number.isFinite(data?.feeSatVbyte?.standard) ? compactNumber(data.feeSatVbyte.standard, 2) : '—';
  el.bitcoinRpcLatency.textContent = Number.isFinite(data?.rpcLatencyMs) ? `${data.rpcLatencyMs} ms` : '—';
  const fees = data?.feeSatVbyte || {};
  el.bitcoinFeeBand.innerHTML = ['economy','standard','priority'].map((key, index) => `<article class="${key === 'standard' ? 'bitcoin-fee-primary' : ''}"><span>${['Economy · 6 blocks','Standard · 3 blocks','Priority · next block'][index]}</span><strong>${Number.isFinite(fees[key]) ? compactNumber(fees[key], 2) : '—'}</strong><small>sat/vB</small></article>`).join('');
  const intelligence=data?.feeIntelligence||{};
  el.bitcoinWindowSignal.textContent=intelligence.lowWindow?'Consolidate now':'Wait';
  el.bitcoinWindowSignal.className=intelligence.lowWindow?'positive':'neutral';
  el.bitcoinFeeBaseline.textContent=Number.isFinite(Number(intelligence.baseline?.p25))?compactNumber(intelligence.baseline.p25,2):'Collecting';
  el.bitcoinFeeThreshold.value=state.bitcoinSettings.lowFeeThreshold;
  el.bitcoinPayoutAmount.value=state.bitcoinSettings.expectedPayoutBtc;
  const rows = state.bitcoinAddresses.map(address => {
    const health = state.bitcoinWalletBalances[address]?.balance;
    if (!health) return `<div class="utxo-health-row"><span class="utxo-orb"></span><span><strong>${escapeHtml(state.bitcoinLabels[address] || shortAddress(address))}</strong><small>${escapeHtml(shortAddress(address))}</small></span><span class="utxo-health-value">Waiting</span></div>`;
    const fee = health.estimatedConsolidation?.feeSats;
    return `<div class="utxo-health-row"><span class="utxo-orb ${escapeHtml(health.level)}"></span><span><strong>${escapeHtml(state.bitcoinLabels[address] || shortAddress(address))}</strong><small>${health.count} UTXOs · ${health.dust} dust · ${escapeHtml(health.totalBtc)} BTC</small></span><span class="utxo-health-value ${escapeHtml(health.level)}"><strong>${escapeHtml(health.recommendation)}</strong><small>${Number.isFinite(fee) ? `Consolidation ≈ ${fee.toLocaleString()} sats` : 'Fee estimate unavailable'}</small></span></div>`;
  }).join('');
  el.bitcoinUtxoHealth.innerHTML = rows || '<div class="network-empty">Add a public Bitcoin address in Wallet settings to inspect its UTXO fragmentation.</div>';
  const payoutRows=state.bitcoinAddresses.map(address=>{
    const estimate=state.bitcoinWalletBalances[address]?.balance?.estimatedPayout;
    const label=state.bitcoinLabels[address]||shortAddress(address);
    if(!estimate)return`<div class="bitcoin-payout-row"><strong>${escapeHtml(label)}</strong><span>Waiting for UTXO data</span></div>`;
    const detail=estimate.available
      ? `${estimate.inputs} input${estimate.inputs===1?'':'s'} · ≈ ${Number(estimate.feeSats||0).toLocaleString()} sats · ${estimate.vbytes} vB`
      : `Insufficient confirmed balance · short ${Number(estimate.shortfallSats||0).toLocaleString()} sats`;
    return`<div class="bitcoin-payout-row"><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(estimate.payoutBtc)} BTC payout</small></span><span class="${estimate.available?'positive':'negative'}">${detail}</span></div>`;
  });
  el.bitcoinPayoutEstimate.innerHTML=payoutRows.join('')||'<div class="network-empty">Add a watched Bitcoin address to estimate the next payout.</div>';
}

async function updateBitcoinNetwork() {
  if (state.bitcoinNetworkLoading || !backendConfigured()) return;
  state.bitcoinNetworkLoading = true;
  state.bitcoinNetworkError = '';
  renderBitcoinNetwork();
  try {
    const response = await fetch(`${normalizedBackendUrl()}/api/networks/bitcoin`, {headers:backendHeaders(), cache:'no-store', signal:AbortSignal.timeout(25_000)});
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Bitcoin network request failed');
    state.bitcoinNetwork = body;
  } catch (error) {
    state.bitcoinNetworkError = error?.message || 'Bitcoin network data is unavailable';
  } finally {
    state.bitcoinNetworkLoading = false;
    renderBitcoinNetwork();
  }
}

function setActiveNetwork(network) {
  state.activeNetwork = ['ethereum','solana','bitcoin'].includes(network) ? network : 'ethereum';
  document.querySelectorAll('[data-network-view]').forEach(button => {
    const active = button.dataset.networkView === state.activeNetwork;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-network-panel]').forEach(panel => { panel.hidden = panel.dataset.networkPanel !== state.activeNetwork; });
  if (state.activeNetwork === 'solana' && !state.solanaNetwork) updateSolanaNetwork();
  if (state.activeNetwork === 'bitcoin') {
    if (!state.bitcoinNetwork) updateBitcoinNetwork();
    if (state.bitcoinAddresses.length && !Object.keys(state.bitcoinWalletBalances).length) updateBitcoinWalletBalances();
  }
}

function scheduleBitcoinNetworkRefresh() {
  clearInterval(state.bitcoinNetworkTimer);
  state.bitcoinNetworkTimer = setInterval(() => { if (state.activeNetwork === 'bitcoin') updateBitcoinNetwork(); }, 30_000);
  renderBitcoinNetwork();
}

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
  return [tx.hash, tx.nonce, tx.from, tx.to, matched, walletLabel(matched), tx.tokenSymbol, tx.tokenName, tx.tokenContract,
    tx.queueSlot ? 'unresolved queue nonce hash unavailable action required' : transactionAmount(tx), statusLabel(tx.status)]
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
    if (state.sortKey === 'maxFee') comparison = (Number(a.maxFee) || 0) - (Number(b.maxFee) || 0);
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

function renderPendingSync() {
  const diagnostics = Object.values(state.pendingDiagnostics);
  const etherscanDiagnostics = Object.values(state.etherscanDiagnostics);
  const expected = diagnostics.reduce((total, item) => total + Number(item.expected || 0), 0);
  const tracked = diagnostics.reduce((total, item) => total + Number(item.tracked || 0), 0);
  const missing = diagnostics.reduce((total, item) => total + Number(item.missing || 0), 0);
  const etherscanExtra = etherscanDiagnostics.reduce((total, item) => total + Number(item.extraVsAlchemy || 0), 0);
  const recoveredSlots = state.pendingQueue.filter(item => !item.has_full_transaction).length;

  el.pendingSyncButton.disabled = state.pendingSyncRunning || state.transactionSyncRunning || !backendConfigured();
  el.pendingSyncNoticeButton.disabled = state.pendingSyncRunning || !backendConfigured();
  el.pendingSyncButton.textContent = state.pendingSyncRunning ? 'Syncing…' : 'Sync pending';
  el.pendingSyncNoticeButton.textContent = state.pendingSyncRunning ? 'Scanning…' : 'Scan again';
  el.pendingEtherscanLink.hidden = true;
  el.pendingEtherscanLink.removeAttribute('href');

  const historyStatus = state.transactionSyncError
    ? ` Railway history error: ${state.transactionSyncError}.`
    : state.transactionSyncUpdatedAt ? ` Railway history updated ${age(state.transactionSyncUpdatedAt)} ago.` : '';
  if (state.pendingSyncRunning || state.transactionSyncRunning) {
    el.pendingSyncStatus.textContent = 'Checking existing pending transactions…';
  } else if (state.pendingSyncError) {
    el.pendingSyncStatus.textContent = 'Pending sync failed.';
  } else if (state.pendingSyncUpdatedAt) {
    const source = backendConfigured() ? ' Alchemy + server-side Etherscan checked.' : ' Alchemy checked; connect Railway to enable Etherscan.';
    el.pendingSyncStatus.textContent = `Pending sync checked ${age(state.pendingSyncUpdatedAt)} ago.${source}${state.pendingSnapshotError ? ' Full snapshot unavailable.' : ''}${historyStatus}`;
  } else {
    el.pendingSyncStatus.textContent = `Pending sync not run yet.${historyStatus}`;
  }
  el.pendingSyncStatus.className = 'sync-status';

  if (state.pendingSyncError) {
    el.pendingSyncNotice.hidden = false;
    el.pendingSyncTitle.textContent = 'Pending synchronization unavailable';
    el.pendingSyncMessage.textContent = `${state.pendingSyncError}. Live WebSocket monitoring continues.`;
    return;
  }
  if (etherscanExtra > 0) {
    const affectedItems = etherscanDiagnostics.filter(item => item.extraVsAlchemy > 0);
    const affected = affectedItems
      .map(item => `${walletLabel(item.address)}: +${item.extraVsAlchemy}`)
      .join(' · ');
    const firstAddress = affectedItems[0]?.address;
    el.pendingSyncNotice.hidden = false;
    el.pendingSyncTitle.textContent = `Etherscan detects ${etherscanExtra} additional pending transaction${etherscanExtra === 1 ? '' : 's'}`;
    el.pendingSyncMessage.textContent = `Etherscan's pending nonce is higher than Alchemy's — ${affected}. Railway keeps these nonce slots visible and advances the blocker after each confirmation, even when the provider does not expose their hashes.${state.etherscanSyncError ? ` ${state.etherscanSyncError}.` : ''}`;
    if (firstAddress) {
      el.pendingEtherscanLink.href = `https://etherscan.io/txsPending?a=${firstAddress}&m=hf`;
      el.pendingEtherscanLink.hidden = false;
    }
    return;
  }
  if (missing > 0) {
    const affected = diagnostics
      .filter(item => item.missing > 0)
      .map(item => `${walletLabel(item.address)}: ${item.missing}`)
      .join(' · ');
    el.pendingSyncNotice.hidden = false;
    el.pendingSyncTitle.textContent = recoveredSlots
      ? `${recoveredSlots} pending nonce${recoveredSlots === 1 ? '' : 's'} recovered by Railway`
      : `${missing} pending transaction${missing === 1 ? '' : 's'} detected without full details`;
    const snapshotNote = state.pendingSnapshotError ? ` Full snapshot error: ${state.pendingSnapshotError}.` : '';
    el.pendingSyncMessage.textContent = recoveredSlots
      ? `The queue remains actionable by nonce — ${affected}. Hash and fee details will appear automatically if the RPC exposes them; until then, open the signer or Etherscan pending queue.${snapshotNote}`
      : `Alchemy nonce state indicates ${expected} pending nonce${expected === 1 ? '' : 's'}; ${tracked} ${tracked === 1 ? 'is' : 'are'} loaded in the table. Missing by wallet — ${affected}. The node did not expose their TX hashes.${snapshotNote}`;
    return;
  }
  if (state.pendingSnapshotError) {
    el.pendingSyncNotice.hidden = false;
    el.pendingSyncTitle.textContent = 'Full pending snapshot unavailable';
    el.pendingSyncMessage.textContent = `${state.pendingSnapshotError}. Live WebSocket monitoring and outgoing nonce checks continue, but transactions already pending before this page opened may be incomplete.`;
    return;
  }
  if (state.etherscanSyncError) {
    el.pendingSyncNotice.hidden = false;
    el.pendingSyncTitle.textContent = 'Etherscan cross-check unavailable';
    el.pendingSyncMessage.textContent = `${state.etherscanSyncError}. Alchemy monitoring continues normally. Check ETHERSCAN_API_KEY in Railway or try again later.`;
    return;
  }
  el.pendingSyncNotice.hidden = true;
}

function overviewStatusMarkup(label, detail, level = 'ok', href = '') {
  const content = `<span class="overview-status-dot ${level}" aria-hidden="true"></span><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(detail)}</small></span>`;
  const external = /^https?:\/\//i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
  return href
    ? `<a class="overview-list-item" href="${escapeHtml(href)}"${external}>${content}<span class="overview-arrow">→</span></a>`
    : `<div class="overview-list-item">${content}</div>`;
}

function renderOverview() {
  if (!el.overviewExchangeEquity) return;
  const overview = window.TreasuryOverview.summarize(state.exchangeData);
  const accounts = overview.accounts;
  const positions = overview.positions;
  const pending = transactionRows().filter(tx => tx.status === 'pending');
  const problems = state.transactions.filter(tx => ['dropped', 'replaced', 'failed'].includes(tx.status));
  const blockerCount = pending.filter(tx => queueInfo(tx)?.role === 'blocker').length;
  const pnl = overview.pnl.value;

  el.overviewExchangeEquity.textContent = exchangeMoney(overview.equity.value);
  el.overviewExchangeScope.textContent = accounts.length
    ? `${overview.exchangeCount} exchange${overview.exchangeCount === 1 ? '' : 's'} · ${accounts.length} account${accounts.length === 1 ? '' : 's'}`
    : 'No exchange accounts connected';
  el.overviewUnrealizedPnl.textContent = pnl !== null ? exchangeSignedMoney(pnl) : '—';
  el.overviewUnrealizedPnl.className = pnl !== null ? (pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : 'neutral') : '';
  el.overviewAvailableBalance.textContent = exchangeMoney(overview.available.value);

  const attention = [];
  if (blockerCount) attention.push({ label:`${blockerCount} nonce blocker${blockerCount === 1 ? '' : 's'}`, detail:'Higher nonce transactions may be unable to confirm.', level:'critical', href:'index.html?view=wallets' });
  if (pending.length) attention.push({ label:`${pending.length} pending transaction${pending.length === 1 ? '' : 's'}`, detail:'Review age, gas and queue position.', level:'warning', href:'index.html?view=wallets' });
  if (state.pendingSyncError) attention.push({ label:'Pending synchronization unavailable', detail:state.pendingSyncError, level:'warning', href:'index.html?view=wallets' });
  if (state.transactionSyncError) attention.push({ label:'Railway transaction history unavailable', detail:state.transactionSyncError, level:'warning', href:'index.html?view=wallets' });
  if (state.exchangeError) attention.push({ label:'Exchange update failed', detail:state.exchangeError, level:'critical', href:'exchanges.html' });
  overview.warnings.slice(0, 3).forEach(warning => attention.push({ label:'Exchange data partially unavailable', detail:warning, level:'warning', href:'exchanges.html' }));
  if (state.gasAnalyticsError) attention.push({ label:'Gas Analytics unavailable', detail:state.gasAnalyticsError, level:'warning', href:'index.html?view=networks' });
  if (state.gasAnalytics?.current?.spike) attention.push({ label:'Ethereum gas spike detected', detail:`Standard fee is ${gasNumber(state.gasAnalytics.current.standard)} Gwei.`, level:'warning', href:'index.html?view=networks' });
  if (validAddress(state.balanceSettings.gasAddress) && (state.gasBalance.raw || state.gasBalance.raw === '0')) {
    const gasBalance = Number(formatTokenAmount(state.gasBalance.raw, 18).replace(/,/g, ''));
    if (gasBalance < Number(state.balanceSettings.gasThreshold)) attention.push({ label:'Gas Station balance is low', detail:`${compactNumber(gasBalance, 6)} ETH available; ${compactNumber(state.balanceSettings.gasThreshold, 6)} ETH required.`, level:'critical', href:'index.html?view=wallets' });
  }
  if (validSolanaAddress(state.balanceSettings.solanaGasAddress) && (state.solanaGasBalance.raw || state.solanaGasBalance.raw === '0')) {
    const solBalance = Number(formatTokenAmount(state.solanaGasBalance.raw, 9).replace(/,/g, ''));
    if (solBalance < Number(state.balanceSettings.solanaGasThreshold)) attention.push({ label:'Solana Gas Station balance is low', detail:`${compactNumber(solBalance, 6)} SOL available; ${compactNumber(state.balanceSettings.solanaGasThreshold, 6)} SOL required.`, level:'critical', href:'index.html?view=wallets' });
  }
  if (problems.length) attention.push({ label:`${problems.length} transaction issue${problems.length === 1 ? '' : 's'} in history`, detail:'Dropped, replaced or failed transactions require review.', level:'warning', href:'index.html?view=wallets' });

  el.overviewAttentionMetric.textContent = String(attention.length);
  el.overviewAttentionMetric.className = attention.some(item => item.level === 'critical') ? 'negative' : attention.length ? 'warning' : 'positive';
  el.overviewAttentionContext.textContent = attention.length ? `${attention.filter(item => item.level === 'critical').length} critical · ${attention.filter(item => item.level === 'warning').length} warning` : 'Nothing needs review';
  el.overviewAttentionCount.textContent = String(attention.length);
  el.overviewAttentionCount.classList.toggle('clear', attention.length === 0);
  el.overviewAttentionList.innerHTML = attention.length
    ? attention.slice(0, 5).map(item => overviewStatusMarkup(item.label, item.detail, item.level, item.href)).join('')
    : overviewStatusMarkup('No action required', 'Connected systems report no active operational issues.', 'ok');

  const websocketLive = Boolean(state.serverMonitorStatus?.connected && state.serverMonitorStatus?.subscriptions >= 2);
  const websocketHealthy = !state.addresses.length || websocketLive;
  const railwayHealthy = backendConfigured() && !state.exchangeError && !state.gasAnalyticsError && !state.transactionSyncError;
  const allHealthy = websocketHealthy && railwayHealthy && !overview.warnings.length;
  el.overviewSystemBadge.classList.toggle('live', allHealthy);
  el.overviewSystemBadge.classList.toggle('error', !railwayHealthy);
  el.overviewSystemBadge.classList.toggle('warning', railwayHealthy && !allHealthy);
  el.overviewSystemLabel.textContent = allHealthy ? 'All systems operational' : railwayHealthy ? 'Partial data available' : 'Systems need attention';
  el.overviewUpdatedAt.textContent = overview.updatedAt ? `Exchange data updated ${age(overview.updatedAt)} ago` : state.exchangeLoading ? 'Updating exchange accounts' : 'Waiting for exchange data';

  const accountRows = [...accounts].sort((left, right) => `${left.exchangeName} ${left.name}`.localeCompare(`${right.exchangeName} ${right.name}`));
  el.overviewAccountsMeta.textContent = accounts.length ? `${overview.exchangeCount} connected exchange${overview.exchangeCount === 1 ? '' : 's'} · ${accounts.length} account${accounts.length === 1 ? '' : 's'}` : 'Connect an exchange to begin';
  el.overviewAccountGrid.innerHTML = accountRows.length ? accountRows.map(account => {
    const equity = window.TreasuryOverview.accountValue(account, 'equityUsd');
    const accountPnl = window.TreasuryOverview.accountValue(account, 'unrealisedPnl');
    const accountPositions = Array.isArray(account.positions) ? account.positions.length : 0;
    const status = overview.statusByExchange.get(account.exchangeId) || 'connected';
    const statusLabel = status === 'partial' ? 'Partial' : status === 'error' ? 'Unavailable' : 'Connected';
    return `<tr><td><a class="overview-account-name" href="exchanges.html"><span class="overview-account-mark">${escapeHtml(String(account.exchangeName || '?').slice(0, 1))}</span><span><strong>${escapeHtml(account.name || account.exchangeName || 'Exchange account')}</strong><small>${escapeHtml(account.exchangeName || account.exchangeId || '')} · ${escapeHtml(String(account.type || 'account').replaceAll('-', ' '))} · ${escapeHtml(statusLabel)}</small></span></a></td><td><span class="overview-account-status ${escapeHtml(status)}"><i></i>${escapeHtml(statusLabel)}</span></td><td>${exchangeMoney(equity)}</td><td class="${accountPnl > 0 ? 'positive' : accountPnl < 0 ? 'negative' : 'neutral'}">${accountPnl !== null ? exchangeSignedMoney(accountPnl) : '—'}</td><td>${accountPositions}</td></tr>`;
  }).join('') : '<tr><td colspan="5"><div class="overview-empty">No exchange accounts connected. Add a read-only API key to begin.</div></td></tr>';
  el.overviewAccountsFoot.textContent = accounts.length ? `${overview.equity.count} of ${accounts.length} accounts currently provide a known USD equity value.` : '';

  const exposure = new Map();
  positions.forEach(position => {
    const asset = String(position.baseAsset || position.symbol || 'Unknown').toUpperCase();
    const row = exposure.get(asset) || {asset, long:0, short:0, pnl:0, count:0};
    const notional = Math.abs(Number(position.notional) || 0);
    if (position.side === 'short') row.short += notional; else row.long += notional;
    row.pnl += Number(position.unrealisedPnlUsd ?? position.unrealisedPnl) || 0;
    row.count += 1;
    exposure.set(asset, row);
  });
  const exposureRows = [...exposure.values()].sort((a, b) => (b.long + b.short) - (a.long + a.short)).slice(0, 5);
  el.overviewExposureBody.innerHTML = exposureRows.length ? `<div class="overview-table-wrap"><table class="overview-table"><thead><tr><th>Asset</th><th>Gross</th><th>Net</th><th>Unrealized PnL</th></tr></thead><tbody>${exposureRows.map(row => {
    const net = row.long - row.short;
    return `<tr><td><strong>${escapeHtml(row.asset)}</strong><small>${row.count} position${row.count === 1 ? '' : 's'}</small></td><td>${exchangeMoney(row.long + row.short)}</td><td class="${net > 0 ? 'positive' : net < 0 ? 'negative' : 'neutral'}">${exchangeSignedMoney(net)}</td><td class="${row.pnl > 0 ? 'positive' : row.pnl < 0 ? 'negative' : 'neutral'}">${exchangeSignedMoney(row.pnl)}</td></tr>`;
  }).join('')}</tbody></table></div>` : '<div class="overview-empty">No open exchange positions.</div>';

  const allocationTotal = overview.allocation.reduce((sum, venue) => sum + Math.max(0, venue.value), 0);
  el.overviewAllocationBody.innerHTML = allocationTotal > 0
    ? `<div class="overview-allocation-bar" aria-label="Exchange allocation">${overview.allocation.map((venue, index) => `<span class="venue-${index % 5}" style="width:${Math.max(0, venue.value) / allocationTotal * 100}%" title="${escapeHtml(venue.name)}"></span>`).join('')}</div><div class="overview-allocation-list">${overview.allocation.map((venue, index) => `<div><span><i class="venue-${index % 5}"></i>${escapeHtml(venue.name)}</span><strong>${exchangeMoney(venue.value)}<small>${Math.round(Math.max(0, venue.value) / allocationTotal * 100)}%</small></strong></div>`).join('')}</div><p class="overview-allocation-note">Accounts without a verified USD value are listed above but excluded from allocation.</p>`
    : '<div class="overview-empty">USD allocation becomes available when connected accounts provide equity values.</div>';
}

let lastTransactionTableMarkup = null;

function refreshTransactionAges() {
  el.txBody.querySelectorAll('[data-transaction-age]').forEach(cell => {
    const timestamp = Number(cell.dataset.transactionAge);
    const nextAge = Number.isFinite(timestamp) ? age(timestamp) : '—';
    if (cell.textContent !== nextAge) cell.textContent = nextAge;
  });
}

function render() {
  const diagnostic = document.querySelector('#syncDiagnostics');
  if (diagnostic) {
    const monitor = state.serverMonitorStatus;
    diagnostic.textContent = !backendConfigured() ? 'Sign in to open your workspace.'
      : state.transactionSyncError ? `Synchronization failed: ${state.transactionSyncError}. Existing records are retained.`
      : `Last successful sync: ${state.transactionSyncUpdatedAt ? age(state.transactionSyncUpdatedAt) + ' ago' : 'waiting'} · Live subscriptions: ${monitor?.subscriptions ?? 'unknown'}/2 · Queue slots: ${monitor?.queueCount ?? state.pendingQueue.length} · Last scanned block: ${monitor?.lastConfirmedBlock ?? 'waiting'}${monitor?.error || monitor?.queueError ? ' · Server monitoring needs attention' : ''}`;
  }
  const rows = transactionRows();
  const pending = rows.filter(tx => tx.status === 'pending').length;
  const confirmed = state.transactions.filter(tx => ['confirmed','failed'].includes(tx.status)).length;
  const problems = state.transactions.filter(tx => ['dropped','replaced'].includes(tx.status)).length;
  el.pendingCount.textContent = pending;
  el.confirmedCount.textContent = confirmed;
  el.problemCount.textContent = problems;
  const lastEvent = [...rows].sort((a,b) => b.firstSeen-a.firstSeen)[0];
  el.lastEvent.textContent = lastEvent ? dateTime(lastEvent.firstSeen) : '—';
  el.addressList.innerHTML = state.addresses.map(address => `<a class="address-chip" href="https://etherscan.io/address/${address}" target="_blank" rel="noreferrer" title="${address}">${escapeHtml(walletLabel(address))}</a>`).join('');

  const filter = el.filter.value;
  const query = state.searchQuery.trim().toLowerCase();
  const filtered = rows.filter(tx => {
    if (filter === 'all') return true;
    if (filter === 'problem') return ['dropped','replaced'].includes(tx.status);
    if (filter === 'boost') return needsBoost(tx) || (tx.queueSlot && queueInfo(tx)?.role === 'blocker');
    return tx.status === filter;
  }).filter(tx => !query || searchableTransactionText(tx).includes(query));
  const visible = sortTransactions(filtered);
  const totalPages = Math.max(1, Math.ceil(visible.length / state.pageSize));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * state.pageSize;
  const pageTransactions = visible.slice(start, start + state.pageSize);
  const transactionScroll = el.txBody.closest('.table-wrap');
  const savedScrollTop = transactionScroll?.scrollTop || 0;
  const savedScrollLeft = transactionScroll?.scrollLeft || 0;
  const transactionTableMarkup = pageTransactions.map(tx => {
    const outgoing = state.addresses.includes(tx.from);
    const matched = tx.matchedAddress || state.addresses.find(address => [tx.from, tx.to, tx.tokenRecipient].includes(address)) || '';
    const boost = needsBoost(tx);
    const queue = queueInfo(tx);
    const gasLabel = tx.queueSlot
      ? '<span class="gas-check boost"><strong>Inspect in signer</strong><small>Fee and hash unavailable</small></span>'
      : tx.status !== 'pending'
      ? '<span class="gas-check"><strong>—</strong></span>'
      : `<span class="gas-check ${boost ? 'boost' : ''}"><strong>${boost ? 'Boost recommended' : 'OK'}</strong><small>Network ${state.currentGasPrice ? `${compactNumber(state.currentGasPrice, 2)} Gwei` : '—'}</small></span>`;
    const queueLabel = queue?.role === 'blocker'
      ? `<span class="queue-state"><strong>Blocking ${queue.count} transaction${queue.count === 1 ? '' : 's'}</strong><small>Nonce ${queue.blockerNonce}${boost ? ' · Low fee' : ' · Cause unknown'}</small></span>`
      : queue?.role === 'blocked'
        ? `<span class="queue-state blocked"><strong>Blocked</strong><small>By nonce ${queue.blockerNonce}</small></span>`
        : '—';
    const hashCell = tx.queueSlot
      ? `<div class="hash-cell queue-hash"><a class="hash" href="https://etherscan.io/txsPending?a=${tx.from}&m=hf" target="_blank" rel="noreferrer">Hash unavailable</a><small>Open pending queue</small></div>`
      : `<div class="hash-cell"><a class="hash" href="https://etherscan.io/tx/${tx.hash}" target="_blank" rel="noreferrer">${shortHash(tx.hash)}</a><button class="copy-button" type="button" data-copy-hash="${tx.hash}" aria-label="Copy full transaction hash">${state.copiedHash === tx.hash ? 'Copied' : 'Copy'}</button></div>`;
    const rowAction = tx.queueSlot ? 'data-queue-slot="true"' : `data-tx-hash="${tx.hash}" tabindex="0" aria-label="Open details for transaction ${tx.hash}"`;
    return `<tr class="transaction-row${tx.queueSlot ? ' queue-placeholder' : ''}" ${rowAction}>
      <td><span class="status ${escapeHtml(tx.status)}">${escapeHtml(statusLabel(tx.status))}</span></td>
      <td data-transaction-age="${Number(tx.firstSeen) || 0}"></td>
      <td>${hashCell}</td>
      <td title="${escapeHtml(matched)}">${matched ? escapeHtml(walletLabel(matched)) : '—'}</td>
      <td>${outgoing ? 'Outgoing' : 'Incoming'}</td>
      <td title="${escapeHtml(tx.queueSlot ? 'Transaction details have not been exposed by the RPC' : tx.tokenName || 'Ether')}">${tx.queueSlot ? '<span class="muted">Awaiting details</span>' : escapeHtml(transactionAmount(tx))}</td>
      <td>${tx.nonce}</td>
      <td>${queueLabel}</td>
      <td>${tx.queueSlot ? 'Unknown' : `${compactNumber(tx.maxFee, 2)} Gwei`}</td>
      <td>${gasLabel}</td>
    </tr>`;
  }).join('');
  if (transactionTableMarkup !== lastTransactionTableMarkup) {
    el.txBody.innerHTML = transactionTableMarkup;
    lastTransactionTableMarkup = transactionTableMarkup;
    if (transactionScroll) {
      transactionScroll.scrollTop = savedScrollTop;
      transactionScroll.scrollLeft = savedScrollLeft;
    }
  }
  refreshTransactionAges();
  el.emptyState.classList.toggle('hidden', filtered.length > 0);
  el.emptyMessage.textContent = query ? 'No transactions match your search.' : backendConfigured() ? 'No saved transactions yet. Server synchronization runs every 15 seconds.' : 'Open Connection settings to connect Railway.';
  el.paginationInfo.textContent = visible.length ? `${start + 1}–${Math.min(start + state.pageSize, visible.length)} of ${visible.length}` : '0 transactions';
  el.pageIndicator.textContent = `Page ${state.page} of ${totalPages}`;
  el.previousPage.disabled = state.page <= 1;
  el.nextPage.disabled = state.page >= totalPages;
  el.pageSize.value = String(state.pageSize);
  updateSortHeaders();
  renderBalances();
  renderExchangeAccount();
  renderPendingSync();
  renderOverview();
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
      ${detailRow('Discovered by', tx.discoveredBy || 'live')}
      ${detailRow('First seen', new Date(tx.firstSeen).toLocaleString('en-GB'))}
    </dl>
    <div class="transaction-detail-actions">
      <button class="primary" type="button" data-copy-hash="${tx.hash}">${state.copiedHash === tx.hash ? 'Copied' : 'Copy hash'}</button>
    </div>`;
  el.transactionDialog.showModal();
}

function renderBalances() {
  const settings = state.balanceSettings;
  const balancesLoading = state.balanceLoading || state.solanaBalanceLoading || state.bitcoinBalanceLoading;
  el.refreshBalancesButton.disabled = balancesLoading || !settings.enabled;
  el.refreshBalancesButton.textContent = balancesLoading ? 'Refreshing…' : 'Refresh now';

  if (!settings.enabled) {
    el.walletBalanceMeta.textContent = 'Balance display is disabled';
    el.walletBalancesBody.innerHTML = '<div class="balance-empty">Enable wallet balances in Settings.</div>';
  } else {
    const latest = Math.max(0, ...Object.values(state.walletBalances).map(item => item?.updatedAt || 0), ...Object.values(state.solanaWalletBalances).map(item => item?.updatedAt || 0), ...Object.values(state.bitcoinWalletBalances).map(item => item?.updatedAt || 0));
    el.walletBalanceMeta.textContent = state.balanceLoadError || `${latest ? `Updated ${age(latest)} ago` : 'Not updated yet'} · ${intervalLabel(settings.balanceInterval)}`;
    const ethereumRows = state.addresses.map(address => {
      const balance = state.walletBalances[address];
      const symbols = ['ETH', ...BALANCE_TOKENS.map(token => token.symbol)];
      const tokens = symbols.map(symbol => {
        const value = balance?.tokens?.[symbol];
        const formatted = value?.raw !== null && value?.raw !== undefined ? formatTokenAmount(value.raw, value.decimals) : '—';
        return `<div class="token-balance" title="${escapeHtml(symbol)}"><span>${escapeHtml(symbol)}</span><strong>${escapeHtml(formatted)}</strong></div>`;
      }).join('');
      return `<div class="wallet-balance-row"><div class="wallet-balance-title"><strong>${escapeHtml(walletLabel(address))}</strong><span>${shortAddress(address)}</span></div><div class="token-balances">${tokens}</div></div>`;
    }).join('');
    const solanaRows = state.solanaAddresses.map(address => {
      const balance = state.solanaWalletBalances[address];
      const assets = Array.isArray(balance?.assets) ? balance.assets : [];
      const bySymbol = new Map(assets.map(asset => [String(asset.symbol || '').toUpperCase(), asset]));
      const tokens = [
        {symbol:'SOL', label:'SOL'},
        {symbol:'USDT', label:'USDT · SOL'},
        {symbol:'USDC', label:'USDC · SOL'},
      ].map(item => {
        const asset = bySymbol.get(item.symbol);
        const formatted = asset ? compactNumber(Number(asset.balance), 8) : balance ? '0' : '—';
        return `<div class="token-balance" title="${escapeHtml(asset?.name || `${item.symbol} on Solana`)}"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(formatted)}</strong></div>`;
      }).join('');
      return `<div class="wallet-balance-row"><div class="wallet-balance-title"><strong>${escapeHtml(state.solanaLabels[address] || shortAddress(address))}</strong><span>${escapeHtml(shortAddress(address))}</span></div><div class="token-balances">${tokens}</div></div>`;
    }).join('');
    const bitcoinRows = state.bitcoinAddresses.map(address => {
      const wallet = state.bitcoinWalletBalances[address];
      const health = wallet?.balance;
      const healthLabel = health?.level === 'attention' ? 'Consolidate' : health?.level === 'watch' ? 'Monitor' : health ? 'Healthy' : 'Waiting';
      const fee = health?.estimatedConsolidation?.feeSats;
      const tokens = `<div class="token-balance"><span>BTC</span><strong>${health ? escapeHtml(health.totalBtc) : '—'}</strong></div><div class="token-balance"><span>UTXOs</span><strong>${health ? Number(health.count).toLocaleString() : '—'}</strong></div><div class="token-balance"><span>Dust</span><strong>${health ? Number(health.dust).toLocaleString() : '—'}</strong></div><div class="token-balance"><span>Health</span><strong class="utxo-state ${escapeHtml(health?.level || '')}">${healthLabel}</strong></div><div class="token-balance"><span>Consolidation</span><strong>${Number.isFinite(fee) ? `${fee.toLocaleString()} sats` : '—'}</strong></div>`;
      return `<div class="wallet-balance-row"><div class="wallet-balance-title"><strong>${escapeHtml(state.bitcoinLabels[address] || shortAddress(address))}</strong><span>${escapeHtml(shortAddress(address))}</span></div><div class="token-balances bitcoin-balances">${tokens}</div></div>`;
    }).join('');
    const groups = [];
    if (state.addresses.length) groups.push(`<div class="wallet-network-label"><span class="network-mark ethereum">E</span><strong>Ethereum</strong><small>${state.addresses.length} wallet${state.addresses.length === 1 ? '' : 's'}</small></div>${ethereumRows}`);
    if (state.solanaAddresses.length) groups.push(`<div class="wallet-network-label"><span class="network-mark solana">S</span><strong>Solana</strong><small>${state.solanaAddresses.length} wallet${state.solanaAddresses.length === 1 ? '' : 's'}</small></div>${solanaRows}`);
    if (state.bitcoinAddresses.length) groups.push(`<div class="wallet-network-label"><span class="network-mark bitcoin">₿</span><strong>Bitcoin</strong><small>${state.bitcoinAddresses.length} wallet${state.bitcoinAddresses.length === 1 ? '' : 's'} · UTXO Health</small></div>${bitcoinRows}`);
    el.walletBalancesBody.innerHTML = groups.join('') || '<div class="balance-empty">Add an Ethereum, Solana or Bitcoin wallet in Settings.</div>';
  }

  const ethereumConfigured = validAddress(settings.gasAddress);
  const solanaConfigured = validSolanaAddress(settings.solanaGasAddress);
  if (!ethereumConfigured && !solanaConfigured) {
    el.gasBalanceMeta.textContent = 'Not configured';
    el.gasBalanceBody.innerHTML = '<div class="balance-empty">Add an Ethereum or Solana Gas Station address in Settings.</div>';
    return;
  }
  const card = ({network,name,address,threshold,balance,decimals,symbol,loading,refresh}) => {
    if (!address) return '';
    if (!balance.raw && balance.raw !== '0') return `<section class="gas-station-card ${network}"><div class="gas-network">${network === 'solana' ? 'Solana' : 'Ethereum'}</div><div class="gas-name">${escapeHtml(name)}</div><div class="gas-address">${escapeHtml(shortAddress(address))}</div><div class="balance-empty">${loading ? `Refreshing ${symbol} balance…` : 'No balance data yet.'}</div><button class="secondary gas-refresh" type="button" ${refresh} ${loading ? 'disabled' : ''}>${loading ? 'Refreshing…' : 'Refresh now'}</button></section>`;
    const formatted = formatTokenAmount(balance.raw, decimals);
    const current = Number(formatted.replace(/,/g, ''));
    const low = current < Number(threshold);
    const changeRaw = balance.changeRaw;
    const changeClass = changeRaw === null || changeRaw === undefined || BigInt(changeRaw) === 0n ? 'neutral' : BigInt(changeRaw) > 0n ? 'positive' : 'negative';
    const changeText = changeRaw === null || changeRaw === undefined ? 'Change appears after the next refresh' : BigInt(changeRaw) === 0n ? 'No change since last refresh' : `${symbol} ${formatSignedTokenAmount(changeRaw, decimals)} since last refresh`;
    return `<section class="gas-station-card ${network}"><div class="gas-network">${network === 'solana' ? 'Solana' : 'Ethereum'}</div><div class="gas-name">${escapeHtml(name)}</div><div class="gas-address">${escapeHtml(shortAddress(address))}</div><div class="gas-amount">${escapeHtml(formatted)} ${symbol}</div><div class="gas-change ${changeClass}">${escapeHtml(changeText)}</div><div class="gas-minimum">Minimum required: ${compactNumber(threshold, 6)} ${symbol}</div><div class="gas-status ${low ? 'low' : ''}">${low ? 'Low balance · Refill required' : 'Balance is sufficient'}</div><button class="secondary gas-refresh" type="button" ${refresh} ${loading ? 'disabled' : ''}>${loading ? 'Refreshing…' : 'Refresh now'}</button></section>`;
  };
  const latestGas = Math.max(Number(state.gasBalance.updatedAt) || 0, Number(state.solanaGasBalance.updatedAt) || 0);
  el.gasBalanceMeta.textContent = state.gasLoadError || (latestGas ? `Updated ${age(latestGas)} ago` : 'Not updated yet');
  el.gasBalanceBody.innerHTML = `<div class="gas-stations-grid">${card({network:'ethereum',name:settings.gasName || 'Ethereum Gas Station',address:ethereumConfigured ? settings.gasAddress : '',threshold:settings.gasThreshold,balance:state.gasBalance,decimals:18,symbol:'ETH',loading:state.gasLoading,refresh:'data-refresh-gas'})}${card({network:'solana',name:settings.solanaGasName || 'Solana Gas Station',address:solanaConfigured ? settings.solanaGasAddress : '',threshold:settings.solanaGasThreshold,balance:state.solanaGasBalance,decimals:9,symbol:'SOL',loading:state.solanaGasLoading,refresh:'data-refresh-solana-gas'})}</div>`;
}

function exchangeNumber(value, maximumFractionDigits = 8) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(Number(value));
}

function exchangeMoney(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value));
}

function exchangeSignedMoney(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  return `${number > 0 ? '+' : ''}${exchangeMoney(number)}`;
}

function renderExchangeAccount() {
  el.refreshExchangeButton.disabled = state.exchangeLoading || !backendConfigured();
  el.refreshExchangeButton.textContent = state.exchangeLoading ? 'Refreshing…' : 'Refresh';

  if (!backendConfigured()) {
    el.exchangeAccountStatus.textContent = 'Connect Railway to load exchange accounts';
    el.exchangeAccountBody.innerHTML = '<div class="exchange-empty">Bitget data is requested securely through Railway.</div>';
    return;
  }
  if (state.exchangeError && !state.exchangeData) {
    el.exchangeAccountStatus.textContent = state.exchangeError;
    el.exchangeAccountBody.innerHTML = '<div class="exchange-empty">Add the three read-only Bitget API values in Railway, then redeploy and refresh.</div>';
    return;
  }
  if (!state.exchangeData) {
    el.exchangeAccountStatus.textContent = state.exchangeLoading ? 'Loading Bitget Unified Account…' : 'Waiting for Bitget data';
    el.exchangeAccountBody.innerHTML = '<div class="exchange-empty">Waiting for Bitget Unified Account data…</div>';
    return;
  }

  const data = state.exchangeData;
  const summary = data.summary || {};
  const positions = Array.isArray(data.positions) ? data.positions : [];
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const pnlClass = Number(summary.unrealisedPnl) > 0 ? 'positive' : Number(summary.unrealisedPnl) < 0 ? 'negative' : 'neutral';
  el.exchangeAccountStatus.textContent = state.exchangeError
    || `Bitget · ${data.accountType || 'Unified Account'} · updated ${age(data.updatedAt)} ago · every 30 seconds`;

  const warnings = Array.isArray(data.warnings) && data.warnings.length
    ? '<div class="exchange-warning">Some Bitget sections are unavailable. Check read permissions and try again.</div>' : '';
  el.exchangeAccountBody.innerHTML = `
    <div class="exchange-summary exchange-summary-compact">
      <article><span>Account equity</span><strong>${exchangeMoney(summary.accountEquity)}</strong><small>Unified total</small></article>
      <article><span>USDT equity</span><strong>${exchangeNumber(summary.usdtEquity, 2)}</strong><small>USDT equivalent</small></article>
      <article><span>Unrealized PnL</span><strong class="exchange-pnl ${pnlClass}">${exchangeSignedMoney(summary.unrealisedPnl)}</strong><small>Open positions</small></article>
      <article><span>Open positions</span><strong>${positions.length}</strong><small>${summary.positionValue === null ? 'No position value' : `${exchangeMoney(summary.positionValue)} value`}</small></article>
    </div>
    ${warnings}
    <div class="exchange-overview-foot"><span>${assets.length} non-zero assets across Unified and Funding</span><a href="exchanges.html">View assets and positions →</a></div>`;
}

async function updateExchangeAccount({ force = false } = {}) {
  if (state.exchangeLoading) return;
  if (!backendConfigured()) { renderExchangeAccount(); return; }
  state.exchangeLoading = true;
  state.exchangeError = '';
  renderExchangeAccount();
  try {
    const url = `${normalizedBackendUrl()}/api/exchanges/accounts${force ? '?refresh=1' : ''}`;
    const response = await fetch(url, { headers: backendHeaders(), cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Exchange service returned ${response.status}`);
    state.exchangeData = body;
  } catch (error) {
    state.exchangeError = error?.message || 'Exchange account update failed';
  } finally {
    state.exchangeLoading = false;
    renderExchangeAccount();
  }
}

function scheduleExchangeRefresh(force = false) {
  clearInterval(state.exchangeTimer);
  if (backendConfigured()) {
    state.exchangeTimer = setInterval(updateExchangeAccount, EXCHANGE_REFRESH_MS);
    if (force || !state.exchangeData || Date.now() - Number(state.exchangeData.updatedAt || 0) >= EXCHANGE_REFRESH_MS) updateExchangeAccount();
  }
  renderExchangeAccount();
}

function statusLabel(status) {
  return ({pending:'Pending', confirmed:'Confirmed', failed:'Failed', dropped:'Dropped', replaced:'Replaced'})[status] || status;
}

function openSettings() {
  el.endpoint.value = state.endpoint;
  el.backendUrl.value = state.backendUrl;
  el.backendToken.value = state.backendToken;
  updateBackendStatus();
  el.addresses.value = state.addresses.map(address => state.addressLabels[address] ? `${state.addressLabels[address]} | ${address}` : address).join('\n');
  el.solanaAddresses.value = state.solanaAddresses.map(address => state.solanaLabels[address] ? `${state.solanaLabels[address]} | ${address}` : address).join('\n');
  el.bitcoinAddresses.value = state.bitcoinAddresses.map(address => state.bitcoinLabels[address] ? `${state.bitcoinLabels[address]} | ${address}` : address).join('\n');
  el.error.textContent = '';
  el.dialog.showModal();
}

function normalizedBackendUrl(value = state.backendUrl) {
  return String(value || '').trim().replace(/\/$/, '');
}

function backendConfigured() { return Boolean(window.Treasury?.user); }

function updateBackendStatus(message, isError = false) {
  if (!el.backendStatus) return;
  el.backendStatus.textContent = message || (backendConfigured()
    ? 'Signed in. Wallet settings are saved to your account.'
    : 'Sign in to configure your wallets.');
  el.backendStatus.classList.toggle('error', isError);
}

function backendHeaders() { return {'Content-Type':'application/json'}; }

function serverSettingsPayload() {
  return {
    addresses: state.addresses,
    labels: state.addressLabels,
    solanaAddresses: state.solanaAddresses,
    solanaLabels: state.solanaLabels,
    bitcoinAddresses: state.bitcoinAddresses,
    bitcoinLabels: state.bitcoinLabels,
    bitcoinSettings:state.bitcoinSettings,
    email: state.email,
    telegramChatId: state.telegramChatId,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    notificationSettings: state.notificationSettings,
    balanceSettings: state.balanceSettings,
  };
}

async function syncBackendSettings({ report = false } = {}) {
  if (!backendConfigured()) return false;
  try {
    const response = await fetch(`${normalizedBackendUrl()}/api/settings`, {
      method: 'PUT', headers: backendHeaders(), body: JSON.stringify(serverSettingsPayload()),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Server returned ${response.status}`);
    if (report) updateBackendStatus('Connected. Settings synchronized with the 24/7 Railway monitor.');
    return true;
  } catch (error) {
    if (report) updateBackendStatus(error.message || 'Could not connect to the Railway server.', true);
    return false;
  }
}

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
}

async function subscribeServerPush() {
  if (!backendConfigured() || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const configResponse = await fetch(`${normalizedBackendUrl()}/api/public-config`);
  const publicConfig = await configResponse.json();
  if (!publicConfig.pushEnabled || !publicConfig.vapidPublicKey) return false;
  const registration = await navigator.serviceWorker.register('./sw.js');
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicConfig.vapidPublicKey),
  });
  const response = await fetch(`${normalizedBackendUrl()}/api/push/subscribe`, {
    method: 'POST', headers: backendHeaders(), body: JSON.stringify(subscription),
  });
  if (!response.ok) throw new Error('Could not register server push notifications');
  Treasury.storage.setItem(PUSH_REGISTERED_KEY, 'true');
  return true;
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
  const solanaGasLow = notificationRule('solanaGasLow');
  const bitcoinConsolidation=notificationRule('bitcoinConsolidation');
  el.pendingAlerts.checked = Boolean(pending.enabled);
  el.pendingBrowser.checked = Boolean(pending.browser);
  el.pendingEmail.checked = Boolean(pending.email);
  el.pendingTelegram.checked = Boolean(pending.telegram);
  el.pendingMinutes.value = pending.afterMinutes;
  el.pendingRepeat.value = String(pending.repeatMinutes);
  el.blockerAlerts.checked = Boolean(blocker.enabled);
  el.blockerBrowser.checked = Boolean(blocker.browser);
  el.blockerEmail.checked = Boolean(blocker.email);
  el.blockerTelegram.checked = Boolean(blocker.telegram);
  el.blockerIgnoreQuiet.checked = Boolean(blocker.ignoreQuiet);
  el.blockerMinutes.value = blocker.afterMinutes;
  el.blockerRepeat.value = String(blocker.repeatMinutes);
  el.droppedAlerts.checked = Boolean(dropped.enabled);
  el.droppedBrowser.checked = Boolean(dropped.browser);
  el.droppedEmail.checked = Boolean(dropped.email);
  el.droppedTelegram.checked = Boolean(dropped.telegram);
  el.droppedMinutes.value = dropped.afterMinutes;
  el.replacedAlerts.checked = Boolean(replaced.enabled);
  el.replacedBrowser.checked = Boolean(replaced.browser);
  el.replacedEmail.checked = Boolean(replaced.email);
  el.replacedTelegram.checked = Boolean(replaced.telegram);
  el.gasAlerts.checked = Boolean(gasLow.enabled);
  el.gasBrowser.checked = Boolean(gasLow.browser);
  el.gasEmail.checked = Boolean(gasLow.email);
  el.gasTelegram.checked = Boolean(gasLow.telegram);
  el.gasIgnoreQuiet.checked = Boolean(gasLow.ignoreQuiet);
  el.gasRepeat.value = String(gasLow.repeatMinutes);
  el.solanaGasAlerts.checked = Boolean(solanaGasLow.enabled);
  el.solanaGasBrowser.checked = Boolean(solanaGasLow.browser);
  el.solanaGasEmail.checked = Boolean(solanaGasLow.email);
  el.solanaGasTelegram.checked = Boolean(solanaGasLow.telegram);
  el.solanaGasIgnoreQuiet.checked = Boolean(solanaGasLow.ignoreQuiet);
  el.solanaGasRepeat.value = String(solanaGasLow.repeatMinutes);
  el.bitcoinConsolidationAlerts.checked=Boolean(bitcoinConsolidation.enabled);
  el.bitcoinConsolidationBrowser.checked=Boolean(bitcoinConsolidation.browser);
  el.bitcoinConsolidationEmail.checked=Boolean(bitcoinConsolidation.email);
  el.bitcoinConsolidationTelegram.checked=Boolean(bitcoinConsolidation.telegram);
  el.bitcoinConsolidationIgnoreQuiet.checked=Boolean(bitcoinConsolidation.ignoreQuiet);
  el.bitcoinConsolidationRepeat.value=String(bitcoinConsolidation.repeatMinutes);
  el.alertCheckInterval.value = String(settings.checkIntervalSeconds);
  el.quietHours.checked = Boolean(settings.quietHoursEnabled);
  el.quietStart.value = settings.quietStart;
  el.quietEnd.value = settings.quietEnd;
  el.email.value = state.email;
  el.telegramChatId.value = state.telegramChatId;
  el.notificationError.textContent = '';
  showTestStatus('');
  showTelegramTestStatus('');
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
  el.solanaGasName.value = settings.solanaGasName || 'Solana Gas Station';
  el.solanaGasAddress.value = settings.solanaGasAddress || '';
  el.solanaGasThreshold.value = settings.solanaGasThreshold;
  el.solanaGasInterval.value = String(settings.solanaGasInterval);
  el.gasError.textContent = '';
  el.gasDialog.showModal();
}

async function refreshOverviewData() {
  if (!el.refreshOverviewButton || el.refreshOverviewButton.disabled) return;
  el.refreshOverviewButton.disabled = true;
  el.refreshOverviewButton.textContent = 'Refreshing…';
  const tasks = [
    updateExchangeAccount({ force:true }),
    updateGasAnalytics(),
    updateSolanaNetwork(),
    updateBitcoinNetwork(),
  ];
  if (state.balanceSettings.enabled) tasks.push(updateWalletBalances());
  if (state.balanceSettings.enabled && state.solanaAddresses.length) tasks.push(updateSolanaWalletBalances());
  if (state.balanceSettings.enabled && state.bitcoinAddresses.length) tasks.push(updateBitcoinWalletBalances());
  if (validAddress(state.balanceSettings.gasAddress)) tasks.push(updateGasBalance());
  if (validSolanaAddress(state.balanceSettings.solanaGasAddress)) tasks.push(updateSolanaGasBalance());
  if (backendConfigured()) tasks.push(syncPendingState(false));
  if (backendConfigured()) tasks.push(syncServerTransactions({ force:true }));
  await Promise.allSettled(tasks);
  el.refreshOverviewButton.disabled = false;
  el.refreshOverviewButton.textContent = 'Refresh';
  render();
}

el.settingsButton.addEventListener('click', openSettings);
el.overviewSettingsButton?.addEventListener('click', openSettings);
el.notificationSettingsButton.addEventListener('click', openNotificationSettings);
el.refreshOverviewButton.addEventListener('click', refreshOverviewData);
el.newsFilter.addEventListener('change', () => {
  state.newsFilter = el.newsFilter.value;
  renderNews();
});
el.newsFilterSide.addEventListener('change', () => {
  state.newsFilter = el.newsFilterSide.value;
  renderNews();
});
el.refreshNewsButton.addEventListener('click', () => updateNews({ force: true }));
el.refreshNewsSideButton.addEventListener('click', () => updateNews({ force: true }));
el.refreshGasAnalyticsButton.addEventListener('click', updateGasAnalytics);
el.refreshNetworkHealthButton.addEventListener('click', updateGasAnalytics);
el.refreshSolanaNetworkButton?.addEventListener('click', updateSolanaNetwork);
el.refreshBitcoinNetworkButton?.addEventListener('click', () => Promise.allSettled([updateBitcoinNetwork(), updateBitcoinWalletBalances()]));
document.querySelectorAll('[data-network-view]').forEach(button => button.addEventListener('click', () => setActiveNetwork(button.dataset.networkView)));
el.refreshExchangeButton.addEventListener('click', () => updateExchangeAccount({ force: true }));
el.pendingSyncButton.addEventListener('click', () => Promise.allSettled([syncPendingState(true), syncServerTransactions({ force:true })]));
el.pendingSyncNoticeButton.addEventListener('click', () => Promise.allSettled([syncPendingState(true), syncServerTransactions({ force:true })]));
el.testEmailButton.addEventListener('click', sendTestEmail);
el.testTelegramButton.addEventListener('click', sendTestTelegram);
el.notificationButton.addEventListener('click', enableNotifications);
el.form.addEventListener('submit', async event => {
  if (event.submitter?.value !== 'default') return;
  event.preventDefault();
  const endpoint = el.endpoint.value.trim();
  const backendUrl = location.origin;
  const backendToken = '';
  const parsed = parseAddressLines(el.addresses.value);
  const parsedSolana = parseAddressLines(el.solanaAddresses.value, {lowercase:false});
  const parsedBitcoin = parseAddressLines(el.bitcoinAddresses.value, {lowercase:false});
  const addresses = parsed.addresses;
  if (addresses.length > 50 || addresses.some(address => !validAddress(address))) {
    el.error.textContent = 'Enter 1–50 valid Ethereum addresses, one per line.';
    return;
  }
  if (parsedSolana.addresses.length > 50 || parsedSolana.addresses.some(address => !validSolanaAddress(address))) {
    el.error.textContent = 'Enter up to 50 valid Solana addresses, one per line.';
    return;
  }
  if (parsedBitcoin.addresses.length > 25 || parsedBitcoin.addresses.some(address => !validBitcoinAddress(address))) {
    el.error.textContent = 'Enter up to 25 valid Bitcoin mainnet addresses, one per line.';
    return;
  }
  state.endpoint = ''; 
  state.backendUrl = backendUrl;
  state.backendToken = backendToken;
  state.addresses = addresses;
  state.addressLabels = parsed.labels;
  state.solanaAddresses = parsedSolana.addresses;
  state.solanaLabels = parsedSolana.labels;
  state.bitcoinAddresses = parsedBitcoin.addresses;
  state.bitcoinLabels = parsedBitcoin.labels;
  state.pendingDiagnostics = {};
  state.pendingSyncUpdatedAt = 0;
  state.pendingSyncError = '';
  state.pendingSnapshotError = '';
  state.etherscanDiagnostics = {};
  state.etherscanSyncError = '';
  Treasury.storage.removeItem(ENDPOINT_KEY);
  if (backendUrl) Treasury.storage.setItem(BACKEND_URL_KEY, backendUrl); else Treasury.storage.removeItem(BACKEND_URL_KEY);
  if (backendToken) Treasury.storage.setItem(BACKEND_TOKEN_KEY, backendToken); else Treasury.storage.removeItem(BACKEND_TOKEN_KEY);
  Treasury.storage.setItem(ADDRESSES_KEY, JSON.stringify(addresses));
  Treasury.storage.setItem(LABELS_KEY, JSON.stringify(parsed.labels));
  Treasury.storage.setItem(SOLANA_ADDRESSES_KEY, JSON.stringify(parsedSolana.addresses));
  Treasury.storage.setItem(SOLANA_LABELS_KEY, JSON.stringify(parsedSolana.labels));
  Treasury.storage.setItem(BITCOIN_ADDRESSES_KEY, JSON.stringify(parsedBitcoin.addresses));
  Treasury.storage.setItem(BITCOIN_LABELS_KEY, JSON.stringify(parsedBitcoin.labels));
  if (backendConfigured() && !(await syncBackendSettings({ report: true }))) return;
  el.dialog.close();
  reconnect();
  scheduleBalanceRefresh(true);
  updateNews();
  updateGasAnalytics();
  scheduleExchangeRefresh(true);
  scheduleServerTransactionSync();
});

el.notificationForm.addEventListener('submit', async event => {
  if (event.submitter?.value !== 'default') return;
  event.preventDefault();
  const email = el.email.value.trim();
  const telegramChatId = el.telegramChatId.value.trim();
  const pendingMinutes = Number(el.pendingMinutes.value);
  const blockerMinutes = Number(el.blockerMinutes.value);
  const droppedMinutes = Number(el.droppedMinutes.value);
  const emailRequired = [
    el.pendingAlerts.checked && el.pendingEmail.checked,
    el.blockerAlerts.checked && el.blockerEmail.checked,
    el.droppedAlerts.checked && el.droppedEmail.checked,
    el.replacedAlerts.checked && el.replacedEmail.checked,
    el.gasAlerts.checked && el.gasEmail.checked,
    el.solanaGasAlerts.checked && el.solanaGasEmail.checked,
    el.bitcoinConsolidationAlerts.checked&&el.bitcoinConsolidationEmail.checked,
  ].some(Boolean);
  if (emailRequired && !validEmail(email)) {
    el.notificationError.textContent = 'Enter a valid alert email or disable Email for every active rule.';
    return;
  }
  const telegramRequired = [
    el.pendingAlerts.checked && el.pendingTelegram.checked,
    el.blockerAlerts.checked && el.blockerTelegram.checked,
    el.droppedAlerts.checked && el.droppedTelegram.checked,
    el.replacedAlerts.checked && el.replacedTelegram.checked,
    el.gasAlerts.checked && el.gasTelegram.checked,
    el.solanaGasAlerts.checked && el.solanaGasTelegram.checked,
    el.bitcoinConsolidationAlerts.checked&&el.bitcoinConsolidationTelegram.checked,
  ].some(Boolean);
  if (telegramRequired && !/^-?\d{5,20}$/.test(telegramChatId)) {
    el.notificationError.textContent = 'Enter a valid numeric Telegram chat ID or disable Telegram for every active rule.';
    return;
  }
  if (!Number.isFinite(pendingMinutes) || pendingMinutes < 1 || pendingMinutes > 1440) {
    el.notificationError.textContent = 'Pending alert time must be between 1 and 1,440 minutes.';
    return;
  }
  if (!Number.isFinite(blockerMinutes) || blockerMinutes < 1 || blockerMinutes > 1440) {
    el.notificationError.textContent = 'Queue blocker alert time must be between 1 and 1,440 minutes.';
    return;
  }
  if (!Number.isFinite(droppedMinutes) || droppedMinutes < 1 || droppedMinutes > 1440) {
    el.notificationError.textContent = 'Dropped transaction check time must be between 1 and 1,440 minutes.';
    return;
  }
  state.email = email;
  state.telegramChatId = telegramChatId;
  state.notificationSettings = {
    rules: {
      pending: {enabled:el.pendingAlerts.checked, browser:el.pendingBrowser.checked, email:el.pendingEmail.checked, telegram:el.pendingTelegram.checked, afterMinutes:pendingMinutes, repeatMinutes:Number(el.pendingRepeat.value)},
      blocker: {enabled:el.blockerAlerts.checked, browser:el.blockerBrowser.checked, email:el.blockerEmail.checked, telegram:el.blockerTelegram.checked, afterMinutes:blockerMinutes, repeatMinutes:Number(el.blockerRepeat.value), ignoreQuiet:el.blockerIgnoreQuiet.checked},
      dropped: {enabled:el.droppedAlerts.checked, browser:el.droppedBrowser.checked, email:el.droppedEmail.checked, telegram:el.droppedTelegram.checked, afterMinutes:droppedMinutes, repeatMinutes:0},
      replaced: {enabled:el.replacedAlerts.checked, browser:el.replacedBrowser.checked, email:el.replacedEmail.checked, telegram:el.replacedTelegram.checked, afterMinutes:0, repeatMinutes:0},
      gasLow: {enabled:el.gasAlerts.checked, browser:el.gasBrowser.checked, email:el.gasEmail.checked, telegram:el.gasTelegram.checked, afterMinutes:0, repeatMinutes:Number(el.gasRepeat.value), ignoreQuiet:el.gasIgnoreQuiet.checked},
      solanaGasLow: {enabled:el.solanaGasAlerts.checked, browser:el.solanaGasBrowser.checked, email:el.solanaGasEmail.checked, telegram:el.solanaGasTelegram.checked, afterMinutes:0, repeatMinutes:Number(el.solanaGasRepeat.value), ignoreQuiet:el.solanaGasIgnoreQuiet.checked},
      bitcoinConsolidation:{enabled:el.bitcoinConsolidationAlerts.checked,browser:el.bitcoinConsolidationBrowser.checked,email:el.bitcoinConsolidationEmail.checked,telegram:el.bitcoinConsolidationTelegram.checked,afterMinutes:0,repeatMinutes:Number(el.bitcoinConsolidationRepeat.value),ignoreQuiet:el.bitcoinConsolidationIgnoreQuiet.checked},
    },
    checkIntervalSeconds: Number(el.alertCheckInterval.value),
    quietHoursEnabled: el.quietHours.checked,
    quietStart: el.quietStart.value || '22:00',
    quietEnd: el.quietEnd.value || '08:00',
  };
  if (email) Treasury.storage.setItem(EMAIL_KEY, email); else Treasury.storage.removeItem(EMAIL_KEY);
  if (telegramChatId) Treasury.storage.setItem(TELEGRAM_CHAT_KEY, telegramChatId); else Treasury.storage.removeItem(TELEGRAM_CHAT_KEY);
  Treasury.storage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(state.notificationSettings));
  await syncBackendSettings();
  el.notificationDialog.close();
  scheduleNotificationChecks();
});

el.balanceSettingsButton.addEventListener('click', openBalanceSettings);
el.gasSettingsButton.addEventListener('click', openGasSettings);
el.refreshBalancesButton.addEventListener('click', updateWalletBalances);
el.saveBitcoinIntelligence?.addEventListener('click',async()=>{
  const threshold=Number(el.bitcoinFeeThreshold.value),payout=Number(el.bitcoinPayoutAmount.value);
  if(!Number.isFinite(threshold)||threshold<1||threshold>500||!Number.isFinite(payout)||payout<0.00000546||payout>1000)return;
  state.bitcoinSettings={...state.bitcoinSettings,lowFeeThreshold:threshold,expectedPayoutBtc:payout};
  Treasury.storage.setItem(BITCOIN_SETTINGS_KEY,JSON.stringify(state.bitcoinSettings));
  await syncBackendSettings();
  await Promise.allSettled([updateBitcoinNetwork(),updateBitcoinWalletBalances()]);
});
el.gasBalanceBody.addEventListener('click', event => {
  if (event.target.closest('[data-refresh-gas]')) updateGasBalance();
  if (event.target.closest('[data-refresh-solana-gas]')) updateSolanaGasBalance();
});
el.refreshBalancesButton.addEventListener('click', updateSolanaWalletBalances);
el.refreshBalancesButton.addEventListener('click', updateBitcoinWalletBalances);
el.balanceForm.addEventListener('submit', async event => {
  if (event.submitter?.value !== 'default') return;
  event.preventDefault();
  state.balanceSettings = {
    ...state.balanceSettings,
    enabled: el.showBalances.checked,
    balanceInterval: Number(el.balanceInterval.value),
  };
  Treasury.storage.setItem(BALANCE_SETTINGS_KEY, JSON.stringify(state.balanceSettings));
  await syncBackendSettings();
  el.balanceDialog.close();
  scheduleBalanceRefresh(true);
});
el.gasForm.addEventListener('submit', async event => {
  if (event.submitter?.value !== 'default') return;
  event.preventDefault();
  const gasAddress = el.gasAddress.value.trim().toLowerCase();
  const gasThreshold = Number(el.gasThreshold.value);
  const solanaGasAddress = el.solanaGasAddress.value.trim();
  const solanaGasThreshold = Number(el.solanaGasThreshold.value);
  if (gasAddress && !validAddress(gasAddress)) {
    el.gasError.textContent = 'Enter a valid Gas Station Ethereum address or leave it empty.';
    return;
  }
  if (!Number.isFinite(gasThreshold) || gasThreshold < 0) {
    el.gasError.textContent = 'Minimum ETH balance must be zero or greater.';
    return;
  }
  if (solanaGasAddress && !validSolanaAddress(solanaGasAddress)) {
    el.gasError.textContent = 'Enter a valid Solana Gas Station address or leave it empty.';
    return;
  }
  if (!Number.isFinite(solanaGasThreshold) || solanaGasThreshold < 0) {
    el.gasError.textContent = 'Minimum SOL balance must be zero or greater.';
    return;
  }
  const gasChanged = gasAddress !== state.balanceSettings.gasAddress || gasThreshold !== Number(state.balanceSettings.gasThreshold);
  const solanaGasChanged = solanaGasAddress !== state.balanceSettings.solanaGasAddress || solanaGasThreshold !== Number(state.balanceSettings.solanaGasThreshold);
  state.balanceSettings = {
    ...state.balanceSettings,
    gasName: el.gasName.value.trim() || 'Main Gas Station',
    gasAddress,
    gasThreshold,
    gasInterval: Number(el.gasInterval.value),
    solanaGasName: el.solanaGasName.value.trim() || 'Solana Gas Station',
    solanaGasAddress,
    solanaGasThreshold,
    solanaGasInterval: Number(el.solanaGasInterval.value),
  };
  if (gasChanged) {
    state.gasBalance = {};
    Treasury.storage.removeItem(GAS_BALANCE_KEY);
    Treasury.storage.removeItem(GAS_ALERT_KEY);
  }
  if (solanaGasChanged) {
    state.solanaGasBalance = {};
    Treasury.storage.removeItem(SOLANA_GAS_BALANCE_KEY);
    Treasury.storage.removeItem(SOLANA_GAS_ALERT_KEY);
  }
  Treasury.storage.setItem(BALANCE_SETTINGS_KEY, JSON.stringify(state.balanceSettings));
  await syncBackendSettings();
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
  Treasury.storage.setItem(PAGE_SIZE_KEY, String(state.pageSize));
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
el.clearButton.addEventListener('click', async () => {
  if (!state.transactions.length || !confirm('Clear this browser’s cached history? Railway records remain and will resynchronize.')) return;
  state.transactions = [];
  state.summaryAlerts = {};
  Treasury.storage.removeItem(SUMMARY_ALERTS_KEY);
  saveTransactions();
  render();
});

render();
if (['overview', 'wallets'].includes(CURRENT_VIEW)) {
  connect();
  hydrateStoredTokens();
  scheduleBalanceRefresh();
  scheduleNotificationChecks();
  scheduleServerTransactionSync();
}
if (CURRENT_VIEW === 'market') scheduleNewsRefresh(); else renderNews();
if (['overview', 'networks'].includes(CURRENT_VIEW)) scheduleGasAnalyticsRefresh(); else renderGasAnalytics();
if (CURRENT_VIEW === 'networks') {
  setActiveNetwork('ethereum');
  scheduleSolanaNetworkRefresh();
  scheduleBitcoinNetworkRefresh();
} else {
  renderSolanaNetwork();
  renderBitcoinNetwork();
}
if (CURRENT_VIEW === 'overview') scheduleExchangeRefresh(); else renderExchangeAccount();
setInterval(render, 1000);
if (CURRENT_VIEW === 'market') setInterval(renderNews, 60000);
if (['overview', 'wallets'].includes(CURRENT_VIEW)) {
  setInterval(checkStatuses, 12000);
  setInterval(updateGasPrice, 30000);
}

window.treasuryBootComplete = true;
