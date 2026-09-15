const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./fixture');

test('Bitcoin watch-only balances, UTXO Health and network data are served through Railway',async t=>{
  const f=await fixture();t.after(()=>f.close());
  const {validBitcoinAddress}=require('../server/bitcoin');
  const address='1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
  assert.equal(validBitcoinAddress(address),true);
  assert.equal(validBitcoinAddress('1BoatSLRHtKNngkdXEeobR76b53LETtpyX'),false);
  const user=await f.register('bitcoin@example.test');
  let response=await user.client.call('/api/settings','PUT',{bitcoinAddresses:[address],bitcoinLabels:{[address]:'BTC Cold Storage'},addresses:[],labels:{},solanaAddresses:[],solanaLabels:{}});
  assert.equal(response.status,200);
  assert.deepEqual(response.data.settings.bitcoinAddresses,[address]);
  response=await user.client.call('/api/wallets/bitcoin/balances','POST',{addresses:[address]});
  assert.equal(response.status,200);
  assert.equal(response.data.wallets[0].balance.count,3);
  assert.equal(response.data.wallets[0].balance.dust,1);
  assert.equal(response.data.wallets[0].balance.totalBtc,'0.02625500');
  assert.equal(response.data.wallets[0].balance.level,'attention');
  assert.ok(response.data.wallets[0].balance.estimatedConsolidation.feeSats>0);
  assert.equal(response.data.wallets[0].balance.estimatedPayout.available,true);
  assert.equal(response.data.wallets[0].balance.estimatedPayout.payoutBtc,'0.01000000');
  assert.ok(response.data.wallets[0].balance.estimatedPayout.inputs>=1);
  assert.ok(response.data.wallets[0].balance.estimatedPayout.feeSats>0);
  response=await user.client.call('/api/networks/bitcoin');
  assert.equal(response.status,200);
  assert.equal(response.data.level,'healthy');
  assert.equal(response.data.blocks,865432);
  assert.equal(response.data.feeSatVbyte.standard,12);
  assert.equal(response.data.feeIntelligence.configuredThreshold,5);
  assert.equal(response.data.feeIntelligence.lowWindow,false);
  assert.equal(response.data.feeIntelligence.baseline.samples,1);
});

test('Bitcoin consolidation opportunity uses fee threshold, UTXO health and Telegram throttling',async t=>{
  const f=await fixture();t.after(()=>f.close());
  const user=await f.register('bitcoin-alert@example.test');
  const address='1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
  const {EthereumMonitor}=require('../server/monitor');const {forUser}=require('../server/user-db');
  const monitor=new EthereumMonitor();monitor.settings={
    bitcoinAddresses:[address],bitcoinLabels:{[address]:'BTC Treasury'},telegramChatId:'-1001234567890',
    bitcoinSettings:{lowFeeThreshold:20,expectedPayoutBtc:.01,checkInterval:600000},
    notificationSettings:{rules:{bitcoinConsolidation:{enabled:true,browser:false,email:false,telegram:true,repeatMinutes:720}}},
  };
  await forUser(user.id,()=>monitor.checkBitcoinIntelligence(true));
  assert.equal(monitor.bitcoinIntelligence.lowWindow,true);
  assert.equal(f.telegramMessages.length,1);
  assert.match(f.telegramMessages[0].text,/Bitcoin consolidation window/);
  assert.match(f.telegramMessages[0].text,/BTC Treasury has 3 UTXOs/);
  assert.equal(f.telegramMessages[0].reply_markup.inline_keyboard[0][0].text,'Open wallet on mempool.space');
  await forUser(user.id,()=>monitor.checkBitcoinIntelligence(true));
  assert.equal(f.telegramMessages.length,1,'repeat interval suppresses duplicate consolidation alerts');
});
