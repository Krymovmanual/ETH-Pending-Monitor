const crypto=require('node:crypto');
const {createBitgetClient}=require('./bitget');
const {seal,unseal}=require('./auth/crypto');
const {userId}=require('./user-db');
const {fail}=require('./auth/service');
function createAccounts(pool,auth){
  const cache=new Map();
  const aad=(owner,id)=>`exchange:${owner}:${id}`;
  async function list(){return(await pool.query('SELECT id,name,exchange,key_hint,status,last_checked,created_at FROM exchange_connections WHERE user_id=$1 ORDER BY created_at',[userId()])).rows;}
  async function all(){
    const rows=(await pool.query('SELECT * FROM exchange_connections WHERE user_id=$1 ORDER BY created_at',[userId()])).rows;
    const accounts=[],warnings=[];
    for(const row of rows){
      try {
        let data=cache.get(row.id);
        if(!data||Date.now()-data.updatedAt>20000){
          const credentials=unseal(row.credentials,aad(row.user_id,row.id));
          data=await createBitgetClient(credentials).fetchBitgetAccounts();cache.set(row.id,data);
          await pool.query("UPDATE exchange_connections SET last_checked=NOW(),status='connected' WHERE user_id=$1 AND id=$2",[row.user_id,row.id]);
        }
        for(const account of data.accounts){
          const id=`${row.id}:${account.type}`;
          accounts.push({...account,id,name:`${row.name} · ${account.name}`,connectionId:row.id,
            assets:account.assets.map(a=>({...a,id:`${id}:${a.coin}`,accountId:id})),
            positions:account.positions.map(p=>({...p,id:`${id}:${p.id}`,accountId:id}))});
        }
        if(data.warnings?.length)warnings.push(`${row.name}: some balances or positions are unavailable`);
      }catch(_){cache.delete(row.id);warnings.push(`${row.name}: connection failed. Check its key and permissions.`);await pool.query("UPDATE exchange_connections SET status='error' WHERE user_id=$1 AND id=$2",[row.user_id,row.id]);}
    }
    return {version:2,updatedAt:Date.now(),accounts,exchanges:rows.length?[{id:'bitget',name:'Bitget',status:warnings.length?'partial':'connected',accountIds:accounts.map(a=>a.id)}]:[],warnings};
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
    app.post('/api/connections',auth.requireUser,async(req,res)=>{
      await auth.factor(req);await auth.limit('connection:'+req.user.id,5,300);
      const name=String(req.body?.name||'').trim();
      const credentials={apiKey:String(req.body?.apiKey||'').trim(),secret:String(req.body?.secret||'').trim(),passphrase:String(req.body?.passphrase||'').trim()};
      if(!name||name.length>80||Object.values(credentials).some(v=>!v||v.length>512))throw fail(400,'Enter an account name, API key, secret and passphrase');
      if(req.body?.readOnlyConfirmed!=='yes')throw fail(400,'Confirm that this Bitget API key is Read-only with Unified account > Manage only');
      try{await createBitgetClient(credentials).validateReadOnly();}catch(error){
        const message=String(error?.message||'Bitget validation failed').replace(/^Bitget request failed:\s*/,'').slice(0,180);
        throw fail(400,`Bitget connection failed: ${message}`);
      }
      const id=crypto.randomUUID();
      await auth.tx(async client=>{
        await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[req.user.id]);
        const n=(await client.query('SELECT COUNT(*) AS count FROM exchange_connections WHERE user_id=$1',[req.user.id])).rows[0].count;
        if(Number(n)>=3)throw fail(400,'This beta supports up to 3 exchange connections per user');
        await client.query("INSERT INTO exchange_connections(id,user_id,exchange,name,key_hint,credentials,last_checked) VALUES($1,$2,'bitget',$3,$4,$5,NOW())",[id,req.user.id,name,'••••'+credentials.apiKey.slice(-4),seal(credentials,aad(req.user.id,id))]);
      });await auth.audit(req.user.id,'exchange_added',req);res.status(201).json({id,name});
    });
    app.delete('/api/connections/:id',auth.requireUser,async(req,res)=>{
      await auth.factor(req);
      if(!/^[a-f0-9-]{36}$/i.test(req.params.id))throw fail(404,'Connection not found');
      const r=await pool.query('DELETE FROM exchange_connections WHERE user_id=$1 AND id=$2 RETURNING id',[req.user.id,req.params.id]);
      if(!r.rowCount)throw fail(404,'Connection not found');cache.delete(req.params.id);
      await auth.audit(req.user.id,'exchange_removed',req);res.json({success:true});
    });
  }
  return {all,summary,routes};
}
module.exports={createAccounts};
