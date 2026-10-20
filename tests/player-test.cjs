/* Deterministic YouTube transport boundary test; no external playback required. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const root=path.resolve(process.env.TEST_DIR || 'dist');
  let version=1,delayB=false,releaseB;
  const ids=['aaaaaaaaaaa','bbbbbbbbbbb','ccccccccccc'];
  const row=(id,n)=>({id,title:'영상 '+n,channel:'test',published_utc:`2023-01-0${n}T00:00:00Z`,published_kst:`2023-01-0${n}T09:00:00+09:00`,duration:600,suggested:'include',reason:'자동 포함',embeddable:true,expires_utc:'2099-01-01T00:00:00Z'});
  const data=ids.map((id,i)=>row(id,i+1));
  const shards=v=>ids.map((id,i)=>({file:`shards/${v}-${i}.json`,count:1,first:data[i].published_utc,last:data[i].published_utc}));
  await context.route('http://stellive.test/**',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    const respond=obj=>route.fulfill({contentType:'application/json',body:JSON.stringify(obj)});
    if(pathname==='/data/manifest.json')return respond({schema:1,generated_utc:new Date().toISOString(),total:3,channels:[{key:'test',name:'테스트',group:'official',start:'2023-01-01',url:'https://www.youtube.com/'}],shards:shards(version)});
    if(pathname.startsWith('/data/lookup/'))return respond(Object.fromEntries(ids.map((id,i)=>[id,shards(version)[i].file])));
    if(pathname.startsWith('/data/shards/')){
      if(!pathname.startsWith('/data/shards/'+version+'-'))return route.fulfill({status:404,body:'old version'});
      const n=Number(pathname.match(/-(\d)\.json$/)[1]);
      if(delayB && n===1){delayB=false;await new Promise(resolve=>releaseB=resolve);}
      return respond([data[n]]);
    }
    const filename=path.join(root,pathname==='/'?'index.html':pathname);
    try{return await route.fulfill({body:fs.readFileSync(filename),contentType:{'.html':'text/html','.mjs':'application/javascript','.css':'text/css'}[path.extname(filename)]||'application/octet-stream'});}catch{return route.fulfill({status:404});}
  });
  await context.addInitScript(()=>{
    window.__players=[];
    window.YT={PlayerState:{PLAYING:1,PAUSED:2,ENDED:0},Player:class{
      constructor(id,options){this.options=options;this.position=options.playerVars.start||0;this.active=true;window.__players.push(this);setTimeout(()=>options.events.onReady({target:this}),0);}
      getVideoData(){return {video_id:this.options.videoId};}
      getCurrentTime(){return this.position;}
      playVideo(){this.options.events.onStateChange({target:this,data:1});}
      destroy(){this.active=false;}
      emit(name,data){this.options.events[name]({target:this,data});}
    }};
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://stellive.test/');await page.locator('#videos button').first().click();
  await page.waitForFunction(()=>window.__players.length===1);
  await page.evaluate(()=>{const p=window.__players.at(-1);p.position=37;p.emit('onStateChange',2);});
  await page.reload();await page.locator('#videos button').first().waitFor();await page.locator('#resume').click();
  await page.waitForFunction(()=>window.__players.length===1);
  assert.equal(await page.evaluate(()=>window.__players[0].options.playerVars.start),37);
  await page.evaluate(()=>window.__players.at(-1).emit('onError',153));
  assert.match(await page.locator('#player-message').innerText(),/153/);
  assert.match(await page.locator('#original').getAttribute('href'),/t=37s/);
  assert.doesNotMatch(await page.locator('#complete').innerText(),/完了|완료됨/);
  await page.evaluate(()=>window.__players.at(-1).emit('onAutoplayBlocked'));
  assert.match(await page.locator('#player-message').innerText(),/차단/);
  await page.locator('#next').click();await page.waitForFunction(()=>document.querySelector('#current-title').textContent==='영상 2');
  // A late end event from the destroyed player must not mark the new ID complete.
  await page.evaluate(()=>window.__players[0].emit('onStateChange',0));
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('stellive-watch-v2:/')).records['bbbbbbbbbbb'].completed),false);
  await page.locator('#complete').click();
  const second=await context.newPage();await second.goto('http://stellive.test/');await second.locator('#videos button').nth(1).click();
  await second.locator('#uncomplete').click();await page.waitForFunction(()=>document.querySelector('#complete').textContent==='시청 완료');
  // Deletion in another tab must stop this tab rather than resurrect the records.
  await second.evaluate(()=>localStorage.removeItem('stellive-watch-v2:/'));
  await page.waitForFunction(()=>document.querySelector('#current-title').textContent==='정주행을 시작해 볼까요');
  assert.equal(await page.evaluate(()=>localStorage.getItem('stellive-watch-v2:/')),null);
  // Uncached old shard after deploy refreshes the manifest and supports retry.
  await page.reload();await page.locator('#videos button').first().waitFor();
  await page.locator('#videos button').first().click();
  version=2;
  await page.locator('#next').click();
  await page.waitForFunction(()=>document.querySelector('#current-title').textContent==='영상 2',null,{timeout:3000});
  await page.reload();await page.locator('#videos button').first().waitFor();
  // Race: Next waits for a shard while user explicitly selects another row.
  await page.locator('#videos button').first().click();
  await page.route('http://stellive.test/data/lookup/aa.json',async route=>{await new Promise(r=>setTimeout(r,200));await route.continue();});
  await page.locator('#next').click();await page.locator('#videos button').nth(2).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#current-title').innerText(),'영상 3');
  assert.deepEqual(errors,[]);
  console.log('PASS: position 37s resume, error 153 fallback, autoplay blocked, stale player events, two-tab uncomplete/delete, navigation race');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
