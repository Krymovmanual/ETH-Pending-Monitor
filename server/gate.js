const crypto=require('node:crypto');
const {numberOrNull,nonZero,baseAsset,stablecoin,optional,account}=require('./exchange-common');

function createGateClient(credentials){
  const baseUrl='https://api.gateio.ws';
  async function request(path,query={}){
    const params=new URLSearchParams();for(const [key,value] of Object.entries(query))if(value!==undefined&&value!==null&&value!=='')params.set(key,String(value));
    const queryString=params.toString(),timestamp=String(Math.floor(Date.now()/1000)),bodyHash=crypto.createHash('sha512').update('').digest('hex');
    const sign=crypto.createHmac('sha512',credentials.secret).update(`GET\n${path}\n${queryString}\n${bodyHash}\n${timestamp}`).digest('hex');
    const response=await fetch(`${baseUrl}${path}${queryString?'?'+queryString:''}`,{headers:{KEY:credentials.apiKey,Timestamp:timestamp,SIGN:sign},signal:AbortSignal.timeout(15000)});const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(`Gate.io request failed: ${String(body?.message||body?.label||`HTTP ${response.status}`).slice(0,180)}`);return body;
  }
  function normalizePosition(item,settle){const signed=numberOrNull(item.size),side=signed!==null&&signed<0?'short':'long',symbol=String(item.contract||''),pnl=numberOrNull(item.unrealised_pnl),pnlCurrency=String(item.settlement_currency||settle).toUpperCase();return {id:`gate:${settle}:${symbol}:${side}`,exchangeId:'gate',accountId:`gate:futures-${settle}`,category:`${settle.toUpperCase()}-FUTURES`,symbol,baseAsset:baseAsset(symbol),side,marginMode:String(item.mode||''),marginCoin:pnlCurrency,size:signed===null?null:Math.abs(signed),sizeCurrency:'contracts',leverage:numberOrNull(item.leverage),entryPrice:numberOrNull(item.entry_price),markPrice:numberOrNull(item.mark_price),notional:Math.abs(Number(item.value||0)),margin:numberOrNull(item.margin),marginUsd:stablecoin(pnlCurrency)?numberOrNull(item.margin):null,liquidationPrice:numberOrNull(item.liq_price??item.liquidation_price),unrealisedPnl:pnl,unrealisedPnlUsd:stablecoin(pnlCurrency)?pnl:null,pnlCurrency,profitRate:null,updatedAt:numberOrNull(item.update_time_ms)};}
  async function fetchAccounts(){
    const warnings=[],spot=await request('/api/v4/spot/accounts');
    const results=await Promise.all(['usdt','btc'].map(settle=>Promise.all([optional(`${settle.toUpperCase()} futures account`,()=>request(`/api/v4/futures/${settle}/accounts`),warnings),optional(`${settle.toUpperCase()} futures positions`,()=>request(`/api/v4/futures/${settle}/positions`),warnings)])));
    const spotAssets=(spot||[]).map(item=>({id:`gate:spot:${item.currency}`,exchangeId:'gate',accountId:'gate:spot',coin:String(item.currency||''),equity:Number(item.available||0)+Number(item.locked||0),available:numberOrNull(item.available),locked:numberOrNull(item.locked),usdValue:null,debt:null})).filter(item=>item.coin&&nonZero(item.equity,item.available,item.locked));
    const updatedAt=Date.now(),accounts=[account({exchangeId:'gate',exchangeName:'Gate.io',name:'Spot',type:'spot',updatedAt,assets:spotAssets})];
    results.forEach(([details,rows],index)=>{if(!details&&!rows)return;const settle=['usdt','btc'][index],positions=(rows||[]).map(item=>normalizePosition(item,settle)).filter(item=>Number(item.size)!==0),currency=String(details?.currency||settle).toUpperCase(),equity=numberOrNull(details?.total);const assets=details?[{id:`gate:futures-${settle}:${currency}`,exchangeId:'gate',accountId:`gate:futures-${settle}`,coin:currency,equity,available:numberOrNull(details.available),locked:numberOrNull(details.position_margin),usdValue:stablecoin(currency)?equity:null,debt:null}].filter(x=>nonZero(x.equity,x.available,x.locked)):[];accounts.push(account({exchangeId:'gate',exchangeName:'Gate.io',name:`${settle.toUpperCase()} Futures`,type:`futures-${settle}`,updatedAt,summary:{equityUsd:stablecoin(currency)?equity:null,availableUsd:stablecoin(currency)?numberOrNull(details?.available):null,unrealisedPnl:stablecoin(currency)?numberOrNull(details?.unrealised_pnl):null,positionValue:positions.reduce((s,p)=>s+Number(p.notional||0),0)},assets,positions}));});
    return {updatedAt,accounts,warnings};
  }
  return {fetchAccounts,async validateReadOnly(){await request('/api/v4/spot/accounts');return {permissionsConfirmed:false};}};
}
module.exports={createGateClient};
