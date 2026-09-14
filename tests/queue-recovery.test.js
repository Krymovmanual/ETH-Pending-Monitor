const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./fixture');

test('nonce queue survives a boost and hands attention to the next unresolved transaction',async t=>{
  const f=await fixture();t.after(()=>f.close());
  const owner=await f.register('queue-owner@example.test');
  const address='0x'+'7'.repeat(40);
  const {forUser}=require('../server/user-db');
  const {EthereumMonitor}=require('../server/monitor');
  const monitor=new EthereumMonitor();
  monitor.settings={
    addresses:[address],labels:{[address]:'Withdrawals'},telegramChatId:'-5596397335',
    notificationSettings:{quietHoursEnabled:false,rules:{
      pending:{enabled:true,telegram:true,browser:false,email:false,afterMinutes:15,repeatMinutes:0},
      blocker:{enabled:true,telegram:true,browser:false,email:false,afterMinutes:15,repeatMinutes:0,ignoreQuiet:true},
    }},
  };

  let latest=195191,pending=195198;
  monitor.rpc=async(method,_params)=>{
    if(method!=='eth_getTransactionCount')throw new Error(`Unexpected RPC method ${method}`);
    return `0x${(_params[1]==='latest'?latest:pending).toString(16)}`;
  };

  await forUser(owner.id,()=>monitor.reconcilePendingQueues());
  let queue=await forUser(owner.id,()=>f.db.pendingQueue());
  assert.equal(queue.length,7);
  assert.deepEqual(queue.map(row=>Number(row.nonce)),[195191,195192,195193,195194,195195,195196,195197]);

  await f.db.pool.query("UPDATE user_pending_queue SET first_seen=NOW()-INTERVAL '20 minutes' WHERE user_id=$1",[owner.id]);
  queue=await forUser(owner.id,()=>f.db.pendingQueue());
  await forUser(owner.id,()=>monitor.evaluateUnknownQueueAlerts(queue));
  assert.equal(f.telegramMessages.length,1);
  assert.match(f.telegramMessages[0].text,/nonce 195191 is blocking 6 transactions/i);
  assert.equal(f.telegramMessages[0].reply_markup.inline_keyboard[0][0].url,`https://etherscan.io/txsPending?a=${address}&m=hf`);

  latest=195192;
  await forUser(owner.id,()=>monitor.reconcilePendingQueues());
  queue=await forUser(owner.id,()=>f.db.pendingQueue());
  assert.equal(queue.length,6);
  assert.equal(Number(queue[0].nonce),195192);
  await forUser(owner.id,()=>monitor.evaluateUnknownQueueAlerts(queue));
  assert.equal(f.telegramMessages.length,2);
  assert.match(f.telegramMessages[1].text,/nonce 195192 is blocking 5 transactions/i);

  const response=await owner.client.call('/api/transactions');
  assert.equal(response.status,200);
  assert.equal(response.data.queue.length,6);
  assert.equal(Number(response.data.queue[0].nonce),195192);
});

test('a recovered nonce slot is linked to its full transaction when the hash appears',async t=>{
  const f=await fixture();t.after(()=>f.close());
  const owner=await f.register('queue-hash@example.test');
  const address='0x'+'8'.repeat(40);
  const {forUser}=require('../server/user-db');
  await forUser(owner.id,async()=>{
    await f.db.reconcilePendingQueue(address,42,44);
    await f.db.upsertTransaction({hash:'0x'+'a'.repeat(64),from:address,to:'0x'+'9'.repeat(40),nonce:42});
  });
  const queue=await forUser(owner.id,()=>f.db.pendingQueue());
  assert.equal(queue.length,2);
  assert.equal(queue[0].has_full_transaction,true);
  assert.equal(queue[1].has_full_transaction,false);
});
