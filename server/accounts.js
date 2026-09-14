const crypto=require('node:crypto');
const {createExchangeClient,definition}=require('./exchanges');
const {seal,unseal}=require('./auth/crypto');
const {userId}=require('./user-db');
const {fail}=require('./auth/service');
function createAccounts(pool,auth){
  const cache=new Map();
  const aad=(owner,id)=>`exchange:${owner}:${id}`;
  async function list(){return(await pool.query('SELECT id,name,exchange,key_hint,status,last_checked,created_at FROM exchange_connections WHERE user_id=$1 ORDER BY created_at',[userId()])).rows;}
  async function all({force=false}={}){
    const rows=(await pool.query('SELECT * FROM exchange_connections WHERE user_id=$1 ORDER BY created_at',[userId()])).rows;
    const accounts=[],warnings=[];
    for(const row of rows){
      try {
        let data=cache.get(row.id);
        if(force||!data||Date.now()-data.updatedAt>20000){
          const credentials=unseal(row.credentials,aad(row.user_id,row.id));
          const client=createExchangeClient(row.exchange,credentials);
          data=client.fetchAccounts?await client.fetchAccounts():await client.fetchBitgetAccounts();cache.set(row.id,data);
          await pool.query("UPDATE exchange_connections SET last_checked=NOW(),status='connected' WHERE user_id=$1 AND id=$2",[row.user_id,row.id]);
          row.status='connected';
        }
        for(const account of data.accounts){
          const id=`${row.id}:${account.type}`;
          accounts.push({...account,id,name:`${row.name} · ${account.name}`,connectionId:row.id,
            assets:account.assets.map(a=>({...a,id:`${id}:${a.coin}`,accountId:id})),
            positions:account.positions.map(p=>({...p,id:`${id}:${p.id}`,accountId:id}))});
        }
        if(data.warnings?.length)warnings.push(...data.warnings.map(warning=>`${row.name}: ${String(warning).slice(0,240)}`));
      }catch(error){cache.delete(row.id);row.status='error';warnings.push(`${row.name}: ${String(error?.message||'connection failed').slice(0,240)}`);await pool.query("UPDATE exchange_connections SET status='error' WHERE user_id=$1 AND id=$2",[row.user_id,row.id]);}
    }
    const exchanges=[];
    for(const [id,meta] of Object.entries(require('./exchanges').definitions)){
      const matchingRows=rows.filter(row=>row.exchange===id);if(!matchingRows.length)continue;
      const ids=accounts.filter(item=>item.exchangeId===id).map(item=>item.id);
      exchanges.push({id,name:meta.name,status:matchingRows.some(row=>row.status==='error')?'partial':'connected',accountIds:ids});
    }
    return {version:3,updatedAt:Date.now(),accounts,exchanges,warnings};
  }
  async function summary(){
    const data=await all(), unified=data.accounts.filter(a=>a.type==='unified');
    const sum=key=>unified.length&&unified.every(a=>a.summary[key]!==null)?unified.reduce((n,a)=>n+Number(a.summary[key]),0):null;
    return {exchange:'Bitget',accountType:'Your connected accounts',updatedAt:data.updatedAt,
      summary:{accountEquity:sum('equityUsd'),unrealisedPnl:sum('unrealisedPnl'),positionValue:sum('positionValue')},
      assets:data.accounts.flatMap(a=>a.assets),positions:data.accounts.flatMap(a=>a.positions),warnings:data.warnings};
  }
  function routes(app){
    app.get('/api/connections',auth.requireUser,async(req,res)=>res.json({items:await list()}));
    app.post('/api/connections',auth.requireUser,auth.requireRole('admin'),async(req,res)=>{
      await auth.factor(req);await auth.limit('connection:'+req.user.id,5,300);
      const exchange=String(req.body?.exchange||'bitget').trim().toLowerCase(),meta=definition(exchange);
      if(!meta)throw fail(400,'Choose a supported exchange');
      const name=String(req.body?.name||'').trim();
      const credentials={apiKey:String(req.body?.apiKey||'').trim(),secret:String(req.body?.secret||'').trim(),passphrase:String(req.body?.passphrase||'').trim()};
      if(!name||name.length>80||!credentials.apiKey||!credentials.secret||credentials.apiKey.length>512||credentials.secret.length>512||credentials.passphrase.length>512||(meta.passphrase&&!credentials.passphrase))throw fail(400,`Enter an account name, API key, secret${meta.passphrase?' and passphrase':''}`);
      if(req.body?.readOnlyConfirmed!=='yes')throw fail(400,`Confirm that this ${meta.name} API key is Read-only and cannot trade, transfer or withdraw`);
      try{await createExchangeClient(exchange,credentials).validateReadOnly();}catch(error){
        const message=String(error?.message||`${meta.name} validation failed`).replace(new RegExp(`^${meta.name.replace('.','\\.')} request failed:\\s*`,'i'),'').slice(0,180);
        throw fail(400,`${meta.name} connection failed: ${message}`);
      }
      const id=crypto.randomUUID();
      await auth.tx(async client=>{
        const owner=userId();await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[owner]);
        const n=(await client.query('SELECT COUNT(*) AS count FROM exchange_connections WHERE user_id=$1',[owner])).rows[0].count;
        if(Number(n)>=12)throw fail(400,'This beta supports up to 12 exchange connections per workspace');
        await client.query("INSERT INTO exchange_connections(id,user_id,exchange,name,key_hint,credentials,last_checked) VALUES($1,$2,$3,$4,$5,$6,NOW())",[id,owner,exchange,name,'••••'+credentials.apiKey.slice(-4),seal(credentials,aad(owner,id))]);
      });await auth.audit(req.user.id,`exchange_${exchange}_added`,req);await auth.auditOrganization(req,`exchange_${exchange}_added`,'exchange_connection',id,{name});res.status(201).json({id,name,exchange});
    });
    app.delete('/api/connections/:id',auth.requireUser,auth.requireRole('admin'),async(req,res)=>{
      await auth.factor(req);
      if(!/^[a-f0-9-]{36}$/i.test(req.params.id))throw fail(404,'Connection not found');
      const r=await pool.query('DELETE FROM exchange_connections WHERE user_id=$1 AND id=$2 RETURNING id',[userId(),req.params.id]);
      if(!r.rowCount)throw fail(404,'Connection not found');cache.delete(req.params.id);
      await auth.audit(req.user.id,'exchange_removed',req);await auth.auditOrganization(req,'exchange_removed','exchange_connection',req.params.id);res.json({success:true});
    });
  }
  return {all,summary,routes};
}
module.exports={createAccounts};
