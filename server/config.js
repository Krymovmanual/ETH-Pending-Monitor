const crypto = require('node:crypto');

function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

const config = {
  port: Number(process.env.PORT) || 3000,
  databaseUrl: String(process.env.DATABASE_URL || '').trim(),
  alchemyWssUrl: String(process.env.ALCHEMY_WSS_URL || '').trim(),
  etherscanApiKey: String(process.env.ETHERSCAN_API_KEY || '').trim(),
  cryptoCompareApiKey: String(process.env.CRYPTOCOMPARE_API_KEY || '').trim(),
  adminToken: String(process.env.ADMIN_TOKEN || '').trim(),
  frontendOrigins: String(process.env.FRONTEND_ORIGIN || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean),
  resendApiKey: String(process.env.RESEND_API_KEY || '').trim(),
  emailFrom: String(process.env.EMAIL_FROM || 'ETH Pending Monitor <onboarding@resend.dev>').trim(),
  vapidPublicKey: String(process.env.VAPID_PUBLIC_KEY || '').trim(),
  vapidPrivateKey: String(process.env.VAPID_PRIVATE_KEY || '').trim(),
  vapidSubject: String(process.env.VAPID_SUBJECT || 'mailto:admin@example.com').trim(),
};

config.alchemyHttpUrl = config.alchemyWssUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');

function tokenMatches(value) {
  const supplied = Buffer.from(String(value || ''));
  const expected = Buffer.from(config.adminToken);
  return Boolean(expected.length && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected));
}

function validateEnvironment() {
  const missing = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (!/^wss:\/\//.test(config.alchemyWssUrl)) missing.push('ALCHEMY_WSS_URL');
  if (config.adminToken.length < 24) missing.push('ADMIN_TOKEN (minimum 24 characters)');
  return missing;
}

module.exports = { config, tokenMatches, validateEnvironment, normalizeOrigin };
