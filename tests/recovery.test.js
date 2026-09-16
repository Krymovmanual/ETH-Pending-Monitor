const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');

function application(stored = {}, fetchImpl = async () => { throw Error('offline'); }) {
  const html = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8');
  const element = () => ({ dataset: {}, classList: {toggle(){},add(){},remove(){}}, style: {},
    closest(){return null;}, addEventListener(){}, setAttribute(){}, removeAttribute(){},
    querySelectorAll(){return [];}, showModal(){this.open=true;}, value:'all', textContent:'', innerHTML:'' });
  const nodes = {};
  const Treasury = {user:null,storage:{getItem(key){return stored[key] ?? null;},removeItem(key){delete stored[key];},setItem(key,value){stored[key]=value;}}};
  const context = vm.createContext({
    Treasury,
    document: {body:element(), querySelector(selector) {
      if (selector.startsWith('#') && !html.includes(`id="${selector.slice(1)}"`)) return null;
      return nodes[selector] ||= element();
    }, querySelectorAll(){return [];}, addEventListener(){}},
    window: {Treasury,location:{search:'?view=wallets'},addEventListener(){}}, location:{origin:'https://example.test'}, navigator:{},
    localStorage:{getItem(key){return stored[key] ?? null;},removeItem(key){delete stored[key];},setItem(key,value){stored[key]=value;}},
    URLSearchParams, URL, AbortSignal, console, Intl, fetch:fetchImpl,
    setInterval(){},setTimeout(){},clearInterval(){},clearTimeout(){},
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'docs/overview-data.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root, 'docs/app.js'),'utf8'),context);
  return {context,nodes,run:source=>vm.runInContext(source,context)};
}

test('fresh browser initializes and opens connection settings', () => {
  const app=application();
  assert.equal(app.context.window.treasuryBootComplete,true);
  assert.equal(app.run('el.dialog.open'),true);
});
test('null cached objects do not crash startup', () => {
  const app=application(Object.fromEntries(['news-cache','wallet-balances','gas-balance','address-labels','token-cache','summary-alerts'].map(key=>['eth-pending-monitor-'+key,'null'])));
  assert.equal(app.context.window.treasuryBootComplete,true);
});
test('Alchemy RPC uses session backend, never the supplied browser endpoint',async()=>{
  const calls=[];
  const app=application({},async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({result:'0x1'})};});
  app.run("state.backendUrl='https://example.test'; Treasury.user={id:'test'}");
  assert.equal(await app.run("rpc('https://secret.alchemy.test', 'eth_gasPrice', [])"),'0x1');
  assert.equal(calls[0].url,'https://example.test/api/providers/alchemy/rpc');
  assert.equal(calls[0].options.headers.Authorization,undefined);
});
test('pending receipt checks never POST to the current HTML page',async()=>{
  const calls=[];
  const app=application({},async(url,options)=>{
    calls.push({url,options});
    const requests=JSON.parse(options.body);
    return {ok:true,json:async()=>requests.map(request=>({id:request.id,result:null}))};
  });
  const hash='0x'+'a'.repeat(64);
  app.run(`Treasury.user={id:'test'};state.backendUrl='https://example.test';state.transactions=[{hash:'${hash}',status:'pending',firstSeen:Date.now(),nonce:1,from:'0x${'1'.repeat(40)}'}]`);
  await app.run('checkStatuses()');
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://example.test/api/providers/alchemy/rpc');
  assert.doesNotMatch(calls[0].url,/index\.html/);
});
test('pre-alert transaction verification uses the Railway RPC proxy',async()=>{
  const calls=[];
  const app=application({},async(url,options)=>{
    calls.push({url,options});
    const requests=JSON.parse(options.body);
    return {ok:true,json:async()=>requests.map(request=>({
      id:request.id,
      result:request.method==='eth_getTransactionByHash'?{hash:request.params[0],blockNumber:null}:null,
    }))};
  });
  const hash='0x'+'b'.repeat(64);
  app.run(`Treasury.user={id:'test'};state.backendUrl='https://example.test'`);
  const live=await app.run(`verifyTransactionsStillPending([{hash:'${hash}',status:'pending',firstSeen:Date.now(),nonce:2}])`);
  assert.equal(live.length,1);
  assert.equal(calls.length,2);
  assert.ok(calls.every(call=>call.url==='https://example.test/api/providers/alchemy/rpc'));
});
test('nonce normalization is idempotent',()=>{
  const {EthereumMonitor}=require('../server/monitor');
  const monitor=new EthereumMonitor();
  const tx={hash:'0xabc',nonce:194649,value:'0x0'};
  assert.equal(monitor.normalizeTransaction(monitor.normalizeTransaction(tx)).nonce,194649);
});
test('missing block cannot advance scanner checkpoint',async()=>{
  const {EthereumMonitor}=require('../server/monitor');
  const monitor=new EthereumMonitor();
  monitor.settings={addresses:['0x'+'1'.repeat(40)]}; monitor.lastConfirmedBlock=10;
  monitor.rpc=async(method)=>method==='eth_blockNumber'?'0xb':null;
  await assert.rejects(monitor.scanConfirmedBlocks(),/Block unavailable/);
  assert.equal(monitor.lastConfirmedBlock,10);
  assert.equal(monitor.blockScanning,false);
});
test('authorization failure is actionable', async()=>{
  const app=application({},async()=>({ok:false,status:401,json:async()=>({error:'Unauthorized'})}));
  app.run("state.backendUrl='https://example.test'; Treasury.user={id:'test'}");
  await assert.rejects(app.run("rpc('', 'eth_gasPrice', [])"),/check your server access token/);
});
test('missing receipt cannot mark a transaction confirmed',async()=>{
  const {EthereumMonitor}=require('../server/monitor');
  const monitor=new EthereumMonitor();
  const address='0x'+'1'.repeat(40);
  monitor.settings={addresses:[address]}; monitor.lastConfirmedBlock=10;
  monitor.rpc=async(method)=> method==='eth_blockNumber'?'0xb':method==='eth_getBlockByNumber'
    ? {timestamp:'0x1',transactions:[{hash:'0xabc',from:address,nonce:'0x1',value:'0x0'}]} : null;
  await assert.rejects(monitor.scanConfirmedBlocks(),/Receipt unavailable/);
  assert.equal(monitor.lastConfirmedBlock,10);
});
test('RPC proxy rejects transaction submission',async()=>{
  const {config}=require('../server/config');
  const previous=config.alchemyHttpUrl; config.alchemyHttpUrl='https://example.test';
  try {
    await assert.rejects(require('../server/providers').proxyAlchemyRpc({method:'eth_sendRawTransaction',params:['0x']}),/not allowed/);
  } finally { config.alchemyHttpUrl=previous; }
});
