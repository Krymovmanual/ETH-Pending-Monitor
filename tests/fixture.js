const {PGlite}=require('@electric-sql/pglite');
const crypto=require('node:crypto');
async function fixture(){
  process.env.NODE_ENV='development';process.env.APP_ORIGIN='http://127.0.0.1';
  process.env.CREDENTIAL_ENCRYPTION_KEY=crypto.randomBytes(32).toString('base64');
  process.env.REGISTRATION_OPEN='true';process.env.DISABLE_MONITORS='true';process.env.RESEND_API_KEY='fixture';
  const postgres=new PGlite();await postgres.waitReady;
  const db=require('../server/db');
  const query=async(sql,params)=>{
    const result=params?.length?await postgres.query(sql,params):/;\s*\S/.test(sql)?(await postgres.exec(sql)).at(-1):await postgres.query(sql);
    return {...result,rowCount:result.affectedRows??result.rows?.length??0};
  };
  db.pool.query=query;db.pool.connect=async()=>({query,release(){}});
  db.pool.end=()=>postgres.close();
  const nativeFetch=global.fetch;const mails=[];
  let unsafeKey=false;
  global.fetch=async(url,opts)=>{
    const value=String(url);
    if(value.startsWith('https://api.resend.com/')){mails.push(JSON.parse(opts.body));return new Response('{}',{status:200});}
    if(value.startsWith('https://api.bitget.com')){
      const data=value.includes('/info')?{authorities:unsafeKey?['trade']:['readonly']}:value.includes('/assets')?{accountEquity:'100',assets:[]}:value.includes('funding')?[]:{list:[]};
      return Response.json({code:'00000',data});
    }
    if(value.startsWith('https:'))throw Error('External requests disabled in tests');
    return nativeFetch(url,opts);
  };
  await db.initializeDatabase();
  const {app,auth}=require('../server/index');await auth.initialize();
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
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
  return {origin,db,auth,postgres,client,register,mailToken,mails,unsafe(value){unsafeKey=value;},async close(){await new Promise(resolve=>server.close(resolve));global.fetch=nativeFetch;await postgres.close();}};
}
module.exports={fixture};
