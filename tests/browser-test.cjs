/* Run with PLAYWRIGHT_MODULE pointing to an installed playwright package. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const root=path.resolve(process.env.TEST_DIR || 'dist');
await context.route('http://stellive.test/**',async route=>{
  const pathname=decodeURIComponent(new URL(route.request().url()).pathname);
  const filename=path.resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));
  if(!filename.startsWith(root+path.sep)){await route.fulfill({status:403});return;}
  try{const contentType={'.html':'text/html; charset=utf-8','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'}[path.extname(filename)] || 'application/octet-stream';await route.fulfill({body:fs.readFileSync(filename),contentType});}
  catch{await route.fulfill({status:404,body:'not found'});}
});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(process.env.TEST_URL || 'http://stellive.test/');
await page.locator('#videos li').first().waitFor();
assert.equal(await page.title(),'별 따라 보기 · 스텔라이브 정주행');
assert.equal(await page.locator('#videos li').count(),50);
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
await page.locator('#videos li button').first().click();
await page.locator('#original').waitFor({state:'visible'});
assert.match(await page.locator('#original').getAttribute('href'),/^https:\/\/www.youtube.com\/watch\?v=[\w-]{11}/);
await page.locator('#complete').click();assert.match(await page.locator('#complete').innerText(),/완료됨/);
await page.reload();await page.locator('#videos li').first().waitFor();
assert.match(await page.locator('#videos li').first().innerText(),/시청 완료/);
await page.locator('#videos li button').first().click();await page.locator('[data-decision="exclude"]').click();
await page.selectOption('#mode','exclude');await page.waitForFunction(()=>document.querySelector('#list-status').textContent.includes('개 표시'));
const current=await page.locator('#current-title').innerText();
assert.match(await page.locator('#videos').innerText(),new RegExp(current.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
await page.selectOption('#mode','include');await page.waitForFunction(()=>document.querySelector('#list-status').textContent.includes('개 표시'));
await page.locator('#oldest').click();await page.waitForFunction(()=>!document.querySelector('#original').hidden);
await page.setViewportSize({width:320,height:740});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
await page.setViewportSize({width:430,height:932});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
await page.selectOption('#mode','include');await page.waitForFunction(()=>document.querySelectorAll('#videos li').length===50);
const firstBefore=await page.locator('#videos li').first().getAttribute('data-id');
await page.locator('#more').click();await page.waitForFunction(id=>document.querySelector('#videos li')?.dataset.id!==id,firstBefore);
const firstAfter=await page.locator('#videos li').first().getAttribute('data-id');
const other=await context.newPage();await other.goto('http://stellive.test/');await other.locator('#videos li').first().waitFor();
await other.evaluate(()=>{const key='stellive-watch-v2:/';const obj=JSON.parse(localStorage.getItem(key));const id=Object.keys(obj.records)[0];obj.records[id].position+=1;obj.records[id].updated=Date.now();localStorage.setItem(key,JSON.stringify(obj));});
await page.waitForTimeout(200);assert.equal(await page.locator('#videos li').first().getAttribute('data-id'),firstAfter);
if(process.env.SCREENSHOT){await page.reload();await page.locator('#videos li').first().waitFor();await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:process.env.SCREENSHOT,fullPage:false});}
assert.deepEqual(errors,[]);
console.log('PASS: mobile 320/390/430 widths, 50-row paging, original link, completion persistence, classification, oldest unwatched; no page errors');
await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
