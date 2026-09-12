const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const c=require('./crypto');
const {forUser}=require('../user-db');
const fail=(status,message)=>Object.assign(new Error(message),{status});
const publicUser=u=>({id:u.id,email:u.email,twoFactorEnabled:Boolean(u.totp_secret),verified:Boolean(u.verified_at)});
const cookieName=()=>process.env.NODE_ENV==='development'?'toc_session':'__Host-toc_session';
function appOrigin(){const url=new URL(process.env.APP_ORIGIN);if(url.protocol!=='https:'&&!(process.env.NODE_ENV==='development'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('APP_ORIGIN must use HTTPS');return url.origin;}
function cookie(req){return String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName()+'='))?.slice(cookieName().length+1)||'';}
function setCookie(res,value,maxAge=7*86400000){res.cookie(cookieName(),value,{httpOnly:true,secure:process.env.NODE_ENV!=='development',sameSite:'lax',path:'/',maxAge});}
function createAuth(pool,sendMail){
  const audit=(id,event,req)=>pool.query('INSERT INTO security_events(user_id,event,ip) VALUES($1,$2,$3)',[id,event,String(req?.ip||'').slice(0,100)]);
  async function tx(work){const client=await pool.connect();try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
  async function initialize(){c.encryptionKey();appOrigin();await pool.query(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));}
  async function limit(key,max,seconds=900,weight=1){
    const r=await pool.query(`INSERT INTO request_limits(key,count,reset_at) VALUES($1,$3,NOW()+$2*INTERVAL '1 second')
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN request_limits.reset_at<NOW() THEN EXCLUDED.count ELSE request_limits.count+EXCLUDED.count END,
      reset_at=CASE WHEN request_limits.reset_at<NOW() THEN EXCLUDED.reset_at ELSE request_limits.reset_at END RETURNING count`,[c.hash(key),seconds,weight]);
    if(r.rows[0].count>max)throw fail(429,'Too many attempts. Try again later.');
  }
  function origin(req,res,next){
    res.set('Cache-Control','no-store');
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin!==appOrigin())return res.status(403).json({error:'Request origin is not allowed'});
    next();
  }
  async function loadSession(req){
    const value=cookie(req);if(!/^[A-Za-z0-9_-]{43}$/.test(value))return null;
    const r=await pool.query(`SELECT s.*,u.email,u.verified_at,u.totp_secret,u.legacy_imported FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.id_hash=$1 AND s.expires_at>NOW() AND s.last_seen>NOW()-INTERVAL '24 hours'`,[c.hash(value)]);
    return r.rows[0]||null;
  }
  async function requireUser(req,res,next){try{
    const session=await loadSession(req);
    if(!session?.authenticated||!session.verified_at)return res.status(401).json({error:'Sign in required',code:'SESSION_REQUIRED'});
    if(req.headers['x-workspace-user']&&req.headers['x-workspace-user']!==session.user_id)return res.status(409).json({error:'Account changed in another tab',code:'SESSION_CHANGED'});
    if(!['GET','HEAD'].includes(req.method)&&!c.same(req.headers['x-csrf-token']||'',session.csrf))return res.status(403).json({error:'Session verification failed; reload the page'});
    req.user={id:session.user_id,email:session.email,twoFactorEnabled:Boolean(session.totp_secret),canImportLegacy:!session.legacy_imported&&Boolean(process.env.BOOTSTRAP_OWNER_EMAIL)&&session.email===process.env.BOOTSTRAP_OWNER_EMAIL.trim().toLowerCase()};req.session=session;
    await limit('api:'+session.user_id,300,60);
    await pool.query('UPDATE sessions SET last_seen=NOW() WHERE id_hash=$1',[session.id_hash]);
    forUser(session.user_id,()=>next());
  }catch(error){next(error);}}
  async function newSession(req,res,user,authenticated){
    const raw=c.token(),csrf=c.token();
    await pool.query(`INSERT INTO sessions(id_hash,user_id,csrf,authenticated,expires_at,ip,user_agent)
      VALUES($1,$2,$3,$4,NOW()+$5*INTERVAL '1 second',$6,$7)`,[c.hash(raw),user.id,csrf,authenticated,authenticated?7*86400:300,String(req.ip||'').slice(0,100),String(req.headers['user-agent']||'').slice(0,200)]);
    await pool.query(`DELETE FROM sessions WHERE user_id=$1 AND id_hash IN (SELECT id_hash FROM sessions WHERE user_id=$1 ORDER BY created_at DESC OFFSET 10)`,[user.id]);
    setCookie(res,raw,authenticated?7*86400000:300000);return csrf;
  }
  async function consumeFactor(client,user,code){
    if(!user.totp_secret)throw fail(403,'Enable two-factor authentication first');
    const step=c.verifyTotp(c.unseal(user.totp_secret,`totp:${user.id}`),String(code||''),user.totp_last_step);
    if(step!==null){await client.query('UPDATE users SET totp_last_step=$2 WHERE id=$1',[user.id,step]);return;}
    if(!/^[a-f0-9]{24}$/.test(String(code||'').replace(/-/g,'')))throw fail(401,'Invalid or already used verification code');
    const r=await client.query('DELETE FROM recovery_codes WHERE user_id=$1 AND code_hash=$2 RETURNING code_hash',[user.id,c.hash(String(code).replace(/-/g,''))]);
    if(!r.rowCount)throw fail(401,'Invalid or already used verification code');
  }
  async function factor(req){
    await limit('factor:'+req.user.id,10,300);
    await tx(async client=>{const r=await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[req.user.id]);await consumeFactor(client,r.rows[0],req.body?.code);});
  }
  async function emailToken(user,purpose){
    const raw=c.token();
    await pool.query('INSERT INTO email_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL \'1 hour\')',[c.hash(raw),user.id,purpose]);
    try {await sendMail(user.email,purpose==='verify'?'Confirm your email':'Reset your password',{link:`${appOrigin()}/auth.html#${purpose}=${raw}`,expires:'1 hour'});}
    catch(error){await pool.query('DELETE FROM email_tokens WHERE token_hash=$1',[c.hash(raw)]);throw fail(503,'Email delivery unavailable. Try again later.');}
  }
  function routes(router){
    // Persistent IP and account limits survive server restarts and multiple replicas.
    router.use('/api/auth',async(req,res,next)=>{try{if(req.method==='POST'){await limit('auth-ip:'+req.ip,30,900);if(req.body?.email)await limit('auth-email:'+String(req.body.email).trim().toLowerCase(),10,900);}next();}catch(e){next(e);}});
    router.post('/api/auth/register',async(req,res)=>{
      const email=String(req.body?.email||'').trim().toLowerCase();
      if(process.env.REGISTRATION_OPEN!=='true'&&email!==String(process.env.BOOTSTRAP_OWNER_EMAIL||'').trim().toLowerCase())throw fail(403,'Registration is closed');
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw fail(400,'Enter a valid email');
      const password=await c.passwordHash(req.body.password);
      const user=await tx(async client=>{
        await client.query('SELECT pg_advisory_xact_lock(781126)');
        const existing=(await client.query('SELECT id FROM users WHERE email=$1',[email])).rows[0];if(existing)return null;
        const count=(await client.query('SELECT COUNT(*) AS count FROM users')).rows[0].count;
        if(Number(count)>=Number(process.env.MAX_USERS||25))throw fail(503,'Registration capacity reached');
        const id=crypto.randomUUID();await client.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[id,email,password]);return {id,email};
      });
      if(user){await emailToken(user,'verify');await audit(user.id,'registered',req);}
      res.json({message:'If registration is available for this email, a confirmation link has been sent. You can also request another verification email.'});
    });
    router.post('/api/auth/resend',async(req,res)=>{
      const user=(await pool.query('SELECT * FROM users WHERE email=$1',[String(req.body?.email||'').trim().toLowerCase()])).rows[0];
      if(user&&!user.verified_at)await emailToken(user,'verify');
      res.json({message:'If this account needs verification, a link has been sent.'});
    });
    router.post('/api/auth/verify',async(req,res)=>{
      await tx(async client=>{
        const row=(await client.query("DELETE FROM email_tokens WHERE token_hash=$1 AND purpose='verify' AND expires_at>NOW() RETURNING user_id",[c.hash(req.body?.token)])).rows[0];
        if(!row)throw fail(400,'Link expired or already used. Request a new one.');
        await client.query('UPDATE users SET verified_at=COALESCE(verified_at,NOW()) WHERE id=$1',[row.user_id]);
      });res.json({message:'Email confirmed. You can sign in.'});
    });
    router.post('/api/auth/login',async(req,res)=>{
      const user=(await pool.query('SELECT * FROM users WHERE email=$1',[String(req.body?.email||'').trim().toLowerCase()])).rows[0];
      if(!await c.passwordMatches(req.body?.password,user?.password_hash)){await audit(user?.id||null,'login_failed',req);throw fail(401,'Email or password is incorrect');}
      if(!user.verified_at)throw fail(403,'Confirm your email before signing in');
      await pool.query('DELETE FROM sessions WHERE id_hash=$1',[c.hash(cookie(req))]);
      await newSession(req,res,user,!user.totp_secret);await audit(user.id,user.totp_secret?'password_verified':'login_success',req);
      res.json({twoFactorRequired:Boolean(user.totp_secret)});
    });
    router.post('/api/auth/mfa/login',async(req,res)=>{
      const session=await loadSession(req);if(!session||session.authenticated)throw fail(401,'Sign in again');
      await limit('factor:'+session.user_id,10,300);
      await tx(async client=>{
        const locked=(await client.query('SELECT * FROM sessions WHERE id_hash=$1 FOR UPDATE',[session.id_hash])).rows[0];
        if(!locked||locked.authenticated)throw fail(401,'Sign in again');
        const user=(await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[session.user_id])).rows[0];
        await consumeFactor(client,user,req.body?.code);
        await client.query('DELETE FROM sessions WHERE id_hash=$1',[session.id_hash]);
      });
      await newSession(req,res,{id:session.user_id},true);await audit(session.user_id,'login_2fa_success',req);res.json({success:true});
    });
    router.post('/api/auth/forgot',async(req,res)=>{
      const user=(await pool.query('SELECT * FROM users WHERE email=$1',[String(req.body?.email||'').trim().toLowerCase()])).rows[0];
      if(user?.verified_at)await emailToken(user,'reset');res.json({message:'If the account exists, a reset link has been sent.'});
    });
    router.post('/api/auth/reset',async(req,res)=>{
      await limit('reset:'+c.hash(req.body?.token),10,300);
      const password=await c.passwordHash(req.body?.password);
      await tx(async client=>{
        const row=(await client.query("SELECT * FROM email_tokens WHERE token_hash=$1 AND purpose='reset' AND expires_at>NOW() FOR UPDATE",[c.hash(req.body?.token)])).rows[0];
        if(!row)throw fail(400,'Reset link expired or already used');
        const user=(await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[row.user_id])).rows[0];
        if(user.totp_secret)await consumeFactor(client,user,req.body?.code);
        await client.query('UPDATE users SET password_hash=$2 WHERE id=$1',[row.user_id,password]);
        await client.query('DELETE FROM sessions WHERE user_id=$1',[row.user_id]);
        await client.query('DELETE FROM email_tokens WHERE user_id=$1',[row.user_id]);
        await client.query("INSERT INTO security_events(user_id,event) VALUES($1,'password_reset')",[row.user_id]);
      });setCookie(res,'',0);res.json({message:'Password updated. Sign in again.'});
    });
    router.get('/api/auth/me',requireUser,(req,res)=>res.json({user:req.user,csrf:req.session.csrf}));
    router.post('/api/auth/logout',requireUser,async(req,res)=>{
      await pool.query('DELETE FROM sessions WHERE id_hash=$1',[req.session.id_hash]);await audit(req.user.id,'logout',req);setCookie(res,'',0);res.json({success:true});
    });
    router.get('/api/auth/security',requireUser,async(req,res)=>{
      const sessions=(await pool.query('SELECT id_hash,created_at,last_seen,ip,user_agent FROM sessions WHERE user_id=$1 AND authenticated=TRUE AND expires_at>NOW()',[req.user.id])).rows.map(s=>({...s,current:s.id_hash===req.session.id_hash}));
      const events=(await pool.query('SELECT event,ip,created_at FROM security_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',[req.user.id])).rows;
      res.json({sessions,events,twoFactorEnabled:req.user.twoFactorEnabled});
    });
    router.delete('/api/auth/sessions/:id',requireUser,async(req,res)=>{
      await pool.query('DELETE FROM sessions WHERE user_id=$1 AND id_hash=$2',[req.user.id,req.params.id]);await audit(req.user.id,'session_revoked',req);res.json({success:true});
    });
    router.post('/api/auth/password',requireUser,async(req,res)=>{
      const password=await c.passwordHash(req.body?.newPassword);
      await tx(async client=>{
        const user=(await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[req.user.id])).rows[0];
        if(!await c.passwordMatches(req.body?.password,user.password_hash))throw fail(401,'Current password is incorrect');
        if(user.totp_secret)await consumeFactor(client,user,req.body?.code);
        await client.query('UPDATE users SET password_hash=$2 WHERE id=$1',[req.user.id,password]);
        await client.query('DELETE FROM sessions WHERE user_id=$1',[req.user.id]);
        await client.query('DELETE FROM email_tokens WHERE user_id=$1',[req.user.id]);
      });await audit(req.user.id,'password_changed',req);setCookie(res,'',0);res.json({success:true});
    });
    router.post('/api/auth/mfa/setup',requireUser,async(req,res)=>{
      const secret=c.base32(crypto.randomBytes(20));
      await tx(async client=>{
        const user=(await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[req.user.id])).rows[0];
        if(user.totp_secret)throw fail(409,'Two-factor authentication is already enabled');
        if(!await c.passwordMatches(req.body?.password,user.password_hash))throw fail(401,'Current password is incorrect');
        await client.query('UPDATE users SET totp_pending=$2,totp_pending_at=NOW() WHERE id=$1',[user.id,c.seal(secret,`totp:${user.id}`)]);
      });res.json({secret,uri:`otpauth://totp/Treasury:${encodeURIComponent(req.user.email)}?secret=${secret}&issuer=Treasury&algorithm=SHA1&digits=6&period=30`});
    });
    router.post('/api/auth/mfa/enable',requireUser,async(req,res)=>{
      await limit('factor:'+req.user.id,10,300);
      const codes=Array.from({length:10},()=>crypto.randomBytes(12).toString('hex'));
      await tx(async client=>{
        const user=(await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[req.user.id])).rows[0];
        if(user.totp_secret||!user.totp_pending||Date.now()-new Date(user.totp_pending_at)>600000)throw fail(400,'Start 2FA setup again');
        const step=c.verifyTotp(c.unseal(user.totp_pending,`totp:${user.id}`),req.body?.code);
        if(step===null)throw fail(401,'Incorrect code');
        await client.query('UPDATE users SET totp_secret=totp_pending,totp_pending=NULL,totp_pending_at=NULL,totp_last_step=$2 WHERE id=$1',[user.id,step]);
        for(const code of codes)await client.query('INSERT INTO recovery_codes(user_id,code_hash) VALUES($1,$2)',[user.id,c.hash(code)]);
        await client.query('DELETE FROM sessions WHERE user_id=$1 AND id_hash<>$2',[user.id,req.session.id_hash]);
      });await audit(req.user.id,'2fa_enabled',req);res.json({recoveryCodes:codes});
    });
    router.post('/api/auth/mfa/disable',requireUser,async(req,res)=>{
      await limit('factor:'+req.user.id,10,300);
      await tx(async client=>{
        const user=(await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[req.user.id])).rows[0];
        if(!await c.passwordMatches(req.body?.password,user.password_hash))throw fail(401,'Current password is incorrect');
        await consumeFactor(client,user,req.body?.code);
        await client.query('UPDATE users SET totp_secret=NULL,totp_pending=NULL,totp_last_step=-1 WHERE id=$1',[user.id]);
        await client.query('DELETE FROM recovery_codes WHERE user_id=$1',[user.id]);
        await client.query('DELETE FROM sessions WHERE user_id=$1',[user.id]);
      });await audit(req.user.id,'2fa_disabled',req);setCookie(res,'',0);res.json({success:true});
    });
  }
  return {initialize,routes,origin,requireUser,factor,audit,limit,tx,consumeFactor,loadSession};
}
module.exports={createAuth,appOrigin,fail,publicUser};
