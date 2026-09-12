const WebSocket = require('ws');
const { config } = require('./config');
const db = require('./db');
const { deliverAlert } = require('./notifier');

const ERC20_TRANSFER = '0xa9059cbb';
const ERC20_TRANSFER_FROM = '0x23b872dd';

class EthereumMonitor {
  constructor() {
    this.ws = null;
    this.settings = null;
    this.running = false;
    this.reconnectTimer = null;
    this.statusTimer = null;
    this.heartbeatTimer = null;
    this.snapshotTimer = null;
    this.blockTimer = null;
    this.gasTimer = null;
    this.blockScanning = false;
    this.lastConfirmedBlock = null;
    this.lastConfirmedBlockAt = 0;
    this.lastPendingAt = 0;
    this.connected = false;
    this.lastError = '';
    this.gasStation = null;
    this.lastGasCheck = 0;
    this.currentGasGwei = 0;
    this.subscriptionIds = new Set();
  }

  getStatus() {
    return {connected: this.connected, subscriptions: this.subscriptionIds.size,
      lastPendingAt: this.lastPendingAt, lastConfirmedBlock: this.lastConfirmedBlock,
      lastConfirmedBlockAt: this.lastConfirmedBlockAt, scanning: this.blockScanning,
      error: this.lastError ? 'Provider monitoring error; inspect server logs' : null};
  }

  async start() {
    this.settings = await db.getSettings();
    this.running = true;
    this.connect();
    this.statusTimer = setInterval(() => this.checkPending().catch(this.logError), 30_000);
    this.snapshotTimer = setInterval(() => this.scanPendingBlock().catch(this.logError), 60_000);
    this.blockTimer = setInterval(() => this.scanConfirmedBlocks().catch(this.logError), 12_000);
    this.gasTimer = setInterval(() => this.checkGasStation().catch(this.logError), 60_000);
    void Promise.allSettled([this.scanPendingBlock(), this.scanConfirmedBlocks(), this.checkPending(), this.checkGasStation()]);
  }

  async reconfigure(settings) {
    this.settings = settings || await db.getSettings();
    this.disconnect();
    this.connect();
    await Promise.allSettled([this.scanPendingBlock(), this.scanConfirmedBlocks(), this.checkPending(), this.checkGasStation(true)]);
  }

  stop() {
    this.running = false;
    this.disconnect();
    clearInterval(this.statusTimer);
    clearInterval(this.snapshotTimer);
    clearInterval(this.blockTimer);
    clearInterval(this.gasTimer);
  }

  disconnect() {
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.subscriptionIds.clear();
  }

  connect() {
    if (!this.running || !config.alchemyWssUrl || !this.settings?.addresses?.length) return;
    this.subscriptionIds.clear();
    this.ws = new WebSocket(config.alchemyWssUrl);
    const socket = this.ws;
    let alive = true;
    socket.on('pong', () => { alive = true; });
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (!alive) { this.lastError = 'WebSocket heartbeat timeout'; socket.terminate(); return; }
      alive = false;
      socket.ping();
    }, 30000);
    this.ws.on('open', () => {
      this.connected = true;
      this.lastError = '';
      const addresses = this.settings.addresses.map(value => value.toLowerCase());
      this.ws.send(JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_subscribe',
        params: ['alchemy_pendingTransactions', { fromAddress: addresses, hashesOnly: false }],
      }));
      this.ws.send(JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'eth_subscribe',
        params: ['alchemy_pendingTransactions', { toAddress: addresses, hashesOnly: false }],
      }));
      console.log(`Monitoring ${addresses.length} Ethereum address(es)`);
    });
    this.ws.on('message', data => this.handleMessage(data).catch(this.logError));
    this.ws.on('error', error => {
      this.lastError = error.message || 'Alchemy WebSocket error';
      console.error('Alchemy WebSocket error:', this.lastError);
    });
    this.ws.on('close', () => {
      clearInterval(this.heartbeatTimer);
      this.subscriptionIds.clear();
      this.ws = null;
      this.connected = false;
      if (this.running) this.reconnectTimer = setTimeout(() => this.connect(), 5_000);
    });
  }

  async handleMessage(data) {
    const message = JSON.parse(data.toString());
    if (message.error) { this.lastError = message.error.message || 'Subscription rejected'; return; }
    if (message.id && message.result) this.subscriptionIds.add(message.result);
    const tx = message.params?.result;
    if (tx?.hash) {
      this.lastPendingAt = Date.now();
      await this.observeTransaction(tx);
    }
  }

  normalizeTransaction(tx) {
    const input = String(tx.input || '0x').toLowerCase();
    const maxFee = tx.maxFeePerGas || tx.gasPrice || '0x0';
    return {
      ...tx,
      hash: tx.hash.toLowerCase(),
      from: String(tx.from || '').toLowerCase(),
      to: tx.to ? tx.to.toLowerCase() : null,
      nonce: Number.isInteger(tx.nonce) ? tx.nonce : Number.parseInt(tx.nonce || '0x0', 16),
      valueWei: BigInt(tx.value || '0x0').toString(),
      maxFeePerGasGwei: Number(BigInt(maxFee)) / 1e9,
      method: input.startsWith(ERC20_TRANSFER) ? 'transfer' : input.startsWith(ERC20_TRANSFER_FROM) ? 'transferFrom' : input.slice(0, 10),
      observedAt: Date.now(),
    };
  }

  isMonitored(tx) {
    const addresses = new Set((this.settings?.addresses || []).map(value => value.toLowerCase()));
    return this.transactionAddresses(tx).some(address => addresses.has(address));
  }

  transactionAddresses(tx) {
    const addresses = [String(tx.from || '').toLowerCase(), String(tx.to || '').toLowerCase()];
    const data = String(tx.input || tx.data || '').replace(/^0x/, '').toLowerCase();
    if (data.startsWith(ERC20_TRANSFER.replace(/^0x/, '')) && data.length >= 136) {
      addresses.push(`0x${data.slice(32, 72)}`);
    } else if (data.startsWith(ERC20_TRANSFER_FROM.replace(/^0x/, '')) && data.length >= 200) {
      addresses.push(`0x${data.slice(32, 72)}`, `0x${data.slice(96, 136)}`);
    }
    return addresses.filter(address => /^0x[a-f0-9]{40}$/.test(address));
  }

  async observeTransaction(raw) {
    if (!this.isMonitored(raw)) return;
    const tx = this.normalizeTransaction(raw);
    const replacements = await db.findSameNonce(tx.from, tx.nonce, tx.hash);
    const row = await db.upsertTransaction(tx);
    for (const old of replacements) {
      await db.markStatus(old.hash, 'replaced', tx.hash);
      await this.notifyReplacement(old, row);
    }
  }

  async rpc(method, params) {
    const response = await fetch(config.alchemyHttpUrl, {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    });
    const body = await response.json();
    if (!response.ok || body.error) throw new Error(body.error?.message || `${method} failed`);
    return body.result;
  }

  async scanPendingBlock() {
    if (!this.settings?.addresses?.length) return;
    const transactions = await this.rpc('eth_getBlockByNumber', ['pending', true]);
    for (const tx of transactions?.transactions || []) {
      if (this.isMonitored(tx)) await this.observeTransaction(tx);
    }
  }

  async scanConfirmedBlocks() {
    if (this.blockScanning || !this.settings?.addresses?.length) return;
    this.blockScanning = true;
    try {
      const current = Number.parseInt(await this.rpc('eth_blockNumber', []), 16);
      if (!Number.isInteger(current)) throw new Error('Invalid latest block number');
      if (!Number.isInteger(this.lastConfirmedBlock)) {
        const checkpoint = await db.getMonitorState('ethereum_confirmed_block');
        const saved = Number(checkpoint?.blockNumber);
        this.lastConfirmedBlock = Number.isInteger(saved) && saved <= current ? saved : Math.max(0, current - 20);
      }
      const target = Math.min(current, this.lastConfirmedBlock + 25);
      for (let blockNumber = this.lastConfirmedBlock + 1; blockNumber <= target; blockNumber += 1) {
        const block = await this.rpc('eth_getBlockByNumber', [`0x${blockNumber.toString(16)}`, true]);
        if (!block || !Array.isArray(block.transactions)) throw new Error('Block unavailable; checkpoint retained');
        const firstSeen = block?.timestamp ? new Date(Number.parseInt(block.timestamp, 16) * 1000).toISOString() : null;
        for (const raw of block?.transactions || []) {
          if (!this.isMonitored(raw)) continue;
          const tx = this.normalizeTransaction(raw);
          const receipt = await this.rpc('eth_getTransactionReceipt', [tx.hash]);
          if (!receipt || !['0x0', '0x1'].includes(receipt.status)) throw new Error('Receipt unavailable; checkpoint retained');
          const status = receipt?.status === '0x0' ? 'failed' : 'confirmed';
          const replacements = await db.findSameNonce(tx.from, tx.nonce, tx.hash);
          await db.upsertConfirmedTransaction(tx, status, firstSeen);
          for (const old of replacements) await db.markStatus(old.hash, 'replaced', tx.hash);
        }
        await db.saveMonitorState('ethereum_confirmed_block', { blockNumber });
        this.lastConfirmedBlock = blockNumber;
        this.lastConfirmedBlockAt = firstSeen ? new Date(firstSeen).getTime() : Date.now();
      }
      this.lastError = '';
    } catch (error) {
      this.lastError = error?.message || 'Confirmed block scan failed';
      throw error;
    } finally {
      this.blockScanning = false;
    }
  }

  async checkPending() {
    const pending = await db.pendingTransactions();
    if (!pending.length) return;
    try {
      const gas = await this.rpc('eth_gasPrice', []);
      this.currentGasGwei = Number(BigInt(gas)) / 1e9;
    } catch (error) {
      console.error('Gas price update failed:', error.message);
    }

    for (const tx of pending) await this.refreshTransactionStatus(tx);
    const live = await db.pendingTransactions();
    await this.evaluatePendingAlerts(live);
  }

  async refreshTransactionStatus(tx) {
    const receipt = await this.rpc('eth_getTransactionReceipt', [tx.hash]);
    if (receipt) {
      await db.markStatus(tx.hash, receipt.status === '0x0' ? 'failed' : 'confirmed');
      return;
    }
    const current = await this.rpc('eth_getTransactionByHash', [tx.hash]);
    if (current) {
      await db.upsertTransaction(this.normalizeTransaction(current));
      return;
    }
    const droppedRule = this.rule('dropped');
    const ageMinutes = (Date.now() - new Date(tx.first_seen).getTime()) / 60_000;
    if (ageMinutes < Number(droppedRule.afterMinutes || 30)) return;
    const misses = await db.incrementMissing(tx.hash);
    if (misses >= 3) {
      await db.markStatus(tx.hash, 'dropped');
      await this.notifyDropped({ ...tx, status: 'dropped' });
    }
  }

  async verifyStillPending(tx) {
    const [receipt, current] = await Promise.all([
      this.rpc('eth_getTransactionReceipt', [tx.hash]),
      this.rpc('eth_getTransactionByHash', [tx.hash]),
    ]);
    return !receipt && current && current.blockNumber == null;
  }

  async evaluatePendingAlerts(rows) {
    const bySender = new Map();
    for (const row of rows) {
      if (!bySender.has(row.from_address)) bySender.set(row.from_address, []);
      bySender.get(row.from_address).push(row);
    }

    for (const [sender, transactions] of bySender) {
      transactions.sort((a, b) => Number(a.nonce) - Number(b.nonce));
      const first = transactions[0];
      const ageMinutes = (Date.now() - new Date(first.first_seen).getTime()) / 60_000;
      const pendingRule = this.rule('pending');
      if (pendingRule.enabled && ageMinutes >= Number(pendingRule.afterMinutes || 15) && await this.verifyStillPending(first)) {
        const needsBoost = Number(first.tx_data?.maxFeePerGasGwei || 0) < this.currentGasGwei;
        const body = needsBoost
          ? `TX ${first.hash} has been pending for ${Math.floor(ageMinutes)} minutes. Its max fee is below the current network gas price; boost is recommended.`
          : `TX ${first.hash} has been pending for ${Math.floor(ageMinutes)} minutes. Check it before taking action.`;
        await deliverAlert({
          kind: 'pending', scopeKey: sender, title: needsBoost ? `Boost required: ${first.hash}` : `Pending transaction: ${first.hash}`,
          body, tx: first, settings: this.settings, rule: pendingRule,
          extra: { currentGasGwei: round(this.currentGasGwei) },
        });
      }

      const blockerRule = this.rule('blocker');
      if (transactions.length > 1 && blockerRule.enabled && ageMinutes >= Number(blockerRule.afterMinutes || 15)) {
        const higher = transactions.slice(1);
        const [blockerLive, followerLive] = await Promise.all([
          this.verifyStillPending(first),
          Promise.any(higher.map(tx => this.verifyStillPending(tx).then(value => value ? tx : Promise.reject()))).catch(() => null),
        ]);
        if (blockerLive && followerLive) {
          const body = `TX ${first.hash} (nonce ${first.nonce}) is still pending and is blocking ${higher.length} higher-nonce transaction${higher.length === 1 ? '' : 's'}.`;
          await deliverAlert({
            kind: 'blocker', scopeKey: first.hash,
            title: `URGENT: ${first.hash} is blocking ${higher.length} transaction${higher.length === 1 ? '' : 's'}`,
            body, tx: first, settings: this.settings, rule: blockerRule, urgent: true,
            extra: { blockedCount: higher.length, currentGasGwei: round(this.currentGasGwei) },
          });
        }
      }
    }
  }

  async notifyReplacement(oldTx, newTx) {
    const rule = this.rule('replaced');
    await deliverAlert({
      kind: 'replaced', scopeKey: oldTx.hash, title: `Transaction replaced: ${oldTx.hash}`,
      body: `TX ${oldTx.hash} was replaced by ${newTx.hash} using nonce ${oldTx.nonce}.`,
      tx: { ...oldTx, status: 'replaced' }, settings: this.settings, rule,
      extra: { replacementHash: newTx.hash },
    });
  }

  async notifyDropped(tx) {
    const rule = this.rule('dropped');
    await deliverAlert({
      kind: 'dropped', scopeKey: tx.hash, title: `Transaction dropped: ${tx.hash}`,
      body: `TX ${tx.hash} with nonce ${tx.nonce} is no longer visible after three consecutive checks.`,
      tx, settings: this.settings, rule,
    });
  }

  async checkGasStation(force = false) {
    const balance = this.settings?.balanceSettings || {};
    if (!/^0x[a-f0-9]{40}$/.test(balance.gasAddress || '')) return;
    const interval = Math.max(60_000, Number(balance.gasInterval) || 300_000);
    if (!force && Date.now() - this.lastGasCheck < interval) return;
    this.lastGasCheck = Date.now();
    const raw = await this.rpc('eth_getBalance', [balance.gasAddress, 'latest']);
    const current = Number(BigInt(raw)) / 1e18;
    this.gasStation = {
      name: balance.gasName || 'Gas Station',
      address: balance.gasAddress,
      balance: current,
      threshold: Number(balance.gasThreshold || 0),
      sufficient: current >= Number(balance.gasThreshold || 0),
      checkedAt: new Date().toISOString(),
    };
    if (current >= Number(balance.gasThreshold || 0)) return;
    const rule = this.rule('gasLow');
    await deliverAlert({
      kind: 'gasLow', scopeKey: balance.gasAddress, title: 'URGENT: Gas Station balance is low',
      body: `${balance.gasName || 'Gas Station'} has ${round(current, 6)} ETH. Minimum: ${balance.gasThreshold} ETH.`,
      settings: this.settings, rule, urgent: true,
      extra: { wallet: balance.gasName || 'Gas Station', status: 'low balance' },
    });
  }

  rule(name) {
    return this.settings?.notificationSettings?.rules?.[name] || { enabled: false };
  }

  status() {
    return {
      connected: this.connected,
      monitoredAddresses: this.settings?.addresses?.length || 0,
      lastPendingAt: this.lastPendingAt ? new Date(this.lastPendingAt).toISOString() : null,
      lastConfirmedBlock: this.lastConfirmedBlock,
      lastConfirmedBlockAt: this.lastConfirmedBlockAt ? new Date(this.lastConfirmedBlockAt).toISOString() : null,
      blockScanning: this.blockScanning,
      gasStation: this.gasStation,
      error: this.lastError || null,
    };
  }

  logError(error) {
    console.error('Monitor cycle failed:', error?.message || error);
  }
}

function round(value, digits = 3) {
  return Number(value || 0).toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
}

module.exports = { EthereumMonitor };
