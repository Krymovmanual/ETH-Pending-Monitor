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
    this.snapshotTimer = null;
    this.gasTimer = null;
    this.lastGasCheck = 0;
    this.currentGasGwei = 0;
    this.subscriptionIds = new Set();
  }

  async start() {
    this.settings = await db.getSettings();
    this.running = true;
    this.connect();
    this.statusTimer = setInterval(() => this.checkPending().catch(this.logError), 30_000);
    this.snapshotTimer = setInterval(() => this.scanPendingBlock().catch(this.logError), 60_000);
    this.gasTimer = setInterval(() => this.checkGasStation().catch(this.logError), 60_000);
    await Promise.allSettled([this.scanPendingBlock(), this.checkPending(), this.checkGasStation()]);
  }

  async reconfigure(settings) {
    this.settings = settings || await db.getSettings();
    this.disconnect();
    this.connect();
    await Promise.allSettled([this.scanPendingBlock(), this.checkPending(), this.checkGasStation(true)]);
  }

  stop() {
    this.running = false;
    this.disconnect();
    clearInterval(this.statusTimer);
    clearInterval(this.snapshotTimer);
    clearInterval(this.gasTimer);
  }

  disconnect() {
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.subscriptionIds.clear();
  }

  connect() {
    if (!this.running || !config.alchemyWssUrl || !this.settings?.addresses?.length) return;
    this.ws = new WebSocket(config.alchemyWssUrl);
    this.ws.on('open', () => {
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
    this.ws.on('error', error => console.error('Alchemy WebSocket error:', error.message));
    this.ws.on('close', () => {
      this.ws = null;
      if (this.running) this.reconnectTimer = setTimeout(() => this.connect(), 5_000);
    });
  }

  async handleMessage(data) {
    const message = JSON.parse(data.toString());
    if (message.id && message.result) this.subscriptionIds.add(message.result);
    const tx = message.params?.result;
    if (tx?.hash) await this.observeTransaction(tx);
  }

  normalizeTransaction(tx) {
    const input = String(tx.input || '0x').toLowerCase();
    const maxFee = tx.maxFeePerGas || tx.gasPrice || '0x0';
    return {
      ...tx,
      hash: tx.hash.toLowerCase(),
      from: String(tx.from || '').toLowerCase(),
      to: tx.to ? tx.to.toLowerCase() : null,
      nonce: Number.parseInt(tx.nonce || '0x0', 16),
      valueWei: BigInt(tx.value || '0x0').toString(),
      maxFeePerGasGwei: Number(BigInt(maxFee)) / 1e9,
      method: input.startsWith(ERC20_TRANSFER) ? 'transfer' : input.startsWith(ERC20_TRANSFER_FROM) ? 'transferFrom' : input.slice(0, 10),
      observedAt: Date.now(),
    };
  }

  isMonitored(tx) {
    const addresses = new Set((this.settings?.addresses || []).map(value => value.toLowerCase()));
    return addresses.has(String(tx.from || '').toLowerCase()) || addresses.has(String(tx.to || '').toLowerCase());
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
      method: 'POST',
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

  logError(error) {
    console.error('Monitor cycle failed:', error?.message || error);
  }
}

function round(value, digits = 3) {
  return Number(value || 0).toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
}

module.exports = { EthereumMonitor };
