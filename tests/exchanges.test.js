const test=require('node:test');
const assert=require('node:assert/strict');
const {createBybitClient}=require('../server/bybit');
const {createOkxClient}=require('../server/okx');
const {createBinanceClient}=require('../server/binance');
const {createGateClient}=require('../server/gate');

async function withFetch(handler,work){const native=global.fetch;global.fetch=handler;try{return await work();}finally{global.fetch=native;}}
const credentials={apiKey:'key',secret:'secret',passphrase:'pass'};

test('Bybit adapter enforces read-only and normalizes Unified assets and positions',async()=>withFetch(async url=>{
  const value=String(url);
  if(value.includes('query-api'))return Response.json({retCode:0,result:{readOnly:1}});
  if(value.includes('wallet-balance'))return Response.json({retCode:0,result:{list:[{totalEquity:'120',totalAvailableBalance:'90',totalPerpUPL:'2',coin:[{coin:'USDT',equity:'100',locked:'4',usdValue:'100',borrowAmount:'0'}]}]}});
  if(value.includes('position/list')&&value.includes('settleCoin=USDT'))return Response.json({retCode:0,result:{list:[{symbol:'BTCUSDT',side:'Buy',size:'0.01',avgPrice:'60000',markPrice:'61000',positionValue:'610',positionIM:'61',unrealisedPnl:'10',leverage:'10',liqPrice:'50000'}]}});
  return Response.json({retCode:0,result:{list:[]}});
},async()=>{const client=createBybitClient(credentials);await client.validateReadOnly();const data=await client.fetchAccounts();assert.equal(data.accounts[0].assets[0].coin,'USDT');assert.equal(data.accounts[0].positions[0].unrealisedPnlUsd,10);}));

test('OKX adapter rejects trading keys and maps trading account',async()=>{
  await withFetch(async url=>Response.json({code:'0',data:String(url).includes('/config')?[{perm:'read_only,trade'}]:[]}),async()=>assert.rejects(()=>createOkxClient(credentials).validateReadOnly(),/Read permission only/));
  await withFetch(async url=>{const value=String(url);if(value.includes('/config'))return Response.json({code:'0',data:[{perm:'read_only'}]});if(value.includes('/balance'))return Response.json({code:'0',data:[{totalEq:'50',availEq:'45',upl:'1',details:[{ccy:'USDT',eq:'50',availBal:'45',frozenBal:'5',eqUsd:'50',debt:'0'}]}]});if(value.includes('/positions'))return Response.json({code:'0',data:[]});return Response.json({code:'0',data:[]});},async()=>{const client=createOkxClient(credentials);await client.validateReadOnly();const data=await client.fetchAccounts();assert.equal(data.accounts[0].summary.equityUsd,50);});
});

test('Binance adapter blocks enabled write permissions and returns spot assets',async()=>{
  await withFetch(async url=>Response.json(String(url).includes('apiRestrictions')?{enableWithdrawals:true}:{balances:[]}),async()=>assert.rejects(()=>createBinanceClient(credentials).validateReadOnly(),/trading, transfer or withdrawal/));
  await withFetch(async url=>{const value=String(url);if(value.includes('ticker/price'))return Response.json([{symbol:'BTCUSDT',price:'60000'}]);if(value.includes('fapi'))return Response.json({totalWalletBalance:'10',availableBalance:'9',totalUnrealizedProfit:'1',assets:[],positions:[]});return Response.json({balances:[{asset:'BTC',free:'0.01',locked:'0'}]});},async()=>{const data=await createBinanceClient(credentials).fetchAccounts();assert.equal(data.accounts[0].assets[0].usdValue,600);assert.equal(data.accounts.length,2);});
});

test('Gate.io adapter signs read requests and maps spot assets',async()=>withFetch(async url=>{
  const value=String(url);if(value.includes('/spot/accounts'))return Response.json([{currency:'USDT',available:'20',locked:'2'}]);return Response.json([]);
},async()=>{const client=createGateClient(credentials);await client.validateReadOnly();const data=await client.fetchAccounts();assert.equal(data.accounts[0].assets[0].equity,22);}));

test('Gate.io adapter treats an unopened BTC futures account as optional',async()=>withFetch(async url=>{
  const value=String(url);
  if(value.includes('/spot/accounts'))return Response.json([]);
  if(value.includes('/futures/btc/'))return Response.json({label:'ACCOUNT_NOT_FOUND',message:'please transfer funds first to create futures account'},{status:400});
  return Response.json([]);
},async()=>{const data=await createGateClient(credentials).fetchAccounts();assert.deepEqual(data.warnings,[]);assert.equal(data.accounts.some(account=>account.type==='futures-btc'),false);}));
