const WebSocket = require('ws');
const { config } = require('./config');
const db = require('./db');

const RETENTION_DAYS = 30;
const RECONNECT_MS = 5_000;

function fromHexGwei(value) {
  if (!value) return 0;
  try { return Number(BigInt(value)) / 1e9; }
  catch { return 0; }
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function metricSummary(samples, key) {
  const values = samples.map(sample => finite(sample[key])).filter(value => value >= 0);
  return {
    min: Math.min(...values),
    avg: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: median(values),
    max: Math.max(...values),
  };
}

function minuteStart(timestamp = Date.now()) {
  return new Date(Math.floor(timestamp / 60_000) * 60_000);
}

function rounded(value, digits = 4) {
  return Number(finite(value).toFixed(digits));
}

class GasAnalyticsCollector {
  constructor() {
    this.ws = null;
    this.running = false;
    this.connected = false;
    this.subscriptionId = null;
    this.reconnectTimer = null;
    this.flushTimer = null;
    this.cleanupTimer = null;
    this.collecting = false;
    this.lastError = '';
    this.lastBlockAt = 0;
    this.current = null;
    this.previousStandard = null;
    this.bucketMinute = null;
    this.bucketSamples = [];
  }

  start() {
    this.running = true;
    if (!/^wss:\/\//.test(config.alchemyWssUrl)) {
      this.lastError = 'ALCHEMY_WSS_URL is not configured';
      return;
    }
    this.connect();
    this.flushTimer = setInterval(() => this.flushBucket().catch(this.logError), 30_000);
    this.cleanupTimer = setInterval(() => db.cleanupGasAnalytics(RETENTION_DAYS).catch(this.logError), 24 * 60 * 60 * 1000);
    db.cleanupGasAnalytics(RETENTION_DAYS).catch(this.logError);
  }

  async stop() {
    this.running = false;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.flushTimer);
    clearInterval(this.cleanupTimer);
    await this.flushBucket().catch(this.logError);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  connect() {
    if (!this.running || this.ws) return;
    this.ws = new WebSocket(config.alchemyWssUrl);
    this.ws.on('open', () => {
      this.connected = true;
      this.lastError = '';
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id: 701, method: 'eth_subscribe', params: ['newHeads'] }));
      console.log('Gas Analytics connected to Ethereum blocks');
    });
    this.ws.on('message', data => this.handleMessage(data).catch(this.logError));
    this.ws.on('error', error => {
      this.lastError = error.message || 'Alchemy WebSocket error';
      console.error('Gas Analytics WebSocket error:', this.lastError);
    });
    this.ws.on('close', () => {
      this.ws = null;
      this.connected = false;
      this.subscriptionId = null;
      if (this.running) this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_MS);
    });
  }

  async handleMessage(data) {
    const message = JSON.parse(data.toString());
    if (message.id === 701) {
      if (message.error) throw new Error(message.error.message || 'newHeads subscription failed');
      this.subscriptionId = message.result;
      return;
    }
    if (!message.params?.result || (this.subscriptionId && message.params.subscription !== this.subscriptionId)) return;
    await this.collectBlock(message.params.result);
  }

  async rpc(method, params) {
    const response = await fetch(config.alchemyHttpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
      signal: AbortSignal.timeout(8_000),
    });
    const body = await response.json();
    if (!response.ok || body.error) throw new Error(body.error?.message || `${method} failed`);
    return body.result;
  }

  async collectBlock(header) {
    if (this.collecting || !header?.baseFeePerGas) return;
    this.collecting = true;
    try {
      const feeHistory = await this.rpc('eth_feeHistory', ['0x5', 'latest', [10, 50, 90]]);
      const baseFee = fromHexGwei(header.baseFeePerGas);
      const rewards = Array.isArray(feeHistory?.reward) ? feeHistory.reward : [];
      const priorities = [0, 1, 2].map(index => {
        const values = rewards.map(row => fromHexGwei(row?.[index])).filter(value => value > 0);
        return values.length ? median(values) : [0.1, 0.5, 1.5][index];
      });
      const sample = {
        base: baseFee,
        low: baseFee + priorities[0],
        standard: baseFee + priorities[1],
        fast: baseFee + priorities[2],
      };
      const now = Date.now();
      const minute = minuteStart(now);
      if (this.bucketMinute && minute.getTime() !== this.bucketMinute.getTime()) {
        await this.flushBucket(true);
      }
      if (!this.bucketMinute) this.bucketMinute = minute;
      this.bucketSamples.push(sample);
      const changePercent = this.previousStandard > 0
        ? ((sample.standard - this.previousStandard) / this.previousStandard) * 100
        : 0;
      this.previousStandard = sample.standard;
      this.lastBlockAt = now;
      this.lastError = '';
      this.current = {
        blockNumber: header.number ? Number.parseInt(header.number, 16) : null,
        sampledAt: new Date(now).toISOString(),
        baseFee: rounded(sample.base),
        priorityLow: rounded(priorities[0]),
        priorityStandard: rounded(priorities[1]),
        priorityFast: rounded(priorities[2]),
        low: rounded(sample.low),
        standard: rounded(sample.standard),
        fast: rounded(sample.fast),
        changePercent: rounded(changePercent, 2),
        spike: Math.abs(changePercent) >= 20,
      };
    } catch (error) {
      this.lastError = error.message || 'Gas Analytics update failed';
      console.error('Gas Analytics update failed:', this.lastError);
    } finally {
      this.collecting = false;
    }
  }

  async flushBucket(reset = false) {
    if (!this.bucketMinute || !this.bucketSamples.length) return;
    const snapshot = {
      minute: this.bucketMinute,
      sampleCount: this.bucketSamples.length,
      base: metricSummary(this.bucketSamples, 'base'),
      low: metricSummary(this.bucketSamples, 'low'),
      standard: metricSummary(this.bucketSamples, 'standard'),
      fast: metricSummary(this.bucketSamples, 'fast'),
    };
    await db.saveGasMinute(snapshot);
    if (reset) {
      this.bucketMinute = null;
      this.bucketSamples = [];
    }
  }

  status() {
    return {
      connected: this.connected,
      collecting: this.collecting,
      lastBlockAt: this.lastBlockAt ? new Date(this.lastBlockAt).toISOString() : null,
      error: this.lastError || null,
      current: this.current,
    };
  }

  logError(error) {
    console.error('Gas Analytics:', error?.message || error);
  }
}

module.exports = { GasAnalyticsCollector, RETENTION_DAYS };
