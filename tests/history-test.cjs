/* History retry is transactional and live position updates retain pagination. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:390,height:844}}),root=path.resolve('dist');
  const id=n=>'zz'+String(n).padStart(9,'0');let lookups=0,failAt=0;
  const rows=Array.from({length:40},(_,i)=>({id:id(i),title:'기록 영상 '+i,channel:'test',published_utc:'2024-01-01T00:00:00Z',duration:600,suggested:'include',reason:'자동 포함',embeddable:true,expires_utc:'2099-01-01T00:00:00Z'}));
  await context.route('http://stellive.test/**',async route=>{
    const p=new URL(route.request().url()).pathname,reply=obj=>route.fulfill({contentType:'application/json',body:JSON.stringify(obj)});
    if(p==='/data/manifest.json')return reply({schema:1,total:40,generated_utc:new Date().toISOString(),channels:[{key:'test',name:'테스트',group:'official'}],shards:[{file:'shards/test.json',count:40,first:rows[0].published_utc,last:rows.at(-1).published_utc}]});
    if(p.startsWith('/data/lookup/')){if(++lookups===failAt)return route.fulfill({status:503});return reply(Object.fromEntries(rows.map(r=>[r.id,'shards/test.json'])));}
    if(p==='/data/shards/test.json')return reply(rows);
    try{const file=path.join(root,p==='/'?'index.html':p);return route.fulfill({body:fs.readFileSync(file),contentType:{'.html':'text/html','.mjs':'application/javascript','.css':'text/css'}[path.extname(file)]||'text/plain'});}catch{return route.fulfill({status:404});}
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://stellive.test/');await page.locator('#hero-play:not([disabled])').waitFor();
  await page.evaluate(()=>{const records={};for(let i=0;i<45;i++)records['zz'+String(i).padStart(9,'0')]={position:37,completed:false,updated:i+1};localStorage.setItem('stellive-watch-v2:/',JSON.stringify({schema:1,records}));});
  // Reload picks up the seeded records without forging an internal state mutation.
  await page.reload();await page.locator('#hero-play:not([disabled])').waitFor();lookups=0;failAt=7;
  await page.locator('[data-nav=history]').click();await page.waitForFunction(()=>document.querySelector('#history-status').textContent.includes('불러오지 못'));
  assert.equal(await page.locator('#history-list li').count(),0);
  failAt=0;await page.locator('#history-more').click();await page.waitForFunction(()=>document.querySelectorAll('#history-list li').length===20);
  await page.locator('#history-more').click();await page.waitForFunction(()=>document.querySelectorAll('#history-list li').length===40);
  assert.equal(new Set(await page.locator('#history-list li').evaluateAll(rows=>rows.map(r=>r.dataset.id))).size,40);
  const second=await context.newPage();await second.goto('http://stellive.test/');await second.locator('#hero-play:not([disabled])').waitFor();
  await second.evaluate(()=>{const k='stellive-watch-v2:/',data=JSON.parse(localStorage.getItem(k));data.records.zz000000000.position=81;data.records.zz000000000.updated=Date.now();localStorage.setItem(k,JSON.stringify(data));});
  await page.waitForTimeout(250);assert.equal(await page.locator('#history-list li').count(),40);
  await page.locator('#history-more').click();await page.waitForFunction(()=>document.querySelectorAll('#history-list li').length===45);
  const historyIDs=await page.locator('#history-list li').evaluateAll(rows=>rows.map(r=>r.dataset.id));
  assert.equal(new Set(historyIDs).size,45);assert.ok(historyIDs.includes('zz000000000'));
  assert.equal(await page.locator('#history-list a').count(),5);
  assert.equal(await page.locator('#history-more').isVisible(),false);
  assert.deepEqual(errors,[]);console.log('PASS: history retry without partial duplicates, 45 records paged, live position update retains 40 rows, unavailable records retain original links');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
