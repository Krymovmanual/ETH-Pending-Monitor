const crypto=require('node:crypto');
const {numberOrNull,nonZero,baseAsset,stablecoin,optional,account}=require('./exchange-common');

function createBybitClient(credentials){
  const baseUrl='https://api.bybit.com',recvWindow='5000';
  async function request(path,query={}){
    const params=new URLSearchParams();for(const [key,value] of Object.entries(query))if(value!==undefined&&value!==null&&value!=='')params.set(key,String(value));
    const queryString=params.toString(),timestamp=String(Date.now());
    const signature=crypto.createHmac('sha256',credentials.secret).update(`${timestamp}${credentials.apiKey}${recvWindow}${queryString}`).digest('hex');
    const response=await fetch(`${baseUrl}${path}${queryString?'?'+queryString:''}`,{headers:{'X-BAPI-API-KEY':credentials.apiKey,'X-BAPI-SIGN':signature,'X-BAPI-TIMESTAMP':timestamp,'X-BAPI-RECV-WINDOW':recvWindow},signal:AbortSignal.timeout(15000)});
    const body=await response.json().catch(()=>({}));if(!response.ok||Number(body.retCode)!==0)throw new Error(`Bybit request failed: ${String(body.retMsg||`HTTP ${response.status}`).slice(0,180)}`);return body.result;
  }
  function position(item,category){
    const symbol=String(item.symbol||''),size=numberOrNull(item.size),mark=numberOrNull(item.markPrice),inverse=category==='inverse';
    const pnl=numberOrNull(item.unrealisedPnl),pnlCurrency=inverse?baseAsset(symbol):(symbol.endsWith('USDC')?'USDC':'USDT');
    return {id:`bybit:${category}:${symbol}:${String(item.side||'').toLowerCase()}`,exchangeId:'bybit',accountId:'bybit:unified',category:category.toUpperCase(),symbol,baseAsset:baseAsset(symbol),side:String(item.side).toLowerCase()==='sell'?'short':'long',marginMode:'',marginCoin:pnlCurrency,size,sizeCurrency:baseAsset(symbol),leverage:numberOrNull(item.leverage),entryPrice:numberOrNull(item.avgPrice),markPrice:mark,notional:numberOrNull(item.positionValue)??(size!==null&&mark!==null?Math.abs(size*mark):null),margin:numberOrNull(item.positionIM),marginUsd:numberOrNull(item.positionIM),liquidationPrice:numberOrNull(item.liqPrice),unrealisedPnl:pnl,unrealisedPnlUsd:pnl===null?null:stablecoin(pnlCurrency)?pnl:(mark!==null?pnl*mark:null),pnlCurrency,profitRate:null,updatedAt:numberOrNull(item.updatedTime)};
  }
  async function fetchAccounts(){
    const warnings=[],wallet=await request('/v5/account/wallet-balance',{accountType:'UNIFIED'}),root=wallet?.list?.[0];if(!root)throw new Error('Bybit returned no Unified account');
    const specs=[['linear',{category:'linear',settleCoin:'USDT',limit:200}],['linear',{category:'linear',settleCoin:'USDC',limit:200}],['inverse',{category:'inverse',limit:200}],['option',{category:'option',limit:200}]];
    const results=await Promise.all(specs.map(([label,query])=>optional(`${label} positions`,()=>request('/v5/position/list',query),warnings)));
    const positions=results.flatMap((result,index)=>(result?.list||[]).map(item=>position(item,specs[index][0]))).filter(item=>Number(item.size)!==0);
    const assets=(root.coin||[]).map(item=>({id:`bybit:unified:${item.coin}`,exchangeId:'bybit',accountId:'bybit:unified',coin:String(item.coin||''),equity:numberOrNull(item.equity),available:null,locked:numberOrNull(item.locked),usdValue:numberOrNull(item.usdValue),debt:numberOrNull(item.borrowAmount)})).filter(item=>item.coin&&nonZero(item.equity,item.locked,item.debt));
    const updatedAt=Date.now(),accounts=[account({exchangeId:'bybit',exchangeName:'Bybit',name:'Unified',type:'unified',updatedAt,summary:{equityUsd:numberOrNull(root.totalEquity),availableUsd:numberOrNull(root.totalAvailableBalance),unrealisedPnl:numberOrNull(root.totalPerpUPL),positionValue:positions.reduce((sum,p)=>sum+Number(p.notional||0),0)},assets,positions})];
    return {updatedAt,accounts,warnings};
  }
  return {fetchAccounts,async validateReadOnly(){const info=await request('/v5/user/query-api');if(Number(info?.readOnly)!==1)throw new Error('Bybit API key is not Read-only');await request('/v5/account/wallet-balance',{accountType:'UNIFIED'});return true;}};
}
module.exports={createBybitClient};
