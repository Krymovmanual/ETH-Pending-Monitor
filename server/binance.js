const crypto=require('node:crypto');
const {numberOrNull,nonZero,baseAsset,stablecoin,optional,account}=require('./exchange-common');

function createBinanceClient(credentials){
  async function request(base,path,query={}){
    const params=new URLSearchParams({...Object.fromEntries(Object.entries(query).filter(([,v])=>v!==undefined&&v!==null&&v!=='')),timestamp:String(Date.now()),recvWindow:'5000'});
    params.set('signature',crypto.createHmac('sha256',credentials.secret).update(params.toString()).digest('hex'));
    const response=await fetch(`${base}${path}?${params}`,{headers:{'X-MBX-APIKEY':credentials.apiKey},signal:AbortSignal.timeout(15000)});const body=await response.json().catch(()=>({}));
    if(!response.ok||body?.code<0)throw new Error(`Binance request failed: ${String(body?.msg||`HTTP ${response.status}`).slice(0,180)}`);return body;
  }
  async function publicPrices(){const response=await fetch('https://api.binance.com/api/v3/ticker/price',{signal:AbortSignal.timeout(15000)});if(!response.ok)return new Map();const rows=await response.json();return new Map(rows.map(row=>[row.symbol,Number(row.price)]));}
  async function fetchAccounts(){
    const warnings=[],spot=await request('https://api.binance.com','/api/v3/account',{omitZeroBalances:'true'}),prices=await optional('USD valuation',publicPrices,warnings)||new Map();
    const futures=await optional('USD-M Futures',()=>request('https://fapi.binance.com','/fapi/v3/account'),warnings);
    const usdValue=(coin,amount)=>stablecoin(coin)?Number(amount):(prices.get(`${coin}USDT`)?Number(amount)*prices.get(`${coin}USDT`):null);
    const spotAssets=(spot.balances||[]).map(item=>{const equity=Number(item.free||0)+Number(item.locked||0);return {id:`binance:spot:${item.asset}`,exchangeId:'binance',accountId:'binance:spot',coin:String(item.asset||''),equity,available:numberOrNull(item.free),locked:numberOrNull(item.locked),usdValue:usdValue(item.asset,equity),debt:null};}).filter(item=>item.coin&&nonZero(item.equity,item.available,item.locked));
    const positions=(futures?.positions||[]).map(item=>{const signed=numberOrNull(item.positionAmt),side=String(item.positionSide)==='SHORT'||(signed!==null&&signed<0)?'short':'long',size=signed===null?null:Math.abs(signed);return {id:`binance:usdm:${item.symbol}:${side}`,exchangeId:'binance',accountId:'binance:usdm',category:'USD-M',symbol:String(item.symbol||''),baseAsset:baseAsset(item.symbol),side,marginMode:item.isolated?'isolated':'cross',marginCoin:'USDT',size,sizeCurrency:baseAsset(item.symbol),leverage:numberOrNull(item.leverage),entryPrice:numberOrNull(item.entryPrice),markPrice:null,notional:Math.abs(Number(item.notional||0)),margin:numberOrNull(item.positionInitialMargin),marginUsd:numberOrNull(item.positionInitialMargin),liquidationPrice:null,unrealisedPnl:numberOrNull(item.unrealizedProfit),unrealisedPnlUsd:numberOrNull(item.unrealizedProfit),pnlCurrency:'USDT',profitRate:null,updatedAt:null};}).filter(item=>Number(item.size)!==0);
    const futureAssets=(futures?.assets||[]).map(item=>({id:`binance:usdm:${item.asset}`,exchangeId:'binance',accountId:'binance:usdm',coin:String(item.asset||''),equity:numberOrNull(item.walletBalance),available:numberOrNull(item.availableBalance),locked:numberOrNull(item.initialMargin),usdValue:usdValue(item.asset,item.walletBalance),debt:null})).filter(item=>item.coin&&nonZero(item.equity,item.available,item.locked));
    const updatedAt=Date.now(),spotEquity=spotAssets.every(x=>x.usdValue!==null)?spotAssets.reduce((s,x)=>s+x.usdValue,0):null,accounts=[account({exchangeId:'binance',exchangeName:'Binance',name:'Spot',type:'spot',updatedAt,summary:{equityUsd:spotEquity},assets:spotAssets})];
    if(futures)accounts.push(account({exchangeId:'binance',exchangeName:'Binance',name:'USD-M Futures',type:'usdm',updatedAt,summary:{equityUsd:numberOrNull(futures.totalWalletBalance),availableUsd:numberOrNull(futures.availableBalance),unrealisedPnl:numberOrNull(futures.totalUnrealizedProfit),positionValue:positions.reduce((s,p)=>s+Number(p.notional||0),0)},assets:futureAssets,positions}));return {updatedAt,accounts,warnings};
  }
  return {fetchAccounts,async validateReadOnly(){const permissions=await request('https://api.binance.com','/sapi/v1/account/apiRestrictions');if(permissions.enableWithdrawals||permissions.enableInternalTransfer||permissions.enableSpotAndMarginTrading||permissions.enableFutures)throw new Error('Binance API key has trading, transfer or withdrawal permissions. Disable them first.');await request('https://api.binance.com','/api/v3/account',{omitZeroBalances:'true'});return true;}};
}
module.exports={createBinanceClient};
