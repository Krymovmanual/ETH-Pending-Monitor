const test=require('node:test');const assert=require('node:assert/strict');
const {fixture}=require('./fixture');const c=require('../server/auth/crypto');const {forUser}=require('../server/user-db');
test('multi-user authentication, credentials and isolation integration',async t=>{
  const f=await fixture();t.after(()=>f.close());
  const alice=await f.register('alice@example.test'),bob=await f.register('bob@example.test');
  await t.test('anonymous and legacy admin token cannot read private routes',async()=>{
    const anon=f.client();for(const path of ['/api/settings','/api/transactions','/api/connections','/api/exchanges/accounts','/api/auth/security'])assert.equal((await anon.call(path,'GET',null,{Authorization:'Bearer legacy-token'})).status,401);
  });
  await t.test('CSRF and cross-origin changes are refused',async()=>{
    assert.equal((await alice.client.call('/api/settings','PUT',{addresses:[]},{'X-CSRF-Token':''})).status,403);
    assert.equal((await alice.client.call('/api/settings','PUT',{addresses:[]},{Origin:'https://evil.test'})).status,403);
  });
  await t.test('wallet settings, transaction rows and preferences are isolated',async()=>{
    const address='0x'+'a'.repeat(40);
    assert.equal((await alice.client.call('/api/settings','PUT',{addresses:[address]})).status,200);
    assert.deepEqual((await bob.client.call('/api/settings')).data.addresses,[]);
    await forUser(alice.id,()=>f.db.upsertTransaction({hash:'0x'+'1'.repeat(64),from:address,to:null,nonce:1}));
    assert.equal((await alice.client.call('/api/transactions')).data.items.length,1);
    assert.equal((await bob.client.call('/api/transactions')).data.items.length,0);
    await alice.client.call('/api/preferences','PUT',{'treasury-transfer-drafts':'["private"]'});
    assert.deepEqual((await bob.client.call('/api/preferences')).data,{});
    await assert.rejects(async()=>f.db.recentTransactions(),/context is required/);
  });
  let secret,codes,connection;
  await t.test('background monitor remains bound to its owner across async calls',async()=>{
    const {bindMonitor}=require('../server/monitors');const {EthereumMonitor}=require('../server/monitor');
    const monitor=bindMonitor(new EthereumMonitor(),alice.id);const address='0x'+'c'.repeat(40);
    monitor.settings={addresses:[address]};
    const hash='0x'+'c'.repeat(64);
    await forUser(bob.id,()=>monitor.observeTransaction({hash,from:address,nonce:'0x3',value:'0x0'}));
    const rows=(await f.db.pool.query('SELECT user_id FROM user_transactions WHERE hash=$1',[hash])).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].user_id,alice.id);
    await f.db.pool.query('DELETE FROM user_transactions WHERE hash=$1',[hash]);
  });
  await t.test('enable TOTP, issue recovery codes and reject replay',async()=>{
    let r=await alice.client.call('/api/auth/mfa/setup','POST',{password:alice.password});assert.equal(r.status,200);secret=r.data.secret;
    const code=c.totp(secret);r=await alice.client.call('/api/auth/mfa/enable','POST',{code});assert.equal(r.status,200);codes=r.data.recoveryCodes;
    assert.equal(codes.length,10);
    assert.equal((await alice.client.call('/api/connections','POST',{code})).status,401);
    const row=(await f.db.pool.query('SELECT totp_secret FROM users WHERE id=$1',[alice.id])).rows[0];assert.ok(!row.totp_secret.includes(secret));
  });
  await t.test('only read-only keys accepted, encrypted keys never returned',async()=>{
    const credentials={name:'Main',apiKey:'fixture-api-key',secret:'fixture-private-secret',passphrase:'fixture-passphrase',readOnlyConfirmed:'yes'};
    f.unsafe(true);assert.equal((await alice.client.call('/api/connections','POST',{...credentials,code:codes.shift()})).status,400);f.unsafe(false);
    const r=await alice.client.call('/api/connections','POST',{...credentials,code:codes.shift()});assert.equal(r.status,201);connection=r.data.id;
    const rows=await alice.client.call('/api/connections');assert.equal(rows.data.items.length,1);assert.ok(!JSON.stringify(rows.data).includes(credentials.secret));
    const row=(await f.db.pool.query('SELECT * FROM exchange_connections WHERE id=$1',[connection])).rows[0];
    assert.ok(!row.credentials.includes(credentials.apiKey));
    assert.throws(()=>c.unseal(row.credentials,`exchange:${bob.id}:${connection}`));
    assert.equal((await bob.client.call('/api/connections')).data.items.length,0);
    assert.equal((await bob.client.call('/api/exchanges/accounts')).data.accounts.length,0);
    assert.equal((await alice.client.call('/api/exchanges/accounts')).data.accounts.length,1);
  });
  await t.test('UTA-only read access works when classic Spot permission metadata is unavailable',async()=>{
    f.denyClassicInfo(true);
    const r=await alice.client.call('/api/connections','POST',{name:'UTA only',apiKey:'uta-key',secret:'uta-secret',passphrase:'uta-passphrase',readOnlyConfirmed:'yes',code:codes.shift()});
    f.denyClassicInfo(false);
    assert.equal(r.status,201);
    assert.equal((await alice.client.call('/api/connections')).data.items.length,2);
  });
  await t.test('recovery code is single-use; pending MFA session cannot read data',async()=>{
    const other=f.client();assert.equal((await other.call('/api/auth/login','POST',{email:alice.email,password:alice.password})).data.twoFactorRequired,true);
    assert.equal((await other.call('/api/transactions')).status,401);
    const code=codes.shift();assert.equal((await other.call('/api/auth/mfa/login','POST',{code})).status,200);await other.call('/api/auth/me');
    assert.equal((await other.call('/api/transactions')).status,200);
    assert.equal((await other.call('/api/connections','POST',{code})).status,401);
  });
  await t.test('revoking another user session has no effect',async()=>{
    const sessions=(await alice.client.call('/api/auth/security')).data.sessions;
    await bob.client.call('/api/auth/sessions/'+sessions[0].id_hash,'DELETE');assert.equal((await alice.client.call('/api/auth/me')).status,200);
  });
  await t.test('an old tab cannot write settings under a different logged-in account',async()=>{
    const r=await bob.client.call('/api/settings','PUT',{addresses:[]},{'X-Workspace-User':alice.id});
    assert.equal(r.status,409);assert.equal(r.data.code,'SESSION_CHANGED');
  });
  await t.test('owner migration is isolated, one-time and preserves legacy data',async()=>{
    process.env.BOOTSTRAP_OWNER_EMAIL=alice.email;
    await f.db.pool.query("INSERT INTO transactions(hash,from_address,nonce,tx_data) VALUES($1,$2,99,'{}')",['0x'+'9'.repeat(64),'0x'+'a'.repeat(40)]);
    assert.equal((await bob.client.call('/api/owner/import','POST',{code:codes[0]})).status,403);
    assert.equal((await alice.client.call('/api/owner/import','POST',{code:codes.shift()})).status,200);
    assert.equal((await alice.client.call('/api/owner/import','POST',{code:codes.shift()})).status,409);
    assert.equal((await alice.client.call('/api/transactions')).data.items.length,2);
    assert.equal((await bob.client.call('/api/transactions')).data.items.length,0);
    assert.equal((await f.db.pool.query('SELECT COUNT(*) AS count FROM transactions')).rows[0].count,1);
  });
  await t.test('push subscriptions belong to a user and disappear with a revoked session',async()=>{
    const s=(await bob.client.call('/api/auth/security')).data.sessions[0];
    await forUser(bob.id,()=>f.db.savePushSubscription({endpoint:'https://fcm.googleapis.com/test',keys:{}},s.id_hash));
    assert.equal((await forUser(bob.id,()=>f.db.allPushSubscriptions())).length,1);
    assert.equal((await forUser(alice.id,()=>f.db.allPushSubscriptions())).length,0);
    await bob.client.call('/api/auth/sessions/'+s.id_hash,'DELETE');
    assert.equal((await forUser(bob.id,()=>f.db.allPushSubscriptions())).length,0);
    await bob.client.call('/api/auth/login','POST',{email:bob.email,password:bob.password});await bob.client.call('/api/auth/me');
  });
  await t.test('password reset needs MFA and revokes sessions',async()=>{
    await f.db.pool.query('DELETE FROM request_limits');
    await alice.client.call('/api/auth/forgot','POST',{email:alice.email});const token=f.mailToken(alice.email,'reset');
    const anon=f.client();assert.equal((await anon.call('/api/auth/reset','POST',{token,password:'new-long-password-123'})).status,401);
    assert.equal((await anon.call('/api/auth/reset','POST',{token,password:'new-long-password-123',code:codes.shift()})).status,200);
    assert.equal((await alice.client.call('/api/auth/me')).status,401);
    assert.equal((await anon.call('/api/auth/reset','POST',{token,password:'another-long-password'})).status,400);
  });
  await t.test('logout invalidates the server session',async()=>{
    assert.equal((await bob.client.call('/api/auth/logout','POST')).status,200);assert.equal((await bob.client.call('/api/auth/me')).status,401);
  });
});
test('TOTP matches RFC 6238 SHA-1 test vector',()=>{
  const secret=c.base32(Buffer.from('12345678901234567890'));
  assert.equal(c.totp(secret,Math.floor(59/30),8),'94287082');
  assert.equal(c.totp(secret,Math.floor(1111111109/30),8),'07081804');
});
