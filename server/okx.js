const crypto=require('node:crypto');
const {numberOrNull,nonZero,baseAsset,stablecoin,optional,account}=require('./exchange-common');

function createOkxClient(credentials){
  const baseUrl='https://www.okx.com';
  async function request(path,query={}){
    const params=new URLSearchParams();for(const [key,value] of Object.entries(query))if(value!==undefined&&value!==null&&value!=='')params.set(key,String(value));
    const requestPath=`${path}${params.size?'?'+params:''}`,timestamp=new Date().toISOString();
    const sign=crypto.createHmac('sha256',credentials.secret).update(`${timestamp}GET${requestPath}`).digest('base64');
    const response=await fetch(baseUrl+requestPath,{headers:{'OK-ACCESS-KEY':credentials.apiKey,'OK-ACCESS-SIGN':sign,'OK-ACCESS-TIMESTAMP':timestamp,'OK-ACCESS-PASSPHRASE':credentials.passphrase},signal:AbortSignal.timeout(15000)});
    const body=await response.json().catch(()=>({}));if(!response.ok||String(body.code)!=='0')throw new Error(`OKX request failed: ${String(body.msg||`HTTP ${response.status}`).slice(0,180)}`);return body.data;
  }
  function normalizePosition(item){
    const symbol=String(item.instId||''),signed=numberOrNull(item.pos),side=String(item.posSide||'').toLowerCase()==='short'||(signed!==null&&signed<0)?'short':'long',size=signed===null?null:Math.abs(signed),pnl=numberOrNull(item.upl),pnlCurrency=String(item.ccy||symbol.split('-').at(-1)||'').toUpperCase();
    return {id:`okx:${symbol}:${side}`,exchangeId:'okx',accountId:'okx:trading',category:String(item.instType||''),symbol,baseAsset:baseAsset(symbol),side,marginMode:String(item.mgnMode||''),marginCoin:pnlCurrency,size,sizeCurrency:baseAsset(symbol),leverage:numberOrNull(item.lever),entryPrice:numberOrNull(item.avgPx),markPrice:numberOrNull(item.markPx),notional:numberOrNull(item.notionalUsd),margin:numberOrNull(item.margin),marginUsd:null,liquidationPrice:numberOrNull(item.liqPx),unrealisedPnl:pnl,unrealisedPnlUsd:stablecoin(pnlCurrency)?pnl:null,pnlCurrency,profitRate:numberOrNull(item.uplRatio),updatedAt:numberOrNull(item.uTime)};
  }
  async function fetchAccounts(){
    const warnings=[],balance=await request('/api/v5/account/balance'),root=balance?.[0];if(!root)throw new Error('OKX returned no trading account');
    const [positionRows,fundingRows]=await Promise.all([optional('Positions',()=>request('/api/v5/account/positions'),warnings),optional('Funding assets',()=>request('/api/v5/asset/balances'),warnings)]);
    const positions=(positionRows||[]).map(normalizePosition).filter(item=>Number(item.size)!==0);
    const tradingAssets=(root.details||[]).map(item=>({id:`okx:trading:${item.ccy}`,exchangeId:'okx',accountId:'okx:trading',coin:String(item.ccy||''),equity:numberOrNull(item.eq),available:numberOrNull(item.availBal),locked:numberOrNull(item.frozenBal),usdValue:numberOrNull(item.eqUsd),debt:numberOrNull(item.debt)})).filter(item=>item.coin&&nonZero(item.equity,item.available,item.locked,item.debt));
    const fundingAssets=(fundingRows||[]).map(item=>({id:`okx:funding:${item.ccy}`,exchangeId:'okx',accountId:'okx:funding',coin:String(item.ccy||''),equity:numberOrNull(item.bal),available:numberOrNull(item.availBal),locked:numberOrNull(item.frozenBal),usdValue:null,debt:null})).filter(item=>item.coin&&nonZero(item.equity,item.available,item.locked));
    const updatedAt=Date.now(),accounts=[account({exchangeId:'okx',exchangeName:'OKX',name:'Trading',type:'trading',updatedAt,summary:{equityUsd:numberOrNull(root.totalEq),availableUsd:numberOrNull(root.availEq),unrealisedPnl:numberOrNull(root.upl),positionValue:positions.reduce((sum,p)=>sum+Number(p.notional||0),0)},assets:tradingAssets,positions})];
    if(fundingAssets.length)accounts.push(account({exchangeId:'okx',exchangeName:'OKX',name:'Funding',type:'funding',updatedAt,assets:fundingAssets}));return {updatedAt,accounts,warnings};
  }
  return {fetchAccounts,async validateReadOnly(){const rows=await request('/api/v5/account/config'),config=rows?.[0],permissions=String(config?.perm||'').toLowerCase().split(',').map(x=>x.trim());if(!permissions.includes('read_only')||permissions.some(x=>x==='trade'||x.includes('withdraw')))throw new Error('OKX API key must have Read permission only');await request('/api/v5/account/balance');return true;}};
}
module.exports={createOkxClient};
