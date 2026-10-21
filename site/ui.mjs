// Presentation only. Collection, playback and personal records stay in app.mjs.
const $=id=>document.getElementById(id);
let view='home',toastTimer,theme='system',onView=()=>{};
const themeKey='stellive-theme:'+location.pathname.replace(/index\.html$/,'');
const systemTheme=matchMedia('(prefers-color-scheme: dark)');
export function formatDuration(seconds){const n=Math.floor(Number(seconds)||0);return `${n>=3600?Math.floor(n/3600)+':':''}${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
const thumb=id=>`https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
function setTheme(value){
  theme=['system','light','dark'].includes(value)?value:'system';
  const dark=theme==='dark'||(theme==='system'&&systemTheme.matches);
  document.documentElement.dataset.theme=dark?'dark':'light';$('theme').value=theme;
  $('theme-toggle').setAttribute('aria-label',dark?'밝은 화면으로 전환':'어두운 화면으로 전환');
  $('theme-toggle').querySelector('use').setAttribute('href',dark?'#i-sun':'#i-moon');
  document.querySelector('meta[name=theme-color]').content=dark?'#111318':'#f7f8fa';
}
export function navigate(next,focus=true){
  if(!['home','library','history','settings'].includes(next))next='home';
  view=next;
  for(const name of ['home','library','history','settings'])$('view-'+name).hidden=name!==next;
  document.querySelectorAll('[data-nav]').forEach(button=>{if(button.dataset.nav===next)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  history.replaceState(null,'','#'+next);
  if(focus){scrollTo({top:0,behavior:'instant'});$('main').focus({preventScroll:true});}
  onView(next);
}
export const currentView=()=>view;
export function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
export function syncFilters(){
  const mode=$('mode').value,channel=$('channel'),year=$('year');
  document.querySelectorAll('[data-filter-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filterMode===mode)));
  $('active-filters').textContent=`${channel.selectedOptions[0]?.textContent||'모든 채널'} · ${year.value?year.value+'년':'모든 연도'}`;
  $('filter-dot').hidden=!channel.value&&!year.value&&['include','unwatched','review','all'].includes(mode);
  $('classification-hint').textContent={include:'일반 후보만 표시해요. 애매한 영상은 ‘검토 필요’에서 확인하세요.',unwatched:'일반 후보 중 아직 완료하지 않은 영상이에요.',review:'Shorts·다시보기 여부가 애매해요. 직접 확인하고 분류할 수 있어요.',exclude:'Shorts·풀버전 등 제외된 영상이에요. 오분류는 직접 되돌릴 수 있어요.',all:'모든 수집 영상을 표시해요. Shorts·다시보기 후보도 포함돼요.'}[mode];
}
export function openPlayer(){if(!$('watch-dialog').open)$('watch-dialog').showModal();$('session-dock').hidden=true;document.body.classList.add('watching');}
export function session(row){
  $('dock-title').textContent=row.title;$('dock-thumb').src=thumb(row.id);
  $('session-dock').hidden=$('watch-dialog').open;document.body.classList.add('has-session');
}
export function summary(manifest,records){
  const entries=Object.values(records),completed=entries.filter(r=>r.completed).length;
  $('home-completed').textContent=completed.toLocaleString();$('history-completed').textContent=completed.toLocaleString();
  $('home-continuing').textContent=entries.filter(r=>!r.completed).length.toLocaleString();
  if(!manifest)return;
  $('home-total').textContent=manifest.total.toLocaleString();$('home-channels').textContent=manifest.channels.filter(c=>c.enabled!==false).length;
  for(const kind of ['include','review'])$('home-'+kind+'-count').textContent=manifest.counts?.[kind]?.toLocaleString()??'보기';
}
export function hero(row,record,name){
  if(!row){$('hero-title').textContent='새로운 이야기를 기다리고 있어요';$('hero-meta').textContent='다른 분류의 영상도 둘러보세요.';$('hero-action').textContent='영상 보관함 보기';$('hero-play').disabled=false;$('hero-thumb').hidden=true;$('hero-art').hidden=false;$('hero-progress').hidden=true;$('hero-duration').hidden=true;return;}
  const resume=!!record&&!record.completed;
  $('hero-thumb').src=thumb(row.id);$('hero-thumb').hidden=false;$('hero-art').hidden=true;
  $('hero-thumb').onerror=()=>{$('hero-thumb').hidden=true;$('hero-art').hidden=false;};
  $('hero-label').textContent=resume?'보던 이야기, 계속해서':'나의 다음 이야기';
  $('hero-channel').textContent=name;$('hero-title').textContent=row.title;
  const date=new Date(Date.parse(row.published_utc)+9*3600000).toISOString().slice(0,10).replaceAll('-','.');
  $('hero-meta').textContent=resume?`${formatDuration(record.position)}부터 이어봐요 · ${date}`:date+' 공개 · 가장 오래된 미시청';
  $('hero-action').textContent=resume?'이어서 보기':'이 이야기부터 시작';$('hero-play').disabled=false;
  $('hero-duration').textContent=formatDuration(row.duration);$('hero-duration').hidden=false;
  $('hero-progress').hidden=!resume||!record.position;
  $('hero-progress-bar').style.width=Math.min(100,100*(record?.position||0)/Math.max(1,row.duration))+'%';
}
export function videoRow(row,{name,badge,current,completed,onSelect,month=''}){
  const li=document.createElement('li');li.className='video'+(current?' current':'')+(completed?' video-completed':'');li.dataset.id=row.id;li.videoRow=row;
  if(month){const label=document.createElement('span');label.className='month-label';label.textContent=month;li.append(label);}
  const button=document.createElement('button');button.className='video-select';button.onclick=onSelect;
  const preview=document.createElement('span');preview.className='video-thumb';
  const image=document.createElement('img');image.src=thumb(row.id);image.loading='lazy';image.alt='';image.onerror=()=>{image.hidden=true;};
  const duration=document.createElement('span');duration.className='duration-label';duration.textContent=formatDuration(row.duration);preview.append(image,duration);
  const body=document.createElement('span');body.className='video-content';
  const title=document.createElement('span');title.className='video-title';title.textContent=row.title;
  const meta=document.createElement('span');meta.className='video-meta';meta.textContent=`${name} · ${new Date(Date.parse(row.published_utc)+9*3600000).toISOString().slice(0,10).replaceAll('-','.')}`;
  const status=document.createElement('span');status.className='badges';status.textContent=badge;body.append(title,meta,status);button.append(preview,body);li.append(button);return li;
}
export function initUI(callbacks){
  onView=callbacks.onView;
  try{setTheme(localStorage.getItem(themeKey)||'system');}catch{setTheme('system');}
  systemTheme.addEventListener('change',()=>setTheme(theme));
  const rememberTheme=value=>{setTheme(value);try{localStorage.setItem(themeKey,theme);}catch{}};
  $('theme').onchange=()=>rememberTheme($('theme').value);
  $('theme-toggle').onclick=()=>rememberTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
  document.querySelectorAll('[data-nav],[data-go]').forEach(b=>b.onclick=()=>navigate(b.dataset.nav||b.dataset.go));
  document.querySelector('.wordmark').onclick=e=>{e.preventDefault();navigate('home');};
  $('header-search').onclick=()=>{navigate('library');$('search').focus();};
  document.querySelectorAll('[data-browse]').forEach(b=>b.onclick=()=>{navigate('library');$('mode').value=b.dataset.browse;callbacks.onFilter();});
  document.querySelectorAll('[data-filter-mode]').forEach(b=>b.onclick=()=>{$('mode').value=b.dataset.filterMode;callbacks.onFilter();});
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  $('filters-open').onclick=()=>$('filters-dialog').showModal();
  const reset=()=>{$('mode').value='include';$('channel').value='';$('year').value='';$('search').value='';callbacks.onFilter();};
  $('filters-reset').onclick=reset;$('reset-filters').onclick=reset;
  $('player-close').onclick=()=>$('watch-dialog').close();
  $('watch-dialog').addEventListener('close',()=>{if($('watch-dialog').open)return;document.body.classList.remove('watching');callbacks.onClosePlayer();});
  $('session-dock').onclick=callbacks.onOpenSession;
  $('hero-play').onclick=callbacks.onHero;
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}}));
  navigate(location.hash.slice(1),false);syncFilters();
}
