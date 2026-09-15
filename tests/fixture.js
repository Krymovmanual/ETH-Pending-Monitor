const {PGlite}=require('@electric-sql/pglite');
const crypto=require('node:crypto');
async function fixture(){
  process.env.NODE_ENV='development';process.env.APP_ORIGIN='http://127.0.0.1';
  process.env.CREDENTIAL_ENCRYPTION_KEY=crypto.randomBytes(32).toString('base64');
  process.env.REGISTRATION_OPEN='true';process.env.DISABLE_MONITORS='true';process.env.RESEND_API_KEY='fixture';
  process.env.SOLANA_RPC_URL='https://solana.test';
  process.env.BITCOIN_RPC_URL='https://bitcoin.test';process.env.BITCOIN_INDEXER_URL='https://mempool.test/api';
  process.env.TELEGRAM_BOT_TOKEN='fixture-telegram-token';
  const postgres=new PGlite();await postgres.waitReady;
  const db=require('../server/db');
  const query=async(sql,params)=>{
    const result=params?.length?await postgres.query(sql,params):/;\s*\S/.test(sql)?(await postgres.exec(sql)).at(-1):await postgres.query(sql);
    return {...result,rowCount:result.affectedRows??result.rows?.length??0};
  };
  db.pool.query=query;db.pool.connect=async()=>({query,release(){}});
  db.pool.end=()=>postgres.close();
  const nativeFetch=global.fetch;const mails=[],telegramMessages=[];
  let unsafeKey=false,denyClassicInfo=false;
  global.fetch=async(url,opts)=>{
    const value=String(url);
    if(value.startsWith('https://api.resend.com/')){mails.push(JSON.parse(opts.body));return new Response('{}',{status:200});}
    if(value.startsWith('https://api.telegram.org/')){telegramMessages.push(JSON.parse(opts.body));return Response.json({ok:true,result:{message_id:1}});}
    if(value.startsWith('https://api.bitget.com')){
      if(value.includes('/info')&&denyClassicInfo)return Response.json({code:'40014',msg:'Permission denied'},{status:403});
      const data=value.includes('/info')?{authorities:unsafeKey?['trade']:['readonly']}:value.includes('/assets')?{accountEquity:'100',assets:[]}:value.includes('funding')?[]:{list:[]};
      return Response.json({code:'00000',data});
    }
    if(value==='https://solana.test'){
      const source=JSON.parse(opts.body);const requests=Array.isArray(source)?source:[source];
      const result=request=>{
        if(request.method==='getHealth')return'ok';
        if(request.method==='getSlot')return 345678901;
        if(request.method==='getBlockHeight')return 321654987;
        if(request.method==='getLatestBlockhash')return{context:{slot:345678901},value:{blockhash:'fixture-blockhash',lastValidBlockHeight:321655137}};
        if(request.method==='getRecentPrioritizationFees')return[100,200,300,400].map((prioritizationFee,index)=>({slot:345678900-index,prioritizationFee}));
        if(request.method==='getBalance')return{context:{slot:345678901},value:2500000000};
        if(request.method==='getTokenAccountsByOwner')return{context:{slot:345678901},value:request.params?.[1]?.programId?.startsWith('Tokenkeg')?[{account:{data:{parsed:{info:{mint:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',tokenAmount:{amount:'12500000',decimals:6,uiAmountString:'12.5'}}}}}}]:[]};
        return null;
      };
      const rows=requests.map(request=>({jsonrpc:'2.0',id:request.id,result:result(request)}));
      return Response.json(Array.isArray(source)?rows:rows[0]);
    }
    if(value==='https://bitcoin.test'){
      const source=JSON.parse(opts.body);const requests=Array.isArray(source)?source:[source];
      const result=request=>{
        if(request.method==='getblockchaininfo')return{chain:'main',blocks:865432,headers:865432,bestblockhash:'000000000000000000fixture',difficulty:95000000000000,verificationprogress:1};
        if(request.method==='getmempoolinfo')return{size:45231,vsize:123456789,bytes:130000000,total_fee:4.25};
        if(request.method==='estimatesmartfee'){const target=Number(request.params?.[0]);return{feerate:target===1?.00025:target===3?.00012:.00006,blocks:target};}
        if(request.method==='getnetworkhashps')return 650000000000000000000;
        return null;
      };
      const rows=requests.map(request=>({jsonrpc:'2.0',id:request.id,result:result(request)}));
      return Response.json(Array.isArray(source)?rows:rows[0]);
    }
    if(value.startsWith('https://mempool.test/api/address/'))return Response.json([
      {txid:'a'.repeat(64),vout:0,value:2500000,status:{confirmed:true,block_height:865400}},
      {txid:'b'.repeat(64),vout:1,value:500,status:{confirmed:true,block_height:865410}},
      {txid:'c'.repeat(64),vout:0,value:125000,status:{confirmed:false}},
    ]);
    if(value.startsWith('https:'))throw Error('External requests disabled in tests');
    return nativeFetch(url,opts);
  };
  await db.initializeDatabase();
  const {app,auth}=require('../server/index');await auth.initialize();
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const origin=`http://localhost:${server.address().port}`;process.env.APP_ORIGIN=origin;
  function client(){
    let cookie='',csrf='';
    return {get cookie(){return cookie;},get csrf(){return csrf;},
      async call(route,method='GET',body,extra={}){
        const r=await nativeFetch(origin+route,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf,...extra},...(body?{body:JSON.stringify(body)}:{})});
        if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
        const data=await r.json();if(data.csrf)csrf=data.csrf;return {status:r.status,data,headers:r.headers};
      }};
  }
  function mailToken(email,purpose){const msg=mails.filter(m=>m.to[0]===email).at(-1);return msg?.html.match(new RegExp('#'+purpose+'=([A-Za-z0-9_-]+)'))?.[1];}
  async function register(email,password='long-test-password-123'){
    const user=client();let r=await user.call('/api/auth/register','POST',{email,password});if(r.status!==200)throw Error(JSON.stringify(r));
    r=await user.call('/api/auth/verify','POST',{token:mailToken(email,'verify')});if(r.status!==200)throw Error(JSON.stringify(r));
    await user.call('/api/auth/login','POST',{email,password});const me=await user.call('/api/auth/me');return {client:user,id:me.data.user.id,email,password};
  }
  return {origin,db,auth,postgres,client,register,mailToken,mails,telegramMessages,unsafe(value){unsafeKey=value;},denyClassicInfo(value){denyClassicInfo=value;},async close(){await new Promise(resolve=>server.close(resolve));global.fetch=nativeFetch;await postgres.close();}};
}
module.exports={fixture};
