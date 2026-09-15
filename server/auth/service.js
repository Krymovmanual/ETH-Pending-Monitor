const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const c=require('./crypto');
const {forOrganization}=require('../user-db');
const {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse}=require('@simplewebauthn/server');
const fail=(status,message)=>Object.assign(new Error(message),{status});
const publicUser=u=>({id:u.id,email:u.email,twoFactorEnabled:Boolean(u.totp_secret),verified:Boolean(u.verified_at)});
const cookieName=()=>process.env.NODE_ENV==='development'?'toc_session':'__Host-toc_session';
function appOrigin(){const url=new URL(process.env.APP_ORIGIN);if(url.protocol!=='https:'&&!(process.env.NODE_ENV==='development'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('APP_ORIGIN must use HTTPS');return url.origin;}
function cookie(req){return String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName()+'='))?.slice(cookieName().length+1)||'';}
function setCookie(res,value,maxAge=7*86400000){res.cookie(cookieName(),value,{httpOnly:true,secure:process.env.NODE_ENV!=='development',sameSite:'lax',path:'/',maxAge});}
function createAuth(pool,sendMail){
  const audit=(id,event,req)=>pool.query('INSERT INTO security_events(user_id,event,ip) VALUES($1,$2,$3)',[id,event,String(req?.ip||'').slice(0,100)]);
  const roles={viewer:0,operator:1,admin:2,owner:3};
  const auditOrganization=(req,event,targetType=null,targetId=null,metadata={})=>pool.query(
    `INSERT INTO organization_audit_log(organization_id,actor_user_id,event,target_type,target_id,metadata,ip)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [req.organization.id,req.user.id,event,targetType,targetId,JSON.stringify(metadata||{}),String(req.ip||'').slice(0,100)],
  );
  async function tx(work){const client=await pool.connect();try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
  async function initialize(){
    c.encryptionKey();appOrigin();await pool.query(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
    const missing=(await pool.query(`SELECT u.id,u.email FROM users u LEFT JOIN organizations o ON o.owner_user_id=u.id WHERE o.id IS NULL`)).rows;
    for(const user of missing){
      const id=crypto.randomUUID(),local=String(user.email).split('@')[0].replace(/[._-]+/g,' ').trim();
      await tx(async client=>{
        await client.query('INSERT INTO organizations(id,name,owner_user_id) VALUES($1,$2,$3) ON CONFLICT(owner_user_id) DO NOTHING',[id,`${local||'Personal'} Treasury`,user.id]);
        await client.query(`INSERT INTO organization_members(organization_id,user_id,role)
          SELECT id,$1,'owner' FROM organizations WHERE owner_user_id=$1 ON CONFLICT DO NOTHING`,[user.id]);
      });
    }
    await pool.query(`INSERT INTO organization_members(organization_id,user_id,role)
      SELECT id,owner_user_id,'owner' FROM organizations ON CONFLICT DO NOTHING`);
  }
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
    const session=r.rows[0]||null;if(!session)return null;
    let membership=(await pool.query(`SELECT o.id,o.name,o.owner_user_id,m.role FROM organization_members m
      JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=$1 AND o.id=$2`,[session.user_id,session.active_organization_id])).rows[0];
    if(!membership)membership=(await pool.query(`SELECT o.id,o.name,o.owner_user_id,m.role FROM organization_members m
      JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=$1 ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,m.joined_at LIMIT 1`,[session.user_id])).rows[0];
    if(!membership)return null;
    if(session.active_organization_id!==membership.id)await pool.query('UPDATE sessions SET active_organization_id=$2 WHERE id_hash=$1',[session.id_hash,membership.id]);
    session.organization=membership;return session;
  }
  async function requireUser(req,res,next){try{
    const session=await loadSession(req);
    if(!session?.authenticated||!session.verified_at)return res.status(401).json({error:'Sign in required',code:'SESSION_REQUIRED'});
    if(req.headers['x-workspace-user']&&req.headers['x-workspace-user']!==session.user_id)return res.status(409).json({error:'Account changed in another tab',code:'SESSION_CHANGED'});
    if(req.headers['x-workspace-organization']&&req.headers['x-workspace-organization']!==session.organization.id)return res.status(409).json({error:'Workspace changed in another tab',code:'WORKSPACE_CHANGED'});
    if(!['GET','HEAD'].includes(req.method)&&!c.same(req.headers['x-csrf-token']||'',session.csrf))return res.status(403).json({error:'Session verification failed; reload the page'});
    req.user={id:session.user_id,email:session.email,twoFactorEnabled:Boolean(session.totp_secret),canImportLegacy:!session.legacy_imported&&Boolean(process.env.BOOTSTRAP_OWNER_EMAIL)&&session.email===process.env.BOOTSTRAP_OWNER_EMAIL.trim().toLowerCase()};req.session=session;
    req.organization={id:session.organization.id,name:session.organization.name,role:session.organization.role,dataOwnerId:session.organization.owner_user_id};
    await limit('api:'+session.user_id,300,60);
    await pool.query('UPDATE sessions SET last_seen=NOW() WHERE id_hash=$1',[session.id_hash]);
    forOrganization({dataOwnerId:req.organization.dataOwnerId,actorUserId:req.user.id,organizationId:req.organization.id,role:req.organization.role},()=>next());
  }catch(error){next(error);}}
  const requireRole=minimum=>(req,res,next)=>roles[req.organization?.role]>=roles[minimum]?next():res.status(403).json({error:`${minimum[0].toUpperCase()+minimum.slice(1)} access required`,code:'ROLE_REQUIRED'});
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
  const passkeyContext=()=>{const origin=appOrigin(),rpID=new URL(origin).hostname;return{origin,rpID,rpName:'Paseqa Treasury'};};
  async function savePasskeyChallenge(userId,purpose,challenge,req){
    const token=c.token();
    await pool.query(`INSERT INTO passkey_challenges(id_hash,user_id,purpose,challenge,expires_at,ip)
      VALUES($1,$2,$3,$4,NOW()+INTERVAL '5 minutes',$5)`,[c.hash(token),userId||null,purpose,challenge,String(req.ip||'').slice(0,100)]);
    return token;
  }
  async function consumePasskeyChallenge(token,purpose){
    return(await pool.query(`DELETE FROM passkey_challenges WHERE id_hash=$1 AND purpose=$2 AND expires_at>NOW()
      RETURNING user_id,challenge`,[c.hash(token||''),purpose])).rows[0]||null;
  }
  async function freshPasswordFactor(req){
    await limit('passkey-manage:'+req.user.id,10,300);
    await tx(async client=>{
      const user=(await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[req.user.id])).rows[0];
      if(!await c.passwordMatches(req.body?.password,user.password_hash))throw fail(401,'Current password is incorrect');
      if(user.totp_secret)await consumeFactor(client,user,req.body?.code);
    });
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
        const id=crypto.randomUUID(),organizationId=crypto.randomUUID();await client.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[id,email,password]);
        await client.query('INSERT INTO organizations(id,name,owner_user_id) VALUES($1,$2,$3)',[organizationId,`${email.split('@')[0].replace(/[._-]+/g,' ')} Treasury`,id]);
        await client.query("INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,'owner')",[organizationId,id]);
        return {id,email};
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
    router.post('/api/auth/passkeys/login/options',async(req,res)=>{
      const email=String(req.body?.email||'').trim().toLowerCase();
      const user=(await pool.query('SELECT id,verified_at FROM users WHERE email=$1',[email])).rows[0];
      const credentials=user?.verified_at?(await pool.query('SELECT credential_id,transports FROM passkey_credentials WHERE user_id=$1 ORDER BY created_at',[user.id])).rows:[];
      const {rpID}=passkeyContext();
      const options=await generateAuthenticationOptions({rpID,userVerification:'required',timeout:120000,
        allowCredentials:credentials.map(item=>({id:item.credential_id,transports:item.transports||[]}))});
      const flowToken=await savePasskeyChallenge(user?.verified_at?user.id:null,'login',options.challenge,req);
      res.json({options,flowToken});
    });
    router.post('/api/auth/passkeys/login/verify',async(req,res)=>{
      const challenge=await consumePasskeyChallenge(req.body?.flowToken,'login');
      if(!challenge?.user_id)throw fail(401,'Passkey sign-in failed');
      const id=String(req.body?.response?.id||'');
      const credential=(await pool.query('SELECT * FROM passkey_credentials WHERE credential_id=$1 AND user_id=$2',[id,challenge.user_id])).rows[0];
      if(!credential)throw fail(401,'Passkey sign-in failed');
      const {origin,rpID}=passkeyContext();
      let verification;
      try{verification=await verifyAuthenticationResponse({response:req.body.response,expectedChallenge:challenge.challenge,expectedOrigin:origin,expectedRPID:rpID,
        credential:{id:credential.credential_id,publicKey:new Uint8Array(credential.public_key),counter:Number(credential.counter),transports:credential.transports||[]},requireUserVerification:true});}
      catch{throw fail(401,'Passkey sign-in failed');}
      if(!verification.verified)throw fail(401,'Passkey sign-in failed');
      await pool.query('UPDATE passkey_credentials SET counter=$2,last_used_at=NOW() WHERE credential_id=$1',[id,verification.authenticationInfo.newCounter]);
      await pool.query('DELETE FROM sessions WHERE id_hash=$1',[c.hash(cookie(req))]);
      await newSession(req,res,{id:challenge.user_id},true);await audit(challenge.user_id,'passkey_login_success',req);res.json({success:true});
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
    router.get('/api/auth/me',requireUser,async(req,res)=>{
      const organizations=(await pool.query(`SELECT o.id,o.name,m.role FROM organization_members m JOIN organizations o ON o.id=m.organization_id
        WHERE m.user_id=$1 ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,o.name`,[req.user.id])).rows;
      res.json({user:req.user,organization:{id:req.organization.id,name:req.organization.name,role:req.organization.role},organizations,csrf:req.session.csrf});
    });
    router.post('/api/auth/logout',requireUser,async(req,res)=>{
      await pool.query('DELETE FROM sessions WHERE id_hash=$1',[req.session.id_hash]);await audit(req.user.id,'logout',req);setCookie(res,'',0);res.json({success:true});
    });
    router.get('/api/auth/security',requireUser,async(req,res)=>{
      const sessions=(await pool.query('SELECT id_hash,created_at,last_seen,ip,user_agent FROM sessions WHERE user_id=$1 AND authenticated=TRUE AND expires_at>NOW()',[req.user.id])).rows.map(s=>({...s,current:s.id_hash===req.session.id_hash}));
      const events=(await pool.query('SELECT event,ip,created_at FROM security_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',[req.user.id])).rows;
      const passkeys=(await pool.query('SELECT credential_id,name,device_type,backed_up,created_at,last_used_at FROM passkey_credentials WHERE user_id=$1 ORDER BY created_at',[req.user.id])).rows;
      res.json({sessions,events,passkeys,twoFactorEnabled:req.user.twoFactorEnabled});
    });
    router.post('/api/auth/passkeys/register/options',requireUser,async(req,res)=>{
      await freshPasswordFactor(req);
      const existing=(await pool.query('SELECT credential_id,transports FROM passkey_credentials WHERE user_id=$1',[req.user.id])).rows;
      const {rpID,rpName}=passkeyContext();
      const options=await generateRegistrationOptions({rpName,rpID,userName:req.user.email,userDisplayName:req.user.email,
        userID:Buffer.from(req.user.id),attestationType:'none',timeout:120000,
        authenticatorSelection:{residentKey:'preferred',userVerification:'required'},
        excludeCredentials:existing.map(item=>({id:item.credential_id,transports:item.transports||[]}))});
      const flowToken=await savePasskeyChallenge(req.user.id,'register',options.challenge,req);
      res.json({options,flowToken});
    });
    router.post('/api/auth/passkeys/register/verify',requireUser,async(req,res)=>{
      const challenge=await consumePasskeyChallenge(req.body?.flowToken,'register');
      if(!challenge||challenge.user_id!==req.user.id)throw fail(401,'Passkey registration expired. Start again.');
      const {origin,rpID}=passkeyContext();
      let verification;
      try{verification=await verifyRegistrationResponse({response:req.body.response,expectedChallenge:challenge.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true});}
      catch{throw fail(400,'This passkey could not be verified');}
      if(!verification.verified)throw fail(400,'This passkey could not be verified');
      const info=verification.registrationInfo,credential=info.credential;
      const name=String(req.body?.name||'Passkey').trim().slice(0,80)||'Passkey';
      await pool.query(`INSERT INTO passkey_credentials(credential_id,user_id,public_key,counter,transports,device_type,backed_up,name)
        VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,[credential.id,req.user.id,Buffer.from(credential.publicKey),credential.counter,
        JSON.stringify(req.body?.response?.response?.transports||[]),info.credentialDeviceType,info.credentialBackedUp,name]);
      await audit(req.user.id,'passkey_added',req);res.status(201).json({success:true});
    });
    router.delete('/api/auth/passkeys/:id',requireUser,async(req,res)=>{
      await freshPasswordFactor(req);
      const result=await pool.query('DELETE FROM passkey_credentials WHERE credential_id=$1 AND user_id=$2 RETURNING credential_id',[req.params.id,req.user.id]);
      if(!result.rowCount)throw fail(404,'Passkey not found');
      await audit(req.user.id,'passkey_removed',req);res.json({success:true});
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
    router.post('/api/organizations/switch',requireUser,async(req,res)=>{
      const id=String(req.body?.organizationId||'');
      const membership=(await pool.query('SELECT role FROM organization_members WHERE organization_id=$1 AND user_id=$2',[id,req.user.id])).rows[0];
      if(!membership)throw fail(404,'Workspace not found');
      await pool.query('UPDATE sessions SET active_organization_id=$2 WHERE id_hash=$1',[req.session.id_hash,id]);
      res.json({success:true});
    });
    router.get('/api/organizations/current',requireUser,async(req,res)=>{
      const members=(await pool.query(`SELECT u.id,u.email,m.role,m.joined_at FROM organization_members m JOIN users u ON u.id=m.user_id
        WHERE m.organization_id=$1 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'operator' THEN 2 ELSE 3 END,u.email`,[req.organization.id])).rows;
      const invitations=roles[req.organization.role]>=roles.admin?(await pool.query(`SELECT id,email,role,expires_at,created_at FROM organization_invitations
        WHERE organization_id=$1 AND accepted_at IS NULL AND expires_at>NOW() ORDER BY created_at DESC`,[req.organization.id])).rows:[];
      res.json({organization:{id:req.organization.id,name:req.organization.name,role:req.organization.role},members,invitations});
    });
    router.patch('/api/organizations/current',requireUser,requireRole('admin'),async(req,res)=>{
      const name=String(req.body?.name||'').trim();if(name.length<2||name.length>80)throw fail(400,'Use a workspace name with 2–80 characters');
      await pool.query('UPDATE organizations SET name=$2,updated_at=NOW() WHERE id=$1',[req.organization.id,name]);
      await auditOrganization(req,'workspace_renamed','organization',req.organization.id,{name});res.json({success:true,name});
    });
    router.post('/api/organizations/invitations',requireUser,requireRole('admin'),async(req,res)=>{
      const email=String(req.body?.email||'').trim().toLowerCase(),role=String(req.body?.role||'viewer');
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw fail(400,'Enter a valid email');
      if(!['admin','operator','viewer'].includes(role)||(role==='admin'&&req.organization.role!=='owner'))throw fail(400,'Choose an allowed role');
      if((await pool.query(`SELECT 1 FROM organization_members m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 AND u.email=$2`,[req.organization.id,email])).rowCount)throw fail(409,'This person already belongs to the workspace');
      const raw=c.token(),id=crypto.randomUUID();
      await tx(async client=>{
        await client.query('DELETE FROM organization_invitations WHERE organization_id=$1 AND email=$2 AND accepted_at IS NULL',[req.organization.id,email]);
        await client.query(`INSERT INTO organization_invitations(id,organization_id,email,role,token_hash,created_by,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,NOW()+INTERVAL '7 days')`,[id,req.organization.id,email,role,c.hash(raw),req.user.id]);
      });
      try{await sendMail(email,`Invitation to ${req.organization.name}`,{workspace:req.organization.name,role,link:`${appOrigin()}/security.html#invite=${raw}`,expires:'7 days'});}
      catch(error){await pool.query('DELETE FROM organization_invitations WHERE id=$1',[id]);throw fail(503,'Invitation email unavailable. Try again later.');}
      await auditOrganization(req,'member_invited','invitation',id,{email,role});res.status(201).json({id,email,role});
    });
    router.post('/api/organizations/invitations/accept',requireUser,async(req,res)=>{
      const tokenHash=c.hash(req.body?.token||'');
      const invitation=(await pool.query(`SELECT i.*,o.name FROM organization_invitations i JOIN organizations o ON o.id=i.organization_id
        WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.expires_at>NOW()`,[tokenHash])).rows[0];
      if(!invitation)throw fail(400,'Invitation expired or already used');
      if(invitation.email!==req.user.email)throw fail(403,'Sign in with the email address that received this invitation');
      await tx(async client=>{
        await client.query('INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[invitation.organization_id,req.user.id,invitation.role]);
        await client.query('UPDATE organization_invitations SET accepted_at=NOW() WHERE id=$1',[invitation.id]);
        await client.query('UPDATE sessions SET active_organization_id=$2 WHERE id_hash=$1',[req.session.id_hash,invitation.organization_id]);
        await client.query(`INSERT INTO organization_audit_log(organization_id,actor_user_id,event,target_type,target_id,metadata,ip)
          VALUES($1,$2,'invitation_accepted','user',$3,$4::jsonb,$5)`,[invitation.organization_id,req.user.id,req.user.id,JSON.stringify({role:invitation.role}),String(req.ip||'').slice(0,100)]);
      });res.json({success:true,organization:{id:invitation.organization_id,name:invitation.name,role:invitation.role}});
    });
    router.patch('/api/organizations/members/:id',requireUser,requireRole('owner'),async(req,res)=>{
      const role=String(req.body?.role||'');if(!['admin','operator','viewer'].includes(role))throw fail(400,'Choose admin, operator or viewer');
      const r=await pool.query(`UPDATE organization_members SET role=$3 WHERE organization_id=$1 AND user_id=$2 AND role<>'owner' RETURNING user_id`,[req.organization.id,req.params.id,role]);
      if(!r.rowCount)throw fail(404,'Member not found');await auditOrganization(req,'member_role_changed','user',req.params.id,{role});res.json({success:true});
    });
    router.delete('/api/organizations/members/:id',requireUser,requireRole('owner'),async(req,res)=>{
      const r=await pool.query(`DELETE FROM organization_members WHERE organization_id=$1 AND user_id=$2 AND role<>'owner' RETURNING user_id`,[req.organization.id,req.params.id]);
      if(!r.rowCount)throw fail(404,'Member not found');await auditOrganization(req,'member_removed','user',req.params.id);res.json({success:true});
    });
    router.get('/api/organizations/audit',requireUser,requireRole('admin'),async(req,res)=>{
      const rows=(await pool.query(`SELECT a.id,a.event,a.target_type,a.target_id,a.metadata,a.ip,a.created_at,u.email AS actor_email
        FROM organization_audit_log a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.organization_id=$1 ORDER BY a.created_at DESC LIMIT 100`,[req.organization.id])).rows;
      res.json({items:rows});
    });
  }
  return {initialize,routes,origin,requireUser,requireRole,factor,audit,auditOrganization,limit,tx,consumeFactor,loadSession};
}
module.exports={createAuth,appOrigin,fail,publicUser};
