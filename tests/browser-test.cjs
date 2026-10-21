/* Actual archive smoke test; PLAYWRIGHT_MODULE points at an installed package. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const root=path.resolve(process.env.TEST_DIR || 'dist');
await context.route('http://stellive.test/**',async route=>{
  const pathname=decodeURIComponent(new URL(route.request().url()).pathname);
  const filename=path.resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));
  if(!filename.startsWith(root+path.sep))return route.fulfill({status:403});
  try{await route.fulfill({body:fs.readFileSync(filename),contentType:{'.html':'text/html; charset=utf-8','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'}[path.extname(filename)]||'application/octet-stream'});}
  catch{await route.fulfill({status:404,body:'not found'});}
});
await context.route('https://www.youtube.com/iframe_api',route=>route.abort());
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const nav=async name=>{await page.locator(`[data-nav="${name}"]`).click();};
const settled=()=>page.waitForFunction(()=>document.querySelector('#videos').getAttribute('aria-busy')==='false');
const close=()=>page.locator('#player-close').click();
await page.goto('http://stellive.test/');await page.locator('#hero-play:not([disabled])').waitFor();
assert.equal(await page.title(),'별 따라 보기 · 스텔라이브 정주행');
assert.equal(await page.locator('#view-home').isVisible(),true);
assert.ok(Number((await page.locator('#home-total').innerText()).replaceAll(',',''))>0);
if(process.env.SCREENSHOT){await page.waitForTimeout(1000);await page.screenshot({path:process.env.SCREENSHOT,fullPage:true});}
await nav('library');await settled();assert.equal(await page.locator('#videos li').count(),50);
const firstID=await page.locator('#videos li').first().getAttribute('data-id');
await page.locator('#videos button').first().click();await page.locator('#original').waitFor();
assert.match(await page.locator('#original').getAttribute('href'),/^https:\/\/www.youtube.com\/watch\?v=[\w-]{11}/);
assert.equal(await page.locator('#watch-dialog').evaluate(d=>d.open),true);
assert.equal(await page.locator('#watch-dialog').evaluate(d=>d.getBoundingClientRect().width),390);
await page.locator('#complete').click();assert.match(await page.locator('#complete').innerText(),/완료됨/);
await close();assert.equal(await page.locator('#session-dock').isVisible(),true);
await page.reload();await settled();assert.match(await page.locator('#videos li').first().innerText(),/시청 완료/);
await page.locator('#videos button').first().click();
await page.locator('.classification-details summary').click();await page.locator('[data-decision="exclude"]').click();
await close();await settled();assert.notEqual(await page.locator('#videos li').first().getAttribute('data-id'),firstID);
await page.locator('#filters-open').click();await page.selectOption('#mode','exclude');await page.locator('[data-close="filters-dialog"]').last().click();await settled();
assert.equal(await page.locator('#videos li').first().getAttribute('data-id'),firstID);
await page.locator('#filters-open').click();await page.selectOption('#year','2024');await page.locator('[data-close="filters-dialog"]').last().click();await settled();
assert.match(await page.locator('#videos li').first().innerText(),/2024/);
await page.locator('#filters-open').click();await page.locator('#filters-reset').click();await page.locator('[data-close="filters-dialog"]').last().click();await settled();
const before=await page.locator('#videos li').first().getAttribute('data-id');await page.locator('#more').click();await settled();
const after=await page.locator('#videos li').first().getAttribute('data-id');assert.notEqual(before,after);
const other=await context.newPage();await other.goto('http://stellive.test/');await other.locator('#hero-play:not([disabled])').waitFor();
await other.evaluate(()=>{const key='stellive-watch-v2:/',obj=JSON.parse(localStorage.getItem(key)),id=Object.keys(obj.records)[0];obj.records[id].position+=1;obj.records[id].updated=Date.now();localStorage.setItem(key,JSON.stringify(obj));});
await page.waitForTimeout(200);assert.equal(await page.locator('#videos li').first().getAttribute('data-id'),after);
await nav('history');await page.locator('[data-history-mode="completed"]').click();await page.locator('#history-list li').first().waitFor();
assert.equal(await page.locator('#history-list li').first().getAttribute('data-id'),firstID);
await nav('settings');await page.selectOption('#theme','dark');assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
await page.reload();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadPromise;
const backup=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.equal(backup.records[firstID].completed,true);
await page.locator('#import').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('복원을 완료'));
await nav('home');await page.locator('#oldest').click();await page.locator('#watch-dialog').waitFor();
await page.keyboard.press('Escape');await page.locator('#watch-dialog').waitFor({state:'hidden'});
await page.locator('#session-dock').click();await page.locator('#watch-dialog').waitFor();await close();
for(const width of [320,390,430,1024]){
  await page.setViewportSize({width,height:844});
  for(const view of ['home','library','history','settings']){await nav(view);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}/${view} overflow`);}
}
const offline=await context.newPage();let unavailable=true;
await offline.route('http://stellive.test/data/manifest.json',route=>unavailable?route.fulfill({status:503,body:'temporarily unavailable'}):route.fallback());
await offline.goto('http://stellive.test/');await offline.locator('#hero-action').filter({hasText:'다시 불러오기'}).waitFor();
unavailable=false;await offline.locator('#hero-play').click();await offline.waitForFunction(()=>document.querySelector('#hero-action').textContent!=='다시 불러오기'&&!document.querySelector('#hero-play').disabled);
assert.deepEqual(errors,[]);
console.log('PASS: home/library/history/settings, 320–1024px, classification/year filters, paging, cross-tab page stability, persistent completion/theme, backup/restore, Escape/dock, offline retry, no page errors');
await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
