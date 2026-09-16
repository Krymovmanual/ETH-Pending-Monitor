const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fixture}=require('./fixture');

test('Solana wallet UI is limited to SOL, USDT and USDC',()=>{
  const app=fs.readFileSync(path.join(__dirname,'../docs/app.js'),'utf8');
  assert.match(app,/\{symbol:'SOL', label:'SOL'\}/);
  assert.match(app,/\{symbol:'USDT', label:'USDT · SOL'\}/);
  assert.match(app,/\{symbol:'USDC', label:'USDC · SOL'\}/);
  assert.doesNotMatch(app,/assets\.slice\(0, 12\)/);
});

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
  assert.deepEqual(response.data.wallets[0].assets.map(asset=>asset.symbol),['SOL','USDT','USDC']);
  assert.deepEqual(response.data.wallets[0].assets.map(asset=>asset.balance),['2.5','7.25','12.5']);
  assert.equal(response.data.wallets[0].assets.some(asset=>asset.mint==='UnknownMintForRegressionTest'),false);
  response=await user.client.call('/api/networks/solana');
  assert.equal(response.status,200);
  assert.equal(response.data.level,'healthy');
  assert.equal(response.data.slot,345678901);
  assert.equal(response.data.priorityFeeMicroLamports.median,200);
});

test('Solana Gas Station has an independent 24/7 Telegram alert rule',async t=>{
  const f=await fixture();t.after(()=>f.close());
  const {EthereumMonitor}=require('../server/monitor');
  const {forUser}=require('../server/user-db');
  const user=await f.register('solana-alert@example.test');
  const address='11111111111111111111111111111111';
  const ethereumAddress='0x1111111111111111111111111111111111111111';
  const response=await user.client.call('/api/settings','PUT',{
    addresses:[],solanaAddresses:[],telegramChatId:'-1001234567890',
    balanceSettings:{gasAddress:ethereumAddress,gasThreshold:3,solanaGasAddress:address,solanaGasThreshold:3,solanaGasInterval:60000},
    notificationSettings:{rules:{gasLow:{enabled:false,telegram:false},solanaGasLow:{enabled:true,browser:false,email:false,telegram:true,repeatMinutes:60,ignoreQuiet:true}}},
  });
  assert.equal(response.status,200);
  assert.equal(response.data.settings.notificationSettings.rules.gasLow.enabled,false);
  assert.equal(response.data.settings.notificationSettings.rules.solanaGasLow.telegram,true);
  const monitor=new EthereumMonitor();monitor.settings=response.data.settings;monitor.rpc=async()=>`0x${(2n*10n**18n).toString(16)}`;
  const before=f.telegramMessages.length;
  await forUser(user.id,()=>monitor.checkGasStation(true));
  assert.equal(f.telegramMessages.length,before,'disabled ETH rule stays silent');
  await forUser(user.id,()=>monitor.checkSolanaGasStation(true));
  assert.equal(f.telegramMessages.length,before+1);
  assert.match(f.telegramMessages.at(-1).text,/SOL Gas Station balance is low/);
  assert.match(f.telegramMessages.at(-1).text,/2\.5 SOL/);
  await forUser(user.id,()=>monitor.checkSolanaGasStation(true));
  assert.equal(f.telegramMessages.length,before+1,'repeat window deduplicates the SOL alert');
});
