const test=require('node:test');const assert=require('node:assert/strict');
const {chromium}=require('@playwright/test');const binary=require('@sparticuz/chromium').default;
const {fixture}=require('./fixture');const {totp}=require('../server/auth/crypto');
test('browser: login, 2FA, add account, all tabs, logout and other user',async t=>{
  const f=await fixture();t.after(()=>f.close());
  await f.register('browser@example.test');await f.register('second@example.test');
  const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args.filter(arg=>!arg.includes("disable-web-security")&&!arg.includes("disable-site-isolation")&&!arg.includes("IsolateOrigins")),headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(f.origin+'/index.html');await page.waitForURL('**/auth.html');
  await page.locator('#email').fill('browser@example.test');await page.locator('#password').fill('long-test-password-123');await page.locator('#submitAuth').click();
  await page.waitForURL('**/index.html');await page.waitForFunction(()=>window.treasuryBootComplete===true);
  await page.goto(f.origin+'/security.html');await page.waitForFunction(()=>window.treasurySecurityReady);await page.locator('#setupFactor input').fill('long-test-password-123');await page.locator('#setupFactor button').click();
  await page.locator('#secretValue').waitFor({state:'visible'});const secret=await page.locator('#secretValue').textContent();
  await page.locator('#enableFactor input').fill(totp(secret));await page.locator('#enableFactor button').click();
  await page.locator('#recoveryValue').waitFor({state:'visible'});const codes=(await page.locator('#recoveryValue').textContent()).split('\n');
  await page.locator('#savedCodes').click();
  const form=page.locator('#addConnection');for(const [name,value]of Object.entries({name:'Personal Bitget',apiKey:'fixture-key',secret:'fixture-secret',passphrase:'fixture-passphrase',code:codes[0]}))await form.locator(`[name="${name}"]`).fill(value);
  await form.locator('button').click();await page.getByText('Personal Bitget',{exact:true}).waitFor();
  for(const path of ['exchanges.html','transfers.html','index.html?view=networks','index.html?view=market','index.html?view=wallets']){
    await page.goto(f.origin+'/'+path);await page.locator('.session-bar').waitFor();
    await page.waitForFunction(()=>document.querySelector('script[src$="?v=11"]')&&window.Treasury?.user);
    await page.waitForTimeout(250);
  }
  await page.goto(f.origin+'/security.html');await page.locator('#connections').getByText('Personal Bitget',{exact:true}).waitFor();
  await page.screenshot({path:require('node:path').join(__dirname,'../security-preview.png'),fullPage:true});
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.waitForURL('**/auth.html');
  await page.locator('#email').fill('second@example.test');await page.locator('#password').fill('long-test-password-123');await page.locator('#submitAuth').click();await page.waitForURL('**/index.html');
  await page.goto(f.origin+'/security.html');await page.getByText('No exchange accounts connected yet.').waitFor();
  assert.equal(await page.getByText('Personal Bitget',{exact:true}).count(),0);
  assert.deepEqual(errors,[]);
});
