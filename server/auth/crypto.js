const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');
function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw Object.assign(new Error('Use a password with 12–128 characters'), {status:400});
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64, {N:32768, r:8, p:3, maxmem:64*1024*1024});
  return `scrypt$${salt}$${key.toString('hex')}`;
}
async function passwordMatches(password, encoded) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [,salt,key] = String(encoded || '').split('$');
  const derived = await scrypt(password, salt || 'dummy-password-salt', 64, {N:32768,r:8,p:3,maxmem:64*1024*1024});
  return Boolean(key && same(derived.toString('hex'), key));
}
function encryptionKey() {
  const key = Buffer.from(process.env.CREDENTIAL_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) throw new Error('CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  return key;
}
function seal(value, context) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return [1,iv.toString('base64'),cipher.getAuthTag().toString('base64'),data.toString('base64')].join('.');
}
function unseal(value, context) {
  const [version,iv,tag,data] = String(value).split('.');
  if(version !== '1') throw new Error('Unsupported encrypted record');
  const cipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv,'base64'));
  cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(Buffer.from(tag,'base64'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data,'base64')),cipher.final()]).toString());
}
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(bytes) {
  let bits=0,value=0,result='';
  for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){result+=alphabet[(value>>>(bits-5))&31];bits-=5;}}
  if(bits)result+=alphabet[(value<<(5-bits))&31];return result;
}
function fromBase32(secret) {
  let bits=0,value=0;const bytes=[];
  for(const char of secret){const n=alphabet.indexOf(char);if(n<0)throw new Error('Invalid secret');value=(value<<5)|n;bits+=5;if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8;}}
  return Buffer.from(bytes);
}
function totp(secret, step=Math.floor(Date.now()/30000), digits=6) {
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));
  const digest=crypto.createHmac('sha1',fromBase32(secret)).update(counter).digest();
  const offset=digest[digest.length-1]&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%10**digits).padStart(digits,'0');
}
function verifyTotp(secret, code, lastStep=-1) {
  if(!/^\d{6}$/.test(String(code)))return null;
  const current=Math.floor(Date.now()/30000);
  for(const step of [current,current-1,current+1])if(step>Number(lastStep)&&same(totp(secret,step),code))return step;
  return null;
}
module.exports={hash,token,same,passwordHash,passwordMatches,seal,unseal,encryptionKey,base32,totp,verifyTotp};
