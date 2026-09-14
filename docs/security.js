(() => {
  const $=id=>document.getElementById(id);
  async function api(path,method='GET',body){const r=await fetch('/api/'+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const result=await r.json();if(!r.ok)throw Error(result.error||'Request failed');return result;}
  function bind(id,path,success,method='POST'){
    $(id).onsubmit=async event=>{event.preventDefault();const button=$(id).querySelector('button');button.disabled=true;$('securityStatus').textContent='Working…';
      try{const body=Object.fromEntries(new FormData($(id)));const result=await api(typeof path==='function'?path(body):path,method,body);$(id).reset();await success(result);$('securityStatus').textContent='Saved';}
      catch(e){$('securityStatus').textContent=e.message;}finally{button.disabled=false;}};
  }
  function row(container,title,detail,action){const div=document.createElement('div');div.className='security-row';const text=document.createElement('div');const heading=document.createElement('strong');heading.textContent=title;text.append(heading);const small=document.createElement('small');small.textContent=detail;text.append(small);div.append(text);if(action){const button=document.createElement('button');button.textContent=action.label;button.onclick=action.run;div.append(button);}container.append(div);}
  function memberRow(member){
    const mine=member.id===Treasury.user.id,owner=member.role==='owner';
    const div=document.createElement('div');div.className='security-row member-row';const text=document.createElement('div');
    const heading=document.createElement('strong');heading.textContent=member.email+(mine?' (you)':'');const detail=document.createElement('small');detail.textContent=`${member.role} · Joined ${new Date(member.joined_at).toLocaleDateString()}`;text.append(heading,detail);div.append(text);
    if(Treasury.organization.role==='owner'&&!owner){const controls=document.createElement('div');controls.className='member-controls';const select=document.createElement('select');
      for(const role of ['admin','operator','viewer']){const option=document.createElement('option');option.value=role;option.textContent=role;option.selected=role===member.role;select.append(option);}
      select.onchange=async()=>{try{await api('organizations/members/'+member.id,'PATCH',{role:select.value});await refresh();}catch(error){$('securityStatus').textContent=error.message;}};
      const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.onclick=async()=>{try{await api('organizations/members/'+member.id,'DELETE');await refresh();}catch(error){$('securityStatus').textContent=error.message;}};controls.append(select,remove);div.append(controls);
    }return div;
  }
  async function refresh(){
    $('ownerSection').hidden=!Treasury.user.canImportLegacy||Treasury.organization.role!=='owner';
    const canAdmin=Treasury.can('admin');
    const [security,connections,workspace,audit]=await Promise.all([api('auth/security'),api('connections'),api('organizations/current'),canAdmin?api('organizations/audit'):Promise.resolve({items:[]})]);
    Treasury.organization=workspace.organization;$('workspaceTitle').textContent=workspace.organization.name;$('workspaceRole').textContent=workspace.organization.role;
    $('renameWorkspace').hidden=!canAdmin;$('inviteMember').hidden=!canAdmin;$('renameWorkspace').elements.name.value=workspace.organization.name;
    if(Treasury.organization.role!=='owner')$('inviteMember').elements.role.querySelector('option[value="admin"]')?.remove();
    $('members').replaceChildren(...workspace.members.map(memberRow));
    $('invitations').replaceChildren();for(const invitation of workspace.invitations)row($('invitations'),invitation.email,`${invitation.role} · expires ${new Date(invitation.expires_at).toLocaleString()}`);
    $('organizationEvents').replaceChildren();if(!canAdmin)$('organizationEvents').textContent='Workspace audit is available to owners and admins.';
    for(const event of audit.items)row($('organizationEvents'),event.event.replaceAll('_',' '),`${event.actor_email||'System'} · ${new Date(event.created_at).toLocaleString()}`);
    $('factorStatus').textContent=security.twoFactorEnabled?'Authenticator enabled':'Authenticator not enabled';
    $('setupFactor').hidden=security.twoFactorEnabled;$('disableFactor').hidden=!security.twoFactorEnabled;
    $('sessions').replaceChildren();for(const s of security.sessions)row($('sessions'),s.current?'This session':s.user_agent,`${s.ip} · Last active ${new Date(s.last_seen).toLocaleString()}`,{label:'Revoke',run:async()=>{try{await api('auth/sessions/'+s.id_hash,'DELETE');if(s.current)location.replace('auth.html');else await refresh();}catch(e){$('securityStatus').textContent=e.message;}}});
    $('connections').replaceChildren();if(!connections.items.length)$('connections').textContent='No exchange accounts connected yet.';
    for(const c of connections.items)row($('connections'),c.name,`${String(c.exchange||'').toUpperCase()} · ${c.key_hint} · ${c.status}${c.last_checked?' · '+new Date(c.last_checked).toLocaleString():''}`,canAdmin?{label:'Remove',run:()=>{$('removeConnection').hidden=false;$('removeConnection').elements.id.value=c.id;$('removeName').textContent=`Remove ${c.name}?`;}}:null);
    $('events').replaceChildren();for(const e of security.events)row($('events'),e.event.replaceAll('_',' '),`${new Date(e.created_at).toLocaleString()} · ${e.ip}`);
  }
  bind('setupFactor','auth/mfa/setup',r=>{$('factorSecret').hidden=false;$('secretValue').textContent=r.secret;});
  bind('enableFactor','auth/mfa/enable',async r=>{$('factorSecret').hidden=true;$('secretValue').textContent='';$('recoveryPanel').hidden=false;$('recoveryValue').textContent=r.recoveryCodes.join('\n');await refresh();});
  $('savedCodes').onclick=()=>{$('recoveryPanel').hidden=true;$('recoveryValue').textContent='';};
  bind('disableFactor','auth/mfa/disable',()=>location.replace('auth.html'));
  bind('changePassword','auth/password',()=>location.replace('auth.html'));
  bind('renameWorkspace','organizations/current',()=>location.reload(),'PATCH');
  bind('inviteMember','organizations/invitations',refresh);
  bind('removeConnection',body=>'connections/'+body.id,async()=>{$('removeConnection').hidden=true;await refresh();},'DELETE');
  $('cancelRemove').onclick=()=>{$('removeConnection').hidden=true;};
  bind('importWorkspace','owner/import',()=>location.replace('index.html'));
  document.querySelectorAll('form button').forEach(button=>button.disabled=false);
  window.treasurySecurityReady=true;
  const invite=new URLSearchParams(location.hash.slice(1)).get('invite');
  (invite?api('organizations/invitations/accept','POST',{token:invite}).then(()=>{history.replaceState(null,'',location.pathname);location.reload();}):refresh()).catch(e=>{$('securityStatus').textContent=e.message;});
})();
