(() => {
  window.treasurySessionLoading=true;
  const moduleName=document.currentScript.dataset.module;
  const nativeFetch=window.fetch.bind(window);
  const data=new Map();let csrf='',prefsTimer;
  const preferenceKeys=['treasury-wallet-sources','treasury-transfer-drafts','treasury-exchange-selection','treasury-exchange-view'];
  const authChannel='BroadcastChannel' in window?new BroadcastChannel('treasury-session'):null;
  authChannel?.addEventListener('message',()=>location.replace('auth.html'));
  function signOutView(){document.body.replaceChildren();location.replace('auth.html');}
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
  window.fetch=async(input,options={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.origin===location.origin&&url.pathname.startsWith('/api/')){
      const headers=new Headers(options.headers||{});if(csrf)headers.set('X-CSRF-Token',csrf);
      if(window.Treasury?.user)headers.set('X-Workspace-User',Treasury.user.id);
      const response=await nativeFetch(input,{...options,headers,credentials:'same-origin',cache:'no-store'});
      if([401,409].includes(response.status) && ['SESSION_REQUIRED','SESSION_CHANGED'].includes((await response.clone().json().catch(()=>({}))).code)){signOutView();throw Error('Session changed or expired');}
      return response;
    }
    return nativeFetch(input,options);
  };
  function savePrefs(){clearTimeout(prefsTimer);prefsTimer=setTimeout(async()=>{
    const value=Object.fromEntries(preferenceKeys.filter(key=>data.has(key)).map(key=>[key,data.get(key)]));
    try{const r=await fetch('/api/preferences',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});if(!r.ok)throw Error('Save failed');}
    catch(_){const status=document.querySelector('#sessionStatus');if(status)status.textContent='Changes could not be saved. Keep this page open and retry.';}
  },350);}
  const storage={getItem:key=>data.get(key)??null,setItem(key,value){data.set(key,String(value));if(preferenceKeys.includes(key))savePrefs();},removeItem(key){data.delete(key);if(preferenceKeys.includes(key))savePrefs();}};
  async function start(){
    const response=await nativeFetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});
    if(response.status===401){location.replace('auth.html');return;}
    if(!response.ok)throw Error('Open the cabinet on your Railway domain. The account service is unavailable here.');
    const body=await response.json();csrf=body.csrf;
    window.Treasury={user:body.user,storage,csrf:()=>csrf,logout:async()=>{
      await fetch('/api/auth/logout',{method:'POST'});authChannel?.postMessage('logout');signOutView();
    }};
    const results=await Promise.all([fetch('/api/settings'),fetch('/api/preferences')]);
    if(results.some(r=>!r.ok))throw Error('Your settings could not be loaded. Reload to retry.');
    const settings=await results[0].json(),prefs=await results[1].json();
    for(const [key,value] of Object.entries(prefs))if(preferenceKeys.includes(key))data.set(key,value);
    data.set('eth-pending-monitor-addresses',JSON.stringify(settings.addresses||[]));
    data.set('eth-pending-monitor-address-labels',JSON.stringify(settings.labels||{}));
    data.set('eth-pending-monitor-email',body.user.email);
    data.set('eth-pending-monitor-notification-settings',JSON.stringify(settings.notificationSettings||{}));
    data.set('eth-pending-monitor-balance-settings',JSON.stringify(settings.balanceSettings||{}));
    // Remove obsolete shared admin credentials from this origin.
    localStorage.removeItem('eth-pending-monitor-backend-token');
    const bar=document.createElement('div');bar.className='session-bar';
    const email=document.createElement('span');email.textContent=body.user.email;
    const link=document.createElement('a');link.href='security.html';link.textContent='Security & accounts';
    const status=document.createElement('span');status.id='sessionStatus';status.setAttribute('role','status');
    const logout=document.createElement('button');logout.type='button';logout.className='secondary';logout.textContent='Sign out';logout.onclick=()=>Treasury.logout();
    bar.append(email,link,status,logout);document.body.prepend(bar);
    const script=document.createElement('script');script.src=moduleName+'?v=11';document.body.append(script);
  }
  start().catch(error=>{
    const panel=document.createElement('div');panel.className='panel';panel.style.padding='24px';panel.textContent=error.message;document.body.prepend(panel);
  });
})();
