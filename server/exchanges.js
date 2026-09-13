const {createBitgetClient}=require('./bitget');
const {createBybitClient}=require('./bybit');
const {createGateClient}=require('./gate');
const {createOkxClient}=require('./okx');
const {createBinanceClient}=require('./binance');

const definitions={
  bitget:{name:'Bitget',passphrase:true,create:createBitgetClient},
  bybit:{name:'Bybit',passphrase:false,create:createBybitClient},
  gate:{name:'Gate.io',passphrase:false,create:createGateClient},
  okx:{name:'OKX',passphrase:true,create:createOkxClient},
  binance:{name:'Binance',passphrase:false,create:createBinanceClient},
};
function definition(id){return definitions[String(id||'').toLowerCase()]||null;}
function createExchangeClient(id,credentials){const item=definition(id);if(!item)throw new Error('Unsupported exchange');return item.create(credentials);}
module.exports={definitions,definition,createExchangeClient};
