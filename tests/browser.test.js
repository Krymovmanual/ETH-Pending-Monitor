const test=require('node:test');const assert=require('node:assert/strict');
const {chromium}=require('@playwright/test');const binary=require('@sparticuz/chromium').default;
const {fixture}=require('./fixture');const {totp}=require('../server/auth/crypto');
test('browser: login, 2FA, add account, all tabs, logout and other user',async t=>{
  const f=await fixture();t.after(()=>f.close());
  const browserUser=await f.register('browser@example.test');await f.register('second@example.test');
  const bitcoinAddress='1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
  await browserUser.client.call('/api/settings','PUT',{addresses:[],labels:{},solanaAddresses:[],solanaLabels:{},bitcoinAddresses:[bitcoinAddress],bitcoinLabels:{[bitcoinAddress]:'Cold reserve'}});
  const metric=value=>({min:value*.82,avg:value,median:value*.98,max:value*1.32});
  for(let day=0;day<14;day+=1)for(let hour=0;hour<24;hour+=4){const value=4+hour*.36+(day%7)*.7;await f.db.saveGasMinute({minute:new Date(Date.now()-((day*24+(23-hour))*3600000)),sampleCount:1,base:metric(value*.78),low:metric(value*.9),standard:metric(value),fast:metric(value*1.18)});}
  const fs=require('node:fs');const executablePath=fs.existsSync('/tmp/chromium')?'/tmp/chromium':await binary.executablePath();
  const browser=await chromium.launch({executablePath,args:binary.args.filter(arg=>!arg.includes("disable-web-security")&&!arg.includes("disable-site-isolation")&&!arg.includes("IsolateOrigins")),headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const cdp=await page.context().newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
  await page.goto(f.origin+'/index.html');await page.waitForURL('**/auth.html');
  await page.screenshot({path:require('node:path').join(__dirname,'../auth-preview.png'),fullPage:true});
  await page.locator('#email').fill('browser@example.test');await page.locator('#password').fill('long-test-password-123');await page.locator('#submitAuth').click();
  await page.waitForURL('**/index.html');await page.waitForFunction(()=>window.treasuryBootComplete===true);
  await page.goto(f.origin+'/security.html');await page.waitForFunction(()=>window.treasurySecurityReady);const passkeyForm=page.locator('#addPasskey');await passkeyForm.locator('[name="name"]').fill('Test platform passkey');await passkeyForm.locator('[name="password"]').fill('long-test-password-123');await passkeyForm.locator('button').click();await page.locator('#passkeys').getByText('Test platform passkey',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.waitForURL('**/auth.html');await page.locator('#email').fill('browser@example.test');await page.locator('#passkeyLogin').click();await page.waitForURL('**/index.html');await page.waitForFunction(()=>window.treasuryBootComplete===true);
  await page.goto(f.origin+'/security.html');await page.waitForFunction(()=>window.treasurySecurityReady);await page.locator('#setupFactor input').fill('long-test-password-123');await page.locator('#setupFactor button').click();
  await page.locator('#secretValue').waitFor({state:'visible'});const secret=await page.locator('#secretValue').textContent();
  await page.locator('#enableFactor input').fill(totp(secret));await page.locator('#enableFactor button').click();
  await page.locator('#recoveryValue').waitFor({state:'visible'});const codes=(await page.locator('#recoveryValue').textContent()).split('\n');
  await page.locator('#savedCodes').click();
  await page.goto(f.origin+'/exchanges.html');await page.waitForFunction(()=>window.Treasury?.user);await page.locator('#openAddExchange').click();
  const form=page.locator('#addExchangeForm');for(const [name,value]of Object.entries({name:'Personal Bitget',apiKey:'fixture-key',secret:'fixture-secret',passphrase:'fixture-passphrase',code:codes[0]}))await form.locator(`[name="${name}"]`).fill(value);
  await form.locator('[name="readOnlyConfirmed"]').check();
  await form.locator('#submitAddExchange').click();await page.getByText('Personal Bitget · Unified',{exact:true}).waitFor();
  await page.goto(f.origin+'/index.html');await page.waitForFunction(()=>window.treasuryBootComplete===true);await page.locator('#overviewAccountGrid').getByText('Personal Bitget · Unified',{exact:true}).waitFor();await page.locator('#settingsDialog').evaluate(dialog=>dialog.open&&dialog.close());
  await page.screenshot({path:require('node:path').join(__dirname,'../overview-preview.png'),fullPage:true});
  await page.goto(f.origin+'/index.html?view=wallets');await page.waitForFunction(()=>window.treasuryBootComplete===true);
  await page.locator('#notificationSettingsButton').click();await page.locator('#notificationSettingsDialog').waitFor({state:'visible'});
  await page.locator('#telegramChatIdInput').fill('-1001234567890');await page.locator('#testTelegramButton').click();await page.locator('#testTelegramStatus').filter({hasText:'The group is connected'}).waitFor();
  assert.equal(await page.locator('#pendingTelegramInput').isChecked(),true);await page.screenshot({path:require('node:path').join(__dirname,'../telegram-preview.png'),fullPage:true});
  assert.equal(await page.locator('#solanaGasTelegramInput').count(),1);
  await page.locator('#notificationSettingsForm button.primary').click();await page.locator('#notificationSettingsDialog').waitFor({state:'hidden'});
  await page.goto(f.origin+'/index.html');await page.waitForFunction(()=>window.treasuryBootComplete===true);await page.locator('#overviewAccountGrid').getByText('Personal Bitget · Unified',{exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);await page.screenshot({path:require('node:path').join(__dirname,'../overview-mobile-preview.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('link',{name:'Add account',exact:true}).click();await page.locator('#addExchangeDialog').waitFor({state:'visible'});await page.locator('#closeAddExchange').click();
  for(const path of ['exchanges.html','transfers.html','index.html?view=networks','index.html?view=market','index.html?view=wallets']){
    await page.goto(f.origin+'/'+path);await page.locator('.session-bar').waitFor();
    await page.waitForFunction(()=>document.querySelector('script[src$="?v=21.1.2"]')&&window.Treasury?.user);
    await page.locator('.app-rail a[aria-current="page"]').waitFor();
    assert.equal(await page.locator('body').evaluate(body=>body.classList.contains('app-loading')),false);
    await page.waitForTimeout(250);await page.screenshot({path:require('node:path').join(__dirname,`../${path.split('?')[0].replace('.html','')}${path.includes('view=')?'-'+path.split('view=')[1]:''}-preview.png`),fullPage:true});
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,`${path} has no document-level mobile overflow`);await page.setViewportSize({width:1440,height:1000});
    if(path.includes('view=networks')){
      assert.equal(await page.locator('[data-network-view="ethereum"]').getAttribute('aria-selected'),'true');
      assert.equal(await page.locator('[data-network-panel="ethereum"]').first().isVisible(),true);
      assert.equal(await page.locator('[data-network-panel="solana"]').isVisible(),false);
      await page.locator('[data-network-view="solana"]').click();await page.locator('[data-network-panel="solana"]').waitFor({state:'visible'});
      await page.locator('[data-network-view="bitcoin"]').click();await page.locator('[data-network-panel="bitcoin"]').waitFor({state:'visible'});
      await page.locator('#bitcoinBlockHeight').filter({hasText:'865,432'}).waitFor();
      await page.screenshot({path:require('node:path').join(__dirname,'../index-networks-bitcoin-preview.png'),fullPage:true});
    }
  }
  await page.goto(f.origin+'/security.html');await page.locator('#connections').getByText('Personal Bitget',{exact:true}).waitFor();
  await page.screenshot({path:require('node:path').join(__dirname,'../security-preview.png'),fullPage:true});
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.waitForURL('**/auth.html');
  await page.locator('#email').fill('second@example.test');await page.locator('#password').fill('long-test-password-123');await page.locator('#submitAuth').click();await page.waitForURL('**/index.html');
  await page.goto(f.origin+'/security.html');await page.getByText('No exchange accounts connected yet.').waitFor();
  assert.equal(await page.getByText('Personal Bitget',{exact:true}).count(),0);
  assert.deepEqual(errors,[]);
});
