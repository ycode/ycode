const { chromium }=require('playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const state=JSON.parse(fs.readFileSync('/workspace/coursey/test-results/identities.json'));
(async()=>{
 const web=process.env.COURSEY_BROWSER_WEB_HOST;
 const address=web?(await require('node:dns/promises').lookup(web)).address:'127.0.0.1';
 const browser=await chromium.launch({headless:true,args:['--no-sandbox',`--host-resolver-rules=MAP alpha.localhost ${address},MAP beta.localhost ${address}`]});
 try {
  for(const site of ['alpha','beta']) {
   const context=await browser.newContext();
   await context.route('http://127.0.0.1:54329/**',async route=>{
    const url=new URL(route.request().url());
    try {
      const response=await route.fetch({url:'http://gateway:8000'+url.pathname+url.search});
      await route.fulfill({response});
    } catch { /* Context teardown: never emit request diagnostics/credentials. */ }
   });
   const page=await context.newPage();
   await page.goto('http://'+site+'.localhost:3002/ycode');
   // Assert genuine browser sign-in through the upstream editor's form.
   const email=page.locator('input[type=email]');
   await email.waitFor({timeout:60000});
   await email.fill(site+'@coursey.invalid');
   await page.locator('input[type=password]').fill(state.password);
   await page.getByRole('button',{name:/sign in|log in/i}).click();
   await page.waitForResponse(r=>r.url().includes('/ycode/api/editor/init')&&r.status()===200,{timeout:60000});
   await page.reload();
   const result=await page.evaluate(async()=>{
    const r=await fetch('/ycode/api/editor/init');return {status:r.status,body:await r.json()};
   });
   assert.equal(result.status,200,'Cookie-authenticated editor reload failed');
   assert(result.body.data.pages.some(p=>p.name.includes('Private '+site)||p.name==='Designer edit'));
   const other=site==='alpha'?'beta':'alpha';
   assert(!result.body.data.pages.some(p=>p.name==='Private '+other));
   await page.getByText('Checking authentication...', {exact:false}).waitFor({state:'hidden',timeout:60000});
   await page.getByRole('button',{name:/publish/i}).first().waitFor({timeout:60000});
   await page.screenshot({path:'/workspace/coursey/test-results/'+site+'-editor.png',fullPage:true});
   console.log(site+': browser form login, cookie-authenticated reload and isolated editor data passed');
   await context.unrouteAll({behavior:'ignoreErrors'});
   await context.close();
  }
 } finally {await browser.close();}
})().catch(error=>{console.error('Browser regression failed; request diagnostics suppressed.');process.exitCode=1;});
