const test=require('node:test');
const assert=require('node:assert/strict');
const {summarize}=require('../docs/overview-data');

test('overview consolidates known values and positions across exchanges',()=>{
  const result=summarize({updatedAt:100,exchanges:[{id:'bitget',status:'connected'},{id:'gate',status:'partial'}],accounts:[
    {exchangeId:'bitget',exchangeName:'Bitget',summary:{equityUsd:100,availableUsd:70,unrealisedPnl:5},assets:[],positions:[{symbol:'BTCUSDT'}]},
    {exchangeId:'gate',exchangeName:'Gate.io',summary:{equityUsd:50,availableUsd:40,unrealisedPnl:-2},assets:[],positions:[{symbol:'ETH_USDT'}]},
    {exchangeId:'gate',exchangeName:'Gate.io',summary:{equityUsd:null,availableUsd:null,unrealisedPnl:null},assets:[{usdValue:null}],positions:[]},
  ]});
  assert.equal(result.exchangeCount,2);
  assert.equal(result.accounts.length,3);
  assert.equal(result.positions.length,2);
  assert.deepEqual(result.equity,{value:150,count:2});
  assert.deepEqual(result.available,{value:110,count:2});
  assert.deepEqual(result.pnl,{value:3,count:2});
  assert.deepEqual(result.allocation.map(item=>[item.name,item.value]),[['Bitget',100],['Gate.io',50]]);
  assert.equal(result.statusByExchange.get('gate'),'partial');
});

test('overview does not convert unknown values to zero',()=>{
  const result=summarize({accounts:[{exchangeId:'gate',summary:{equityUsd:null},assets:[{usdValue:null}],positions:[]}],exchanges:[]});
  assert.equal(result.equity.value,null);
  assert.equal(result.equity.count,0);
  assert.deepEqual(result.allocation,[]);
});
