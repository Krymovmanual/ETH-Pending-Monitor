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
  response=await user.client.call('/api/networks/bitcoin');
  assert.equal(response.status,200);
  assert.equal(response.data.level,'healthy');
  assert.equal(response.data.blocks,865432);
  assert.equal(response.data.feeSatVbyte.standard,12);
});
