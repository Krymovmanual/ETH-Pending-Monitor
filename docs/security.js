(() => {
  const $=id=>document.getElementById(id);
  async function api(path,method='GET',body){const r=await fetch('/api/'+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const result=await r.json();if(!r.ok)throw Error(result.error||'Request failed');return result;}
  function bind(id,path,success,method='POST'){
    $(id).onsubmit=async event=>{event.preventDefault();const button=$(id).querySelector('button');button.disabled=true;$('securityStatus').textContent='Working…';
      try{const body=Object.fromEntries(new FormData($(id)));const result=await api(typeof path==='function'?path(body):path,method,body);$(id).reset();await success(result);$('securityStatus').textContent='Saved';}
      catch(e){$('securityStatus').textContent=e.message;}finally{button.disabled=false;}};
  }
  function row(container,title,detail,action){const div=document.createElement('div');div.className='security-row';const text=document.createElement('div');const heading=document.createElement('strong');heading.textContent=title;text.append(heading);const small=document.createElement('small');small.textContent=detail;text.append(small);div.append(text);if(action){const button=document.createElement('button');button.textContent=action.label;button.onclick=action.run;div.append(button);}container.append(div);}
  async function refresh(){
    $('ownerSection').hidden=!Treasury.user.canImportLegacy;
    const [security,connections]=await Promise.all([api('auth/security'),api('connections')]);
    $('factorStatus').textContent=security.twoFactorEnabled?'Authenticator enabled':'Authenticator not enabled';
    $('setupFactor').hidden=security.twoFactorEnabled;$('disableFactor').hidden=!security.twoFactorEnabled;
    $('addConnection').querySelector('button').disabled=!security.twoFactorEnabled;
    $('sessions').replaceChildren();for(const s of security.sessions)row($('sessions'),s.current?'This session':s.user_agent,`${s.ip} · Last active ${new Date(s.last_seen).toLocaleString()}`,{label:'Revoke',run:async()=>{try{await api('auth/sessions/'+s.id_hash,'DELETE');if(s.current)location.replace('auth.html');else await refresh();}catch(e){$('securityStatus').textContent=e.message;}}});
    $('connections').replaceChildren();if(!connections.items.length)$('connections').textContent='No exchange accounts connected yet.';
    for(const c of connections.items)row($('connections'),c.name,`${c.key_hint} · ${c.status}${c.last_checked?' · '+new Date(c.last_checked).toLocaleString():''}`,{label:'Remove',run:()=>{$('removeConnection').hidden=false;$('removeConnection').elements.id.value=c.id;$('removeName').textContent=`Remove ${c.name}?`;}});
    $('events').replaceChildren();for(const e of security.events)row($('events'),e.event.replaceAll('_',' '),`${new Date(e.created_at).toLocaleString()} · ${e.ip}`);
  }
  bind('setupFactor','auth/mfa/setup',r=>{$('factorSecret').hidden=false;$('secretValue').textContent=r.secret;});
  bind('enableFactor','auth/mfa/enable',async r=>{$('factorSecret').hidden=true;$('secretValue').textContent='';$('recoveryPanel').hidden=false;$('recoveryValue').textContent=r.recoveryCodes.join('\n');await refresh();});
  $('savedCodes').onclick=()=>{$('recoveryPanel').hidden=true;$('recoveryValue').textContent='';};
  bind('disableFactor','auth/mfa/disable',()=>location.replace('auth.html'));
  bind('changePassword','auth/password',()=>location.replace('auth.html'));
  bind('addConnection','connections',refresh);
  bind('removeConnection',body=>'connections/'+body.id,async()=>{$('removeConnection').hidden=true;await refresh();},'DELETE');
  $('cancelRemove').onclick=()=>{$('removeConnection').hidden=true;};
  bind('importWorkspace','owner/import',()=>location.replace('index.html'));
  document.querySelectorAll('form button').forEach(button=>button.disabled=false);
  window.treasurySecurityReady=true;
  refresh().catch(e=>{$('securityStatus').textContent=e.message;});
})();
