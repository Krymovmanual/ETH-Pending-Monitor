const webpush = require('web-push');
const { config } = require('./config');
const db = require('./db');

if (config.vapidPublicKey && config.vapidPrivateKey) {
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
}

function hasPushConfiguration() {
  return Boolean(config.vapidPublicKey && config.vapidPrivateKey);
}

async function sendEmail(recipient, subject, fields) {
  if (!recipient) throw new Error('Alert email is not configured');
  if (config.resendApiKey) {
    const rows = Object.entries(fields)
      .map(([key, value]) => `<tr><td style="padding:6px 12px;color:#667085">${escapeHtml(key)}</td><td style="padding:6px 12px">${escapeHtml(value)}</td></tr>`)
      .join('');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: config.emailFrom,
        to: [recipient],
        subject,
        html: `<h2>${escapeHtml(subject)}</h2><table>${rows}</table>`,
      }),
    });
    if (!response.ok) throw new Error(`Resend rejected email (${response.status})`);
    return;
  }

  const response = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(recipient)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ _subject: subject, _template: 'table', _captcha: 'false', ...fields }),
  });
  if (!response.ok) throw new Error(`FormSubmit rejected email (${response.status})`);
}

async function sendPush(title, body, url, tag, urgent = false) {
  if (!hasPushConfiguration()) return 0;
  const subscriptions = await db.allPushSubscriptions();
  let delivered = 0;
  await Promise.all(subscriptions.map(async row => {
    try {
      await webpush.sendNotification(row.subscription, JSON.stringify({ title, body, url, tag, urgent }));
      delivered += 1;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) await db.deletePushSubscription(row.endpoint);
      else console.error('Push delivery failed:', error.message);
    }
  }));
  return delivered;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function walletLabel(settings, address) {
  return settings.labels?.[address] || shortAddress(address);
}

function shortAddress(address) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Unknown wallet';
}

async function deliverAlert({ kind, scopeKey, title, body, tx, settings, rule, extra = {}, urgent = false }) {
  if (!rule?.enabled) return false;
  if (inQuietHours(settings, rule)) return false;
  if (!(await db.alertIsDue(kind, scopeKey, rule.repeatMinutes))) return false;

  let delivered = false;
  const url = tx?.hash ? `https://etherscan.io/tx/${tx.hash}` : undefined;
  if (rule.browser) {
    delivered = (await sendPush(title, body, url, `${kind}-${scopeKey}`, urgent)) > 0 || delivered;
  }
  if (rule.email && settings.email) {
    await sendEmail(settings.email, title, {
      event: kind,
      wallet: tx ? walletLabel(settings, tx.from_address) : extra.wallet || '—',
      transaction_hash: tx?.hash || extra.transactionHash || '—',
      nonce: tx?.nonce ?? extra.nonce ?? '—',
      status: tx?.status || extra.status || '—',
      max_fee: tx?.tx_data?.maxFeePerGasGwei ? `${tx.tx_data.maxFeePerGasGwei} Gwei` : '—',
      current_network_gas: extra.currentGasGwei ? `${extra.currentGasGwei} Gwei` : '—',
      blocking_transactions: extra.blockedCount ?? '—',
      details: body,
      etherscan: url || '—',
      checked_at: new Date().toISOString(),
    });
    delivered = true;
  }
  if (delivered) await db.recordAlert(kind, scopeKey);
  return delivered;
}

function inQuietHours(settings, rule) {
  const notifications = settings.notificationSettings || {};
  if (!notifications.quietHoursEnabled || rule.ignoreQuiet) return false;
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: settings.timezone || 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  }
  const hour = Number(parts.find(item => item.type === 'hour')?.value || 0);
  const minute = Number(parts.find(item => item.type === 'minute')?.value || 0);
  const now = hour * 60 + minute;
  const toMinutes = value => {
    const [hours, minutes] = String(value || '').split(':').map(Number);
    return hours * 60 + minutes;
  };
  const start = toMinutes(notifications.quietStart || '22:00');
  const end = toMinutes(notifications.quietEnd || '08:00');
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

module.exports = { sendEmail, sendPush, deliverAlert, hasPushConfiguration };
