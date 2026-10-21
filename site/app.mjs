import {validateBackup,mergeRecords,syncRecords,classification,matches,kst,originalUrl,ID,historyEntries} from './core.mjs';
import * as ui from './ui.mjs';
const $=id=>document.getElementById(id);
const storageKey='stellive-watch-v2:'+location.pathname.replace(/index\.html$/,'');
let records=Object.create(null),manifest,channelNames={},current,player,ready=false,apiPromise,playerValid=false,generation=0,navGeneration=0;
const cache=new Map();let listCursor=0,scanRows=[],listEpoch=0,loading=false,shown=0;
let heroRow,homeGeneration=0,historyGeneration=0,historyMode='continue',historyOffset=0,historySnapshot=[],lastMonth='';
function notice(text){$('notice').textContent=text;$('notice').hidden=!text;if(text)ui.toast(text);}
function storageStatus(){ $('storage-status').textContent=`이 브라우저에 영상 ${Object.keys(records).length.toLocaleString()}개의 개인 기록 보관 중`; }
function persist(){
  try{localStorage.setItem(storageKey,JSON.stringify({schema:1,records}));storageStatus();ui.summary(manifest,records);if(heroRow?.id===current?.id)ui.hero(heroRow,records[heroRow.id],channelNames[heroRow.channel]||heroRow.channel);}
  catch{notice('브라우저에 기록을 저장할 수 없습니다. 비공개 모드·저장 공간을 확인하고 기록 백업을 해 주세요. 현재 탭의 기록은 유지됩니다.');}
}
try{const saved=localStorage.getItem(storageKey);if(saved)records=validateBackup(JSON.parse(saved));}
catch{notice('저장 기록을 읽지 못했습니다. 기존 저장 내용을 덮어쓰기 전에 백업 파일을 확인해 주세요.');}
storageStatus();
const options=()=>({mode:$('mode').value,channel:$('channel').value,query:$('search').value.trim(),year:$('year').value});
function visible(row){return Date.parse(row.expires_utc)>Date.now();}
async function fetchJSON(path){const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw Error(`목록 읽기 실패 (${r.status}). 네트워크를 확인하거나 페이지를 새로고침해 주세요.`);return r.json();}
async function refreshManifest(){
  manifest=await fetchJSON('./data/manifest.json');cache.clear();++listEpoch;loading=false;listCursor=0;scanRows=[];
  for(const channel of manifest.channels)channelNames[channel.key]=channel.name;
  $('total').textContent=manifest.total.toLocaleString()+'개 영상';$('sync-status').textContent='새 목록 갱신 '+kst(manifest.generated_utc);
  ui.summary(manifest,records);
  $('retry').hidden=false;$('retry').onclick=()=>loadMore(true);
}
async function shard(file){
  if(cache.has(file)){const rows=cache.get(file);cache.delete(file);cache.set(file,rows);return rows;}
  if(!/^shards\/[\w-]+\.json$/.test(file))throw Error('잘못된 목록 경로');
  const response=await fetch('./data/'+file,{cache:'no-store'});
  if(response.status===404){
    await refreshManifest();
    throw Error('자동 업데이트로 목록이 갱신됐습니다. 목록 다시 불러오기 또는 이동 버튼을 다시 눌러 주세요.');
  }
  if(!response.ok)throw Error('목록 조각을 읽지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.');
  const rows=await response.json();cache.set(file,rows);if(cache.size>8)cache.delete(cache.keys().next().value);return rows;
}
async function findVideo(id){
  if(!ID.test(id))return null;
  const response=await fetch('./data/lookup/'+id.slice(0,2).toLowerCase()+'.json',{cache:'no-store'});
  if(response.status===404)return null;if(!response.ok)throw Error('이어보기 목록을 읽지 못했습니다. 다시 시도해 주세요.');
  const index=await response.json();return index[id] ? (await shard(index[id])).find(v=>v.id===id && visible(v)) : null;
}
async function* iterate(){for(const s of manifest.shards){for(const row of await shard(s.file)){if(visible(row))yield row;}}}
function savePosition(){
  if(!current || !playerValid || !ready)return;
  if(player.getVideoData?.().video_id!==current.id)return;
  const position=player.getCurrentTime?.();
  if(Number.isFinite(position) && position>=0){records[current.id]={...records[current.id],position,updated:Date.now()};persist();updateOriginal();}
}
function updateOriginal(){$('original').href=originalUrl(current.id,records[current.id]?.position||0);}
function refreshDecision(){
  for(const button of document.querySelectorAll('[data-decision]'))button.setAttribute('aria-pressed',String(records[current.id]?.manual===button.dataset.decision));
  $('uncomplete').disabled=!records[current.id]?.completed;
  $('complete').textContent=records[current.id]?.completed?'시청 완료됨 ✓':'시청 완료';
  $('current-reason').textContent=current.reason||'자동 분류 근거가 없습니다.';
}
function ensureAPI(){
  if(window.YT?.Player)return Promise.resolve();
  if(apiPromise)return apiPromise;
  apiPromise=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{apiPromise=null;reject(Error('YouTube 플레이어 연결이 지연됩니다. 원본 링크를 이용하거나 영상을 다시 선택해 주세요.'));},15000);
    window.onYouTubeIframeAPIReady=()=>{clearTimeout(timer);resolve();};
    const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';
    script.onerror=()=>{clearTimeout(timer);apiPromise=null;script.remove();reject(Error('YouTube 플레이어를 불러올 수 없습니다. 원본 링크를 이용해 주세요.'));};document.head.append(script);
  });return apiPromise;
}
async function selectVideo(row){
  ++navGeneration;savePosition();const token=++generation;current=row;playerValid=false;
  ui.openPlayer();ui.session(row);
  // Replace each player so late events from the preceding video cannot overwrite this ID's progress.
  if(player){player.destroy();player=null;}ready=false;
  const mount=document.createElement('div');mount.id='player';$('player-shell').replaceChildren(mount);
  $('current-channel').textContent=channelNames[row.channel]||row.channel;
  $('current-title').textContent=row.title;$('current-meta').textContent=kst(row.published_utc)+' · '+formatDuration(row.duration);
  $('original').hidden=false;updateOriginal();$('player-message').textContent='불러오는 중… 재생되지 않으면 플레이어의 재생 버튼을 눌러 주세요.';
  for(const id of ['previous','next','complete'])$(id).disabled=false;
  $('classification').disabled=false;refreshDecision();
  records[row.id]={position:0,completed:false,...records[row.id],updated:Date.now()};persist();
  document.querySelectorAll('.video').forEach(li=>li.classList.toggle('current',li.dataset.id===row.id));
  if(!row.embeddable){$('player-message').textContent='퍼가기가 제한된 영상입니다. YouTube 원본 링크에서 시청해 주세요.';return;}
  try{
    await ensureAPI();if(token!==generation)return;
    const start=Math.floor(records[row.id]?.position||0);
    player=new YT.Player('player',{width:'100%',height:'100%',videoId:row.id,playerVars:{playsinline:1,autoplay:0,start,origin:location.origin},events:{
      onReady:event=>{if(token!==generation)return;ready=true;if($('watch-dialog').open)event.target.playVideo();$('player-message').textContent='재생되지 않으면 플레이어의 재생 버튼을 눌러 주세요.';},
      onStateChange:event=>{
        if(token!==generation || event.target.getVideoData?.().video_id!==current?.id)return;
        if(event.data===YT.PlayerState.PLAYING){playerValid=true;if(!$('watch-dialog').open){event.target.pauseVideo?.();return;}$('player-message').textContent='';}
        if(event.data===YT.PlayerState.PAUSED)savePosition();
        if(event.data===YT.PlayerState.ENDED && $('watch-dialog').open){savePosition();markComplete(true);if($('autonext').checked)move(1).catch(showError);}
      },
      onError:event=>{if(token!==generation)return;playerValid=false;const reasons={2:'잘못된 영상 요청',5:'브라우저 재생 오류',100:'삭제 또는 비공개',101:'퍼가기 제한',150:'퍼가기 제한',153:'브라우저의 Referer/사이트 식별 차단'};$('player-message').textContent=`${reasons[event.data]||'재생 오류'} (${event.data}). 아래 YouTube 원본 링크를 이용해 주세요. 완료로 자동 처리하지 않습니다.`;},
      onAutoplayBlocked:()=>{if(token===generation)$('player-message').textContent='자동재생이 차단됐습니다. 플레이어의 ▶ 버튼을 눌러 재생하세요.';}
    }});
  }catch(e){if(token===generation)$('player-message').textContent=e.message;}
}
function markComplete(value){
  if(!current)return;savePosition();records[current.id]={...records[current.id],completed:value,updated:Date.now()};persist();refreshDecision();
  updateBadges();refreshHome().catch(showError);if(ui.currentView()==='history')loadHistory(true).catch(showError);ui.toast(value?'시청 기록에 한 편 더 쌓였어요':'시청 완료를 취소했어요');
}
async function move(direction){
  if(!current)return;const selected=current.id,request=++navGeneration;
  const index=await fetchJSON('./data/lookup/'+selected.slice(0,2).toLowerCase()+'.json');if(request!==navGeneration)return;
  let shardIndex=manifest.shards.findIndex(s=>s.file===index[selected]);
  if(shardIndex<0){await refreshManifest();if(request!==navGeneration)return;shardIndex=manifest.shards.findIndex(s=>s.file===index[selected]);}
  if(shardIndex<0)throw Error('현재 영상이 갱신된 목록에 없습니다. 가장 오래된 미시청 또는 목록을 선택해 주세요.');
  let found=false;
  for(let i=shardIndex;i>=0 && i<manifest.shards.length;i+=direction){
    const rows=await shard(manifest.shards[i].file);if(request!==navGeneration)return;
    const ordered=direction>0?rows:[...rows].reverse();
    for(const row of ordered){
      if(row.id===selected){found=true;continue;}
      if(found && visible(row) && matches(row,records,options())){await selectVideo(row);return;}
    }
  }
  $('player-message').textContent='현재 필터에서 이동할 영상이 없습니다. 원본 시청 후에는 완료 버튼을 눌러 주세요.';
}
const formatDuration=ui.formatDuration;
function badges(v){const r=records[v.id];return `${{include:'일반 영상',review:'검토 필요',exclude:'제외됨'}[classification(v,records)]} · ${r?.completed?'시청 완료 ✓':r?.position?'이어보기 '+formatDuration(Math.floor(r.position)):'미시청'}`;}
function addRow(row){
  const date=new Date(Date.parse(row.published_utc)+9*3600000).toISOString().slice(0,7),month=date!==lastMonth?date.replace('-','년 ')+'월':'';lastMonth=date;++shown;
  $('videos').append(makeRow(row,month));
}
function makeRow(row,month=''){return ui.videoRow(row,{name:channelNames[row.channel]||row.channel,badge:badges(row),current:current?.id===row.id,completed:records[row.id]?.completed,onSelect:()=>selectVideo(row).catch(showError),month});}
function updateBadges(){document.querySelectorAll('.video').forEach(li=>{if(!li.videoRow)return;li.querySelector('.badges').textContent=badges(li.videoRow);li.classList.toggle('video-completed',!!records[li.dataset.id]?.completed);});}
async function refreshHome(){
  if(!manifest)return;const request=++homeGeneration;ui.summary(manifest,records);
  for(const {id} of historyEntries(records)){
    const row=await findVideo(id);if(request!==homeGeneration)return;
    if(row){heroRow=row;ui.hero(row,records[id],channelNames[row.channel]||row.channel);return;}
  }
  for await(const row of iterate()){
    if(request!==homeGeneration)return;
    if(classification(row,records)==='include'&&!records[row.id]?.completed){heroRow=row;ui.hero(row,records[row.id],channelNames[row.channel]||row.channel);return;}
  }
  heroRow=null;ui.hero(null);
}
async function loadHistory(reset=false){
  if(!manifest)return;
  if(reset){++historyGeneration;historyOffset=0;historySnapshot=historyEntries(records,historyMode);$('history-list').replaceChildren();}
  const request=historyGeneration,entries=historySnapshot,page=entries.slice(historyOffset,historyOffset+20);
  $('history-more').hidden=true;$('history-more').disabled=true;$('history-status').textContent='기록을 불러오고 있어요';
  try{
    const fragment=document.createDocumentFragment();
    for(const entry of page){
      const row=await findVideo(entry.id);if(request!==historyGeneration)return;
      if(row)fragment.append(makeRow(row));
      else{
        const li=document.createElement('li');li.className='video';li.dataset.id=entry.id;const link=document.createElement('a');link.className='video-select';link.href=originalUrl(entry.id,entry.position);link.target='_blank';link.rel='noopener';
        const body=document.createElement('span');body.className='video-content';const title=document.createElement('span');title.className='video-title';title.textContent='현재 목록에 없는 영상';const note=document.createElement('span');note.className='badges';note.textContent=`${entry.id} · ${entry.completed?'시청 완료':'이어보기 '+formatDuration(entry.position)} · YouTube에서 확인`;body.append(title,note);link.append(body);li.append(link);fragment.append(li);
      }
    }
    $('history-list').append(fragment);historyOffset+=page.length;$('history-status').textContent=`${entries.length.toLocaleString()}개 기록 · 최근 시청 순`;$('history-empty').hidden=entries.length>0;$('history-more').hidden=historyOffset>=entries.length;
  }catch(e){if(request===historyGeneration){$('history-status').textContent='기록을 불러오지 못했어요. 다시 눌러 주세요.';$('history-more').hidden=false;throw e;}}
  finally{if(request===historyGeneration)$('history-more').disabled=false;}
}
async function loadMore(reset=false){
  if(!manifest)return;if(loading && !reset)return;
  if(reset){++listEpoch;listCursor=0;scanRows=[];shown=0;$('videos').replaceChildren();}
  lastMonth='';$('list-empty').hidden=true;$('videos').setAttribute('aria-busy','true');
  const epoch=listEpoch;loading=true;$('more').hidden=true;$('retry').hidden=true;$('list-status').textContent='공개시각 순으로 목록을 확인하는 중…';
  if(!reset){$('videos').replaceChildren();shown=0;}
  let count=0;
  try{
    while(count<50){
      if(epoch!==listEpoch)return;
      if(!scanRows.length){
        if(listCursor>=manifest.shards.length)break;
        const descriptor=manifest.shards[listCursor],year=$('year').value;
        if(year){
          const from=Date.parse(year+'-01-01T00:00:00+09:00'),until=Date.parse((Number(year)+1)+'-01-01T00:00:00+09:00');
          if(Date.parse(descriptor.last)<from||Date.parse(descriptor.first)>=until){listCursor++;continue;}
        }
        const rows=await shard(manifest.shards[listCursor].file);if(epoch!==listEpoch)return;listCursor++;scanRows=[...rows];
      }
      const row=scanRows.shift();if(visible(row) && matches(row,records,options())){addRow(row);count++;}
    }
    $('list-status').textContent=count?`${count}개 표시 · KST 공개시각 순 · 다음 페이지로 교체돼요`:'현재 조건에 맞는 영상이 없습니다.';
    $('list-empty').hidden=count>0;
    $('more').hidden=!(scanRows.length || listCursor<manifest.shards.length);
  }catch(e){if(epoch===listEpoch){showError(e);$('list-status').textContent='목록을 불러오지 못했어요. 다시 시도해 주세요.';$('retry').hidden=false;}}
  finally{if(epoch===listEpoch){loading=false;$('videos').setAttribute('aria-busy','false');}}
}
function showError(error){const message=error.message||String(error);notice(message);if($('watch-dialog').open)$('player-message').textContent=message;}
function download(name,obj){const url=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function filterChanged(){ui.syncFilters();loadMore(true);}
for(const id of ['mode','channel','year'])$(id).onchange=filterChanged;
let searchTimer;$('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(filterChanged,350);};
$('more').onclick=()=>loadMore();$('retry').onclick=()=>loadMore(true);
$('previous').onclick=()=>move(-1).catch(showError);$('next').onclick=()=>move(1).catch(showError);
$('complete').onclick=()=>markComplete(true);$('uncomplete').onclick=()=>markComplete(false);
$('oldest').onclick=async()=>{const request=++navGeneration;try{for await(const row of iterate()){if(request!==navGeneration)return;if(classification(row,records)==='include' && !records[row.id]?.completed){await selectVideo(row);return;}}notice('현재 수집 목록의 일반 영상은 모두 시청했습니다. 검토 필요 목록도 확인해 주세요.');}catch(e){showError(e);}};
$('resume').onclick=async()=>{const request=++navGeneration;try{savePosition();for(const {id} of historyEntries(records)){const row=await findVideo(id);if(request!==navGeneration)return;if(row){await selectVideo(row);return;}}notice('이어볼 미완료 영상이 없습니다. 가장 오래된 미시청에서 시작해 주세요.');}catch(e){showError(e);}};
document.querySelectorAll('[data-decision]').forEach(button=>button.onclick=()=>{if(!current)return;records[current.id]={...records[current.id],manual:button.dataset.decision,updated:Date.now()};persist();refreshDecision();loadMore(true);refreshHome().catch(showError);ui.toast('이 브라우저에 분류를 저장했어요');});
$('export').onclick=()=>{savePosition();download('stellive-progress-'+new Date().toISOString().slice(0,10)+'.json',{schema:1,records});};
$('export-overrides').onclick=()=>download('overrides.json',Object.fromEntries(Object.entries(records).filter(([,r])=>r.manual && r.manual!=='auto').map(([id,r])=>[id,r.manual])));
$('import').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>20*1024*1024)throw Error('백업 파일은 20MB 이하여야 합니다.');const incoming=validateBackup(JSON.parse(await file.text()));savePosition();records=mergeRecords(records,incoming);persist();if(current)refreshDecision();await loadMore(true);await refreshHome();notice('기록 복원을 완료했습니다. 재생 중인 영상은 다시 선택하면 복원 위치에서 시작합니다.');}catch(e){showError(e);}finally{event.target.value='';}};
$('clear').onclick=()=>{if(!confirm('이 사이트의 시청 기록과 수동 분류를 삭제할까요? 삭제 전에 백업을 권장합니다. YouTube 기록에는 영향이 없습니다.'))return;generation++;player?.destroy();player=null;current=null;playerValid=false;records=Object.create(null);localStorage.removeItem(storageKey);location.reload();};
window.addEventListener('pagehide',savePosition);document.addEventListener('visibilitychange',()=>{if(document.hidden)savePosition();});setInterval(savePosition,5000);
window.addEventListener('storage',event=>{
  if(event.key!==storageKey && event.key!==null)return;
  if(!event.newValue){++generation;++navGeneration;player?.destroy();player=null;current=null;playerValid=false;records=Object.create(null);location.reload();return;}
  try{
    const incoming=validateBackup(JSON.parse(event.newValue));
    const filterChanged=Object.entries(incoming).some(([id,row])=>(row.updated>=(records[id]?.updated||0)) && (row.manual!==records[id]?.manual || ($('mode').value==='unwatched' && row.completed!==Boolean(records[id]?.completed))));
    const historyChanged=Object.entries(incoming).some(([id,row])=>!records[id]||(row.updated>=records[id].updated&&row.completed!==records[id].completed));
    records=syncRecords(records,incoming);storageStatus();ui.summary(manifest,records);if(current)refreshDecision();
    if(filterChanged)loadMore(true);
    else updateBadges();
    if(historyChanged){refreshHome().catch(showError);if(ui.currentView()==='history')loadHistory(true).catch(showError);}
    else if(heroRow)ui.hero(heroRow,records[heroRow.id],channelNames[heroRow.channel]||heroRow.channel);
  }catch{}
});
ui.initUI({onFilter:filterChanged,onView:view=>{if(view==='home')refreshHome().catch(showError);if(view==='history')loadHistory(true).catch(showError);},onHero:()=>heroRow?selectVideo(heroRow).catch(showError):ui.navigate('library'),onClosePlayer:()=>{++navGeneration;player?.pauseVideo?.();savePosition();if(current)ui.session(current);refreshHome().catch(showError);if(ui.currentView()==='history')loadHistory(true).catch(showError);},onOpenSession:()=>{if(!current)return;ui.openPlayer();if(ready)player?.playVideo?.();}});
$('history-more').onclick=()=>loadHistory().catch(showError);
document.querySelectorAll('[data-history-mode]').forEach(button=>button.onclick=()=>{historyMode=button.dataset.historyMode;document.querySelectorAll('[data-history-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));loadHistory(true).catch(showError);});
async function boot(){
  manifest=await fetchJSON('./data/manifest.json');if(manifest.schema!==1)throw Error('목록 버전이 맞지 않습니다. 페이지를 새로고침하세요.');
  $('total').textContent=manifest.total.toLocaleString()+'개 영상';
  $('sync-status').textContent=`목록 생성 ${kst(manifest.generated_utc)} · ${manifest.channels.filter(c=>c.enabled!==false).length}개 수집 대상 채널`;
  if(Date.now()-Date.parse(manifest.generated_utc)>86400000*2)notice('자동 업데이트가 2일 이상 지연됐습니다. GitHub Actions 실행 상태를 확인하세요. 29일이 지난 영상 정보는 숨겨집니다.');
  else if(manifest.errors || manifest.budget_reached)notice('일부 수집이 미완료입니다. 기존 목록은 유지되며 다음 자동 실행에서 이어집니다. 채널별 상태를 확인하세요.');
  for(const ch of manifest.channels){
    channelNames[ch.key]=ch.name;
    const option=document.createElement('option');option.value=ch.key;option.textContent=ch.name;$('channel').append(option);
    const card=document.createElement('div');card.className='channel-card';const link=document.createElement('a');
    link.textContent=`${{official:'공식',member:'멤버',fan:'팬·관련'}[ch.group]} · ${ch.name}`;
    const url=ch.url||'';if(/^https:\/\/(www\.)?youtube\.com\//.test(url))link.href=url;link.target='_blank';link.rel='noopener';
    const info=document.createElement('p');info.textContent=`${ch.start||'시작 제한 없음'} ~ ${ch.end||'계속'} (KST) · ${ch.enabled===false?'수집 중지':ch.pending?'소급 수집 진행 중':ch.last_success?'마지막 전체 수집 '+kst(ch.last_success):'아직 수집 전'}`;
    const code=document.createElement('code');code.textContent=ch.channel_id||'고유 ID 미확인: 첫 API 조회 시 확인';
    const note=document.createElement('p');note.textContent=[ch.note,ch.error].filter(Boolean).join(' · ');card.append(link,info,code,note);$('channels').append(card);
  }
  if(manifest.shards.length){
    const start=new Date(Date.parse(manifest.shards[0].first)+9*3600000).getUTCFullYear(),end=new Date(Date.parse(manifest.shards.at(-1).last)+9*3600000).getUTCFullYear();
    for(let year=start;year<=end;year++){const option=document.createElement('option');option.value=year;option.textContent=year+'년';$('year').append(option);}
  }
  ui.summary(manifest,records);refreshHome().catch(showError);if(ui.currentView()==='history')loadHistory(true).catch(showError);
  await loadMore(true);
}
boot().catch(e=>{showError(e);$('list-status').textContent='목록을 불러오지 못했습니다.';$('retry').hidden=false;$('retry').onclick=()=>location.reload();$('hero-title').textContent='연결을 잠시 확인해 주세요';$('hero-meta').textContent='영상 목록을 가져오지 못했어요. 다시 시도할 수 있어요.';$('hero-action').textContent='다시 불러오기';$('hero-play').disabled=false;$('hero-play').onclick=()=>location.reload();});
