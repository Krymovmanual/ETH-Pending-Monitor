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
  const context = vm.createContext({
    document: {body:element(), querySelector(selector) {
      if (selector.startsWith('#') && !html.includes(`id="${selector.slice(1)}"`)) return null;
      return nodes[selector] ||= element();
    }, querySelectorAll(){return [];}, addEventListener(){}},
    window: {location:{search:'?view=wallets'},addEventListener(){}}, location:{}, navigator:{},
    localStorage:{getItem(key){return stored[key] ?? null;},removeItem(key){delete stored[key];},setItem(key,value){stored[key]=value;}},
    URLSearchParams, URL, AbortSignal, console, Intl, fetch:fetchImpl,
    setInterval(){},setTimeout(){},clearInterval(){},clearTimeout(){},
  });
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
test('Alchemy RPC uses authenticated backend, never the supplied browser endpoint',async()=>{
  const calls=[];
  const app=application({},async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({result:'0x1'})};});
  app.run("state.backendUrl='https://example.test'; state.backendToken='abcdefghijklmnopqrstuvwx'");
  assert.equal(await app.run("rpc('https://secret.alchemy.test', 'eth_gasPrice', [])"),'0x1');
  assert.equal(calls[0].url,'https://example.test/api/providers/alchemy/rpc');
  assert.match(calls[0].options.headers.Authorization,/^Bearer /);
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
  app.run("state.backendUrl='https://example.test'; state.backendToken='abcdefghijklmnopqrstuvwx'");
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
