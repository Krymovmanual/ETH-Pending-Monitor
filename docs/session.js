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
      if(window.Treasury?.organization)headers.set('X-Workspace-Organization',Treasury.organization.id);
      const response=await nativeFetch(input,{...options,headers,credentials:'same-origin',cache:'no-store'});
      const code=[401,409].includes(response.status)?(await response.clone().json().catch(()=>({}))).code:null;
      if(code==='WORKSPACE_CHANGED'){location.reload();throw Error('Workspace changed');}
      if(['SESSION_REQUIRED','SESSION_CHANGED'].includes(code)){signOutView();throw Error('Session changed or expired');}
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
  function currentSection(){
    if(location.pathname.endsWith('/exchanges.html'))return'exchanges';
    if(location.pathname.endsWith('/transfers.html'))return'transfers';
    if(location.pathname.endsWith('/security.html'))return'security';
    const view=new URLSearchParams(location.search).get('view');
    return ['wallets','networks','market'].includes(view)?view:'overview';
  }
  function mountAppRail(){
    const section=currentSection();
    const routes=[
      ['overview','Overview','index.html'],['exchanges','Accounts','exchanges.html'],
      ['wallets','Wallets','index.html?view=wallets'],['transfers','Transfers','transfers.html'],
      ['networks','Networks','index.html?view=networks'],['market','Market','index.html?view=market'],
      ['security','Security','security.html']
    ];
    let rail=document.querySelector('.overview-rail');
    if(!rail){rail=document.createElement('aside');document.body.prepend(rail);}
    rail.className='overview-rail app-rail';rail.setAttribute('aria-label','Treasury navigation');
    rail.replaceChildren();
    const brand=document.createElement('a');brand.className='overview-brand';brand.href='index.html';brand.innerHTML='<span aria-hidden="true">P</span><strong>Paseqa<small>Treasury</small></strong>';
    const nav=document.createElement('nav');
    routes.forEach(([id,label,href])=>{const link=document.createElement('a');link.href=href;link.textContent=label;if(id===section){link.className='active';link.setAttribute('aria-current','page');}nav.append(link);});
    const railStatus=document.createElement('div');railStatus.className='overview-rail-status';
    const badge=document.createElement('span');badge.className='connection compact';badge.id='overviewSystemBadge';badge.innerHTML='<span class="dot"></span><span id="overviewSystemLabel">Workspace protected</span>';
    const detail=document.createElement('small');detail.id='overviewUpdatedAt';detail.textContent='Encrypted session active';
    railStatus.append(badge,detail);rail.append(brand,nav,railStatus);document.body.classList.add('has-app-rail');
  }
  async function start(){
    const response=await nativeFetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});
    if(response.status===401){location.replace('auth.html');return;}
    if(!response.ok)throw Error('Open the cabinet on your Railway domain. The account service is unavailable here.');
    const body=await response.json();csrf=body.csrf;
    window.Treasury={user:body.user,organization:body.organization,organizations:body.organizations||[],storage,csrf:()=>csrf,can:(minimum)=>{
      const levels={viewer:0,operator:1,admin:2,owner:3};return levels[body.organization?.role]>=levels[minimum];
    },logout:async()=>{
      await fetch('/api/auth/logout',{method:'POST'});authChannel?.postMessage('logout');signOutView();
    }};
    const results=await Promise.all([fetch('/api/settings'),fetch('/api/preferences')]);
    if(results.some(r=>!r.ok))throw Error('Your settings could not be loaded. Reload to retry.');
    const settings=await results[0].json(),prefs=await results[1].json();
    for(const [key,value] of Object.entries(prefs))if(preferenceKeys.includes(key))data.set(key,value);
    data.set('eth-pending-monitor-addresses',JSON.stringify(settings.addresses||[]));
    data.set('eth-pending-monitor-address-labels',JSON.stringify(settings.labels||{}));
    data.set('paseqa-solana-addresses',JSON.stringify(settings.solanaAddresses||[]));
    data.set('paseqa-solana-address-labels',JSON.stringify(settings.solanaLabels||{}));
    data.set('paseqa-bitcoin-addresses',JSON.stringify(settings.bitcoinAddresses||[]));
    data.set('paseqa-bitcoin-address-labels',JSON.stringify(settings.bitcoinLabels||{}));
    data.set('eth-pending-monitor-email',body.user.email);
    data.set('paseqa-telegram-chat-id',settings.telegramChatId||'');
    data.set('eth-pending-monitor-notification-settings',JSON.stringify(settings.notificationSettings||{}));
    data.set('eth-pending-monitor-balance-settings',JSON.stringify(settings.balanceSettings||{}));
    // Remove obsolete shared admin credentials from this origin.
    localStorage.removeItem('eth-pending-monitor-backend-token');
    mountAppRail();
    const bar=document.createElement('div');bar.className='session-bar';
    const workspace=document.createElement('label');workspace.className='workspace-switcher';workspace.title='Active workspace';
    const workspaceSelect=document.createElement('select');workspaceSelect.setAttribute('aria-label','Active workspace');
    for(const item of body.organizations||[]){const option=document.createElement('option');option.value=item.id;option.textContent=`${item.name} · ${item.role}`;option.selected=item.id===body.organization?.id;workspaceSelect.append(option);}
    workspaceSelect.onchange=async()=>{workspaceSelect.disabled=true;try{const response=await fetch('/api/organizations/switch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId:workspaceSelect.value})});if(!response.ok)throw Error((await response.json()).error||'Workspace switch failed');location.reload();}catch(error){workspaceSelect.disabled=false;status.textContent=error.message;}};
    workspace.append(workspaceSelect);
    const email=document.createElement('span');email.textContent=body.user.email;
    const link=document.createElement('a');link.href='security.html';link.textContent='Security & accounts';
    const status=document.createElement('span');status.id='sessionStatus';status.setAttribute('role','status');
    const logout=document.createElement('button');logout.type='button';logout.className='secondary';logout.textContent='Sign out';logout.onclick=()=>Treasury.logout();
    bar.append(workspace,email,link,status,logout);document.body.prepend(bar);requestAnimationFrame(()=>document.body.classList.remove('app-loading'));
    const script=document.createElement('script');script.src=moduleName+'?v=20.1';document.body.append(script);
  }
  start().catch(error=>{
    document.body.classList.remove('app-loading');
    const panel=document.createElement('div');panel.className='panel';panel.style.padding='24px';panel.textContent=error.message;document.body.prepend(panel);
  });
})();
