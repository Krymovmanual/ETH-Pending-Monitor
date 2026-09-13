const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./fixture');

test('Solana addresses, balances and network health are served through Railway',async t=>{
  const f=await fixture();t.after(()=>f.close());
  const {validSolanaAddress}=require('../server/wallets');
  assert.equal(validSolanaAddress('11111111111111111111111111111111'),true);
  assert.equal(validSolanaAddress('not-a-solana-address'),false);
  const user=await f.register('solana@example.test');
  const address='11111111111111111111111111111111';
  let response=await user.client.call('/api/settings','PUT',{solanaAddresses:[address],solanaLabels:{[address]:'Solana Treasury'},addresses:[],labels:{},balanceSettings:{solanaGasAddress:address,solanaGasThreshold:1,solanaGasInterval:300000}});
  assert.equal(response.status,200);
  assert.deepEqual(response.data.settings.solanaAddresses,[address]);
  response=await user.client.call('/api/wallets/solana/balances','POST',{addresses:[address]});
  assert.equal(response.status,200);
  assert.equal(response.data.wallets[0].assets.find(asset=>asset.symbol==='SOL').balance,'2.5');
  assert.equal(response.data.wallets[0].assets.find(asset=>asset.symbol==='USDC').balance,'12.5');
  response=await user.client.call('/api/networks/solana');
  assert.equal(response.status,200);
  assert.equal(response.data.level,'healthy');
  assert.equal(response.data.slot,345678901);
  assert.equal(response.data.priorityFeeMicroLamports.median,200);
});
