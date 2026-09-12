const {EthereumMonitor}=require('./monitor');
const {forUser}=require('./user-db');
function bindMonitor(monitor,id){
  for(const name of Object.getOwnPropertyNames(EthereumMonitor.prototype)){
    if(name==='constructor')continue;
    const method=monitor[name];
    if(typeof method==='function')monitor[name]=(...args)=>forUser(id,()=>method.apply(monitor,args));
  }
  return monitor;
}
function createMonitors(pool){
  const items=new Map();
  async function ensure(id,settings){
    if(process.env.DISABLE_MONITORS==='true')return get(id);
    if(!items.has(id)){
      const monitor=bindMonitor(new EthereumMonitor(),id);items.set(id,monitor);
      // Start and all timers run inside the owner's context, never a request's supplied id.
      try{await forUser(id,()=>monitor.start());}catch(error){monitor.stop();items.delete(id);throw error;}
    }else if(settings)await forUser(id,()=>items.get(id).reconfigure(settings));
    return items.get(id);
  }
  function get(id){return items.get(id)||{status:()=>({connected:false,monitoredAddresses:0}),getStatus:()=>({connected:false,subscriptions:0})};}
  async function start(){const rows=(await pool.query('SELECT s.user_id FROM user_settings s JOIN users u ON u.id=s.user_id WHERE u.verified_at IS NOT NULL')).rows;for(const row of rows)await ensure(row.user_id);}
  function stop(){for(const item of items.values())item.stop();items.clear();}
  return {ensure,get,start,stop};
}
module.exports={createMonitors,bindMonitor};
