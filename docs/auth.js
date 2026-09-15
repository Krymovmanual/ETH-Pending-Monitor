(() => {
  const $=id=>document.getElementById(id);let mode='login',emailToken='';
  const decode=value=>{const text=value.replace(/-/g,'+').replace(/_/g,'/'),binary=atob(text+'='.repeat((4-text.length%4)%4));return Uint8Array.from(binary,c=>c.charCodeAt(0));};
  const encode=value=>{let binary='';new Uint8Array(value||[]).forEach(byte=>binary+=String.fromCharCode(byte));return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
  const authCredential=credential=>({id:credential.id,rawId:encode(credential.rawId),type:credential.type,response:{clientDataJSON:encode(credential.response.clientDataJSON),authenticatorData:encode(credential.response.authenticatorData),signature:encode(credential.response.signature),userHandle:credential.response.userHandle?encode(credential.response.userHandle):undefined},clientExtensionResults:credential.getClientExtensionResults()});
  const params=new URLSearchParams(location.hash.slice(1));
  if(params.has('verify')){mode='verify';emailToken=params.get('verify');}
  if(params.has('reset')){mode='reset';emailToken=params.get('reset');}
  history.replaceState(null,'',location.pathname);
  function render(){
    $('authTitle').textContent=({login:'Sign in',register:'Create account',forgot:'Reset password',verify:'Confirm email',reset:'Set a new password',mfa:'Verify your identity'})[mode];
    document.querySelectorAll('[data-mode]').forEach(button=>{const active=button.dataset.mode===mode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
    $('submitAuth').textContent=$('authTitle').textContent;
    $('emailLabel').hidden=['verify','reset','mfa'].includes(mode);$('email').required=!$('emailLabel').hidden;
    $('passwordLabel').hidden=['forgot','verify','mfa'].includes(mode);$('password').required=!$('passwordLabel').hidden;
    $('password').autocomplete=mode==='login'?'current-password':'new-password';
    $('codeLabel').hidden=!['mfa','reset'].includes(mode);$('code').required=mode==='mfa';
    $('authHint').textContent=mode==='reset'?'If 2FA is enabled, enter an authenticator or unused recovery code.':mode==='register'?'Use 12–128 characters. We will email a confirmation link.':mode==='mfa'?'Enter a fresh six-digit code or an unused recovery code.':'';
    $('resend').hidden=!['login','register'].includes(mode);
    $('passkeyLogin').hidden=mode!=='login'||!window.PublicKeyCredential;
  }
  async function call(path,body){const r=await fetch('/api/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data;}
  document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{mode=button.dataset.mode;$('authResult').textContent='';render();});
  $('authForm').onsubmit=async event=>{
    event.preventDefault();$('submitAuth').disabled=true;$('authResult').textContent='Working…';
    try{
      const body={email:$('email').value,password:$('password').value,code:$('code').value.trim(),token:emailToken};
      const data=await call(mode==='mfa'?'mfa/login':mode,body);
      $('password').value='';$('code').value='';
      if(mode==='login'&&data.twoFactorRequired){mode='mfa';$('authResult').textContent='';render();}
      else if(mode==='login'||mode==='mfa')location.replace('index.html');
      else{$('authResult').textContent=data.message||'Done';if(mode==='verify'||mode==='reset'){mode='login';render();}}
    }catch(error){$('authResult').textContent=error.message;}finally{$('submitAuth').disabled=false;}
  };
  $('resend').onclick=async()=>{try{$('resend').disabled=true;$('authResult').textContent=(await call('resend',{email:$('email').value})).message;}catch(e){$('authResult').textContent=e.message;}finally{$('resend').disabled=false;}};
  $('passkeyLogin').onclick=async()=>{try{
    const email=$('email').value.trim();if(!email)throw Error('Enter your email first');
    $('passkeyLogin').disabled=true;$('authResult').textContent='Waiting for your passkey…';
    const start=await call('passkeys/login/options',{email});const options=start.options;
    options.challenge=decode(options.challenge);options.allowCredentials=(options.allowCredentials||[]).map(item=>({...item,id:decode(item.id)}));
    const credential=await navigator.credentials.get({publicKey:options});if(!credential)throw Error('Passkey was not selected');
    await call('passkeys/login/verify',{flowToken:start.flowToken,response:authCredential(credential)});location.replace('index.html');
  }catch(error){$('authResult').textContent=error.name==='NotAllowedError'?'Passkey request was cancelled or timed out.':error.message;}finally{$('passkeyLogin').disabled=false;}};
  render();
})();
