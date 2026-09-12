const {AsyncLocalStorage}=require('node:async_hooks');
const context=new AsyncLocalStorage();
function userId(){const id=context.getStore();if(!id)throw new Error('User context is required');return id;}
function forUser(id,work){if(!id)throw new Error('User context is required');return context.run(id,work);}
function scopedDatabase(pool,defaults){
  const q=(sql,values=[])=>pool.query(sql,[userId(),...values]);
  return {
    async getSettings(){const r=await q('SELECT settings FROM user_settings WHERE user_id=$1');return {...structuredClone(defaults),...r.rows[0]?.settings};},
    async saveSettings(settings){await q(`INSERT INTO user_settings(user_id,settings) VALUES($1,$2::jsonb)
      ON CONFLICT(user_id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=NOW()`,[JSON.stringify(settings)]);return settings;},
    async upsertTransaction(tx){const r=await q(`INSERT INTO user_transactions(user_id,hash,from_address,to_address,nonce,tx_data)
      VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(user_id,hash) DO UPDATE SET last_seen=NOW(),missing_checks=0,
      tx_data=user_transactions.tx_data || EXCLUDED.tx_data RETURNING *, (xmax=0) AS inserted`,[tx.hash,tx.from,tx.to,tx.nonce,JSON.stringify(tx)]);return r.rows[0];},
    async upsertConfirmedTransaction(tx,status='confirmed',firstSeen=null){const r=await q(`INSERT INTO user_transactions(user_id,hash,from_address,to_address,nonce,status,first_seen,tx_data)
      VALUES($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz,NOW()),$8::jsonb)
      ON CONFLICT(user_id,hash) DO UPDATE SET status=EXCLUDED.status,last_seen=NOW(),missing_checks=0,
      tx_data=user_transactions.tx_data || EXCLUDED.tx_data RETURNING *`,[tx.hash,tx.from,tx.to,tx.nonce,status==='failed'?'failed':'confirmed',firstSeen,JSON.stringify(tx)]);return r.rows[0];},
    async getMonitorState(key){const r=await q('SELECT value FROM user_monitor_state WHERE user_id=$1 AND key=$2',[key]);return r.rows[0]?.value??null;},
    async saveMonitorState(key,value){await q(`INSERT INTO user_monitor_state(user_id,key,value) VALUES($1,$2,$3::jsonb)
      ON CONFLICT(user_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,[key,JSON.stringify(value)]);},
    async pendingTransactions(){return (await q("SELECT * FROM user_transactions WHERE user_id=$1 AND status='pending' ORDER BY from_address,nonce,first_seen")).rows;},
    async recentTransactions(limit=250){return (await q('SELECT * FROM user_transactions WHERE user_id=$1 ORDER BY first_seen DESC LIMIT $2',[Math.min(1000,Math.max(1,Number(limit)||250))])).rows;},
    async clearTransactions(){return (await q('DELETE FROM user_transactions WHERE user_id=$1')).rowCount;},
    async markStatus(hash,status,replacementHash=null){await q('UPDATE user_transactions SET status=$3,replacement_hash=COALESCE($4,replacement_hash),last_seen=NOW() WHERE user_id=$1 AND hash=$2',[hash,status,replacementHash]);},
    async incrementMissing(hash){const r=await q('UPDATE user_transactions SET missing_checks=missing_checks+1 WHERE user_id=$1 AND hash=$2 RETURNING missing_checks',[hash]);return Number(r.rows[0]?.missing_checks||0);},
    async findSameNonce(from,nonce,exceptHash){return(await q("SELECT * FROM user_transactions WHERE user_id=$1 AND from_address=$2 AND nonce=$3 AND hash<>$4 AND status='pending'",[from,nonce,exceptHash])).rows;},
    async alertIsDue(kind,key,repeat){const r=await q('SELECT last_sent FROM user_alert_log WHERE user_id=$1 AND kind=$2 AND scope_key=$3',[kind,key]);return !r.rows.length || Boolean(Number(repeat)&&Date.now()-new Date(r.rows[0].last_sent).getTime()>=Number(repeat)*60000);},
    async recordAlert(kind,key){await q('INSERT INTO user_alert_log(user_id,kind,scope_key) VALUES($1,$2,$3) ON CONFLICT(user_id,kind,scope_key) DO UPDATE SET last_sent=NOW()',[kind,key]);},
    async savePushSubscription(subscription,sessionHash){await q(`INSERT INTO user_push_subscriptions(user_id,endpoint,subscription,session_hash) VALUES($1,$2,$3::jsonb,$4)
      ON CONFLICT(endpoint) DO UPDATE SET user_id=EXCLUDED.user_id,subscription=EXCLUDED.subscription,session_hash=EXCLUDED.session_hash`,[subscription.endpoint,JSON.stringify(subscription),sessionHash]);},
    async allPushSubscriptions(){return(await q(`SELECT p.endpoint,p.subscription FROM user_push_subscriptions p JOIN sessions s ON s.id_hash=p.session_hash
      WHERE p.user_id=$1 AND s.user_id=$1 AND s.authenticated=TRUE AND s.expires_at>NOW() AND s.last_seen>NOW()-INTERVAL '24 hours'`)).rows;},
    async deletePushSubscription(endpoint){await q('DELETE FROM user_push_subscriptions WHERE user_id=$1 AND endpoint=$2',[endpoint]);},
  };
}
module.exports={forUser,userId,scopedDatabase};
