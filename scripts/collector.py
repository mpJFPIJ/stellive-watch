"""Public metadata collector. Standard library only; never downloads media."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

UTC = timezone.utc
KST = timezone(timedelta(hours=9))
MAX_AGE = timedelta(days=29)
VIDEO_ID = re.compile(r'^[A-Za-z0-9_-]{11}$')
CHANNEL_ID = re.compile(r'^UC[A-Za-z0-9_-]{22}$')
VOD = re.compile(r'풀영상|풀버전|풀\s*다시보기|무편집|노컷|다시보기|방송\s*전체|\bvod\b|\bfull\s*(stream|vod|archive)\b',re.I)
FAN = re.compile(r'스텔라이브|스텔라|칸나|유니|후야|히나|마시로|리제|타비|시부키|아오쿠모|하나코|나나|리코|토아|코가네|히요리|메리|\b린\b|\b랑\b',re.I)
MUSIC = re.compile(r'\bcover\b|커버|뮤직\s*비디오|music\s*video|\bM/?V\b|歌ってみた',re.I)
BROADCAST = re.compile(r'노래방|歌枠|karaoke|雑談|잡담|방송|\bstream\b|配信|합방',re.I)
RELATED = re.compile(r'스텔\s*라이브|\bstellive\b|아이리\s*칸나|airi\s*kanna|藍璃かんな|아야츠노\s*유니|ayatsuno\s*yuni|사키하네\s*후야|sakihane\s*huya|시라유키\s*히나|shirayuki\s*hina|네네코\s*마시로|neneko\s*mashiro|아카네\s*리제|akane\s*lize|아라하시\s*타비|arahashi\s*tabi|텐코\s*시부키|tenko\s*shibuki|아오쿠모\s*린|aokumo\s*rin|하나코\s*나나|hanako\s*nana|유즈하\s*리코|yuzuha\s*riko|시즈키\s*토아|shizuki\s*toa|코가네\s*랑|cogane\s*rang|하나요\s*히요리|hanayo\s*hiyori|토키노\s*메리|tokino\s*mary',re.I)

def parse(value):
    result = datetime.fromisoformat(value.replace('Z','+00:00'))
    if result.tzinfo is None: raise ValueError('시간대 없는 시각')
    return result.astimezone(UTC)

def now_iso(): return datetime.now(UTC).isoformat(timespec='seconds')
def empty_state(): return {'schema':1,'channels':{}}

def atomic_json(path, obj):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(obj,ensure_ascii=False,separators=(',',':')),encoding='utf-8');tmp.replace(path)

def load_channels(path):
    configs=json.loads(Path(path).read_text(encoding='utf-8-sig'))
    keys=set()
    for cfg in configs:
        key=cfg['key']
        if not re.fullmatch(r'[a-z0-9_]+',key) or key in keys: raise ValueError('채널 key 중복/형식 오류')
        keys.add(key)
        if cfg['group'] not in ('official','member','fan'): raise ValueError('group 오류')
        if cfg.get('relevance','all') not in ('all','metadata','title'): raise ValueError('relevance 오류')
        if cfg.get('channel_id'):
            if not CHANNEL_ID.fullmatch(cfg['channel_id']): raise ValueError(f'{key}: 채널 ID 형식 오류')
        elif not re.fullmatch(r'@[\w.-]+',cfg.get('handle','')): raise ValueError(f'{key}: 채널 ID 또는 handle 필요')
        for field in ('start','end'):
            if cfg.get(field): datetime.strptime(cfg[field],'%Y-%m-%d')
        if cfg.get('start','')>cfg.get('end','9999-12-31'): raise ValueError('활동 기간 오류')
    return configs

def in_period(published,cfg):
    day=parse(published).astimezone(KST).date().isoformat()
    return cfg.get('start','0001-01-01')<=day<=cfg.get('end','9999-12-31')

def in_scope(sn,cfg):
    mode=cfg.get('relevance','all')
    if mode=='all':return True
    text=sn.get('title','')
    if mode=='metadata':text+='\n'+sn.get('description','')+'\n'+' '.join(sn.get('tags',[]))
    return bool(RELATED.search(text))

def duration(value):
    m=re.fullmatch(r'P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?',value or '')
    return sum(int(x or 0)*factor for x,factor in zip(m.groups(),[86400,3600,60,1])) if m else 0

def classify(item,group):
    sn=item.get('snippet',{});title=sn.get('title','');text=title+'\n'+sn.get('description','')[:2000]
    if re.search(r'(?<!\w)#shorts\b',title,re.I) or any(str(t).lower()=='shorts' for t in sn.get('tags',[])):
        return 'exclude','#shorts 표기: 수동 복구 가능'
    reasons=[]
    # Public before the three-minute change means uploaded before it too.
    # Use a one-day buffer because the announced rollout date has no timezone.
    published=sn.get('publishedAt')
    short_limit=60 if published and parse(published)<datetime(2024,10,14,tzinfo=UTC) else 180
    if duration(item.get('contentDetails',{}).get('duration'))<=short_limit: reasons.append(f'{short_limit}초 이하: Shorts 여부 확인')
    # Description footers often link another channel's VODs; that is not this video's format.
    if VOD.search(title): reasons.append('제목에 풀버전/VOD 표시: 편집본인지 확인')
    live=item.get('liveStreamingDetails',{})
    music_release=bool(MUSIC.search(title) and not BROADCAST.search(title) and live.get('actualEndTime'))
    # Music premieres also carry liveStreamingDetails; do not mistake them for full streams.
    if live.get('actualStartTime') and not music_release: reasons.append('라이브 메타데이터: 편집 여부 확인')
    if sn.get('liveBroadcastContent') in ('live','upcoming'): reasons.append('진행 중/예정 방송')
    if group=='fan' and not (FAN.search(text) or in_scope(sn,{'relevance':'metadata'})): reasons.append('스텔라이브 관련성 확인')
    return ('review','; '.join(reasons)) if reasons else ('include','자동 포함 후보: 내용 확인은 별도')

class ApiError(Exception): pass
class BudgetReached(Exception): pass

class YouTubeClient:
    def __init__(self,key,max_calls=1800): self.key=key;self.max_calls=max_calls;self.calls=0
    def get(self,endpoint,**query):
        # Header rather than URL: avoid leaking keys via URL/log exceptions.
        url='https://www.googleapis.com/youtube/v3/'+endpoint+'?'+urlencode(query)
        for attempt in range(4):
            if self.calls>=self.max_calls: raise BudgetReached()
            self.calls+=1
            try:
                request=Request(url,headers={'X-Goog-Api-Key':self.key,'User-Agent':'StelliveMobile/2.0'})
                with urlopen(request,timeout=30) as response: return json.load(response)
            except HTTPError as exc:
                if exc.code in (429,500,502,503,504) and attempt<3:
                    time.sleep(2**attempt);continue
                # Never emit raw response bodies, URLs, or request headers.
                try: reason=json.loads(exc.read(4000)).get('error',{}).get('errors',[{}])[0].get('reason','unknown')
                except (ValueError,IndexError,TypeError): reason='unknown'
                allowed={'quotaExceeded','dailyLimitExceeded','keyInvalid','accessNotConfigured','forbidden','playlistNotFound','invalidPageToken'}
                raise ApiError(f'HTTP {exc.code}: {reason if reason in allowed else "API 요청 실패"}') from None
            except (URLError,TimeoutError):
                if attempt<3: time.sleep(2**attempt);continue
                raise ApiError('네트워크 연결 실패') from None

def fresh(row,now):
    try: return timedelta(0)<=parse(now)-parse(row['refreshed_utc'])<MAX_AGE
    except (ValueError,KeyError,TypeError): return False

def sync(state,configs,client,now=None,budget=1800,checkpoint=None):
    now=now or now_iso();used=0;errors=0
    def get(endpoint,**kwargs):
        nonlocal used
        if used>=budget: raise BudgetReached()
        used+=1
        return client.get(endpoint,**kwargs)
    active={cfg['key'] for cfg in configs if cfg.get('enabled',True)}
    state['channels']={key:val for key,val in state['channels'].items() if key in active}
    for ch in state['channels'].values():
        ch['videos']={vid:row for vid,row in ch.get('videos',{}).items() if fresh(row,now)}
    # Least recently completed channel first prevents large/new channels starving others.
    ordered=sorted((cfg for cfg in configs if cfg.get('enabled',True)),key=lambda cfg:state['channels'].get(cfg['key'],{}).get('last_success',''))
    for cfg in ordered:
        ch=state['channels'].setdefault(cfg['key'],{'videos':{}})
        fingerprint=hashlib.sha256(json.dumps(cfg,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        pending=ch.get('pending')
        if pending and (pending['fingerprint']!=fingerprint or parse(now)-parse(pending['started'])>timedelta(days=1)):
            ch.pop('pending',None);pending=None
        try:
            if pending is None:
                lookup={'id':cfg['channel_id']} if cfg.get('channel_id') else {'forHandle':cfg['handle']}
                result=get('channels',part='snippet,contentDetails',**lookup).get('items',[])
                if len(result)!=1: raise ApiError('채널을 찾을 수 없음: ID/핸들 확인 필요')
                found=result[0]
                if cfg.get('channel_id') and found['id']!=cfg['channel_id']: raise ApiError('채널 ID 불일치')
                pending={'fingerprint':fingerprint,'started':now,'token':'','videos':{},'channel_id':found['id'],'playlist':found['contentDetails']['relatedPlaylists']['uploads']}
                ch['pending']=pending
            while True:
                page=get('playlistItems',part='contentDetails',playlistId=pending['playlist'],maxResults=50,pageToken=pending['token'])
                ids=list(dict.fromkeys(x.get('contentDetails',{}).get('videoId','') for x in page.get('items',[])))
                ids=[vid for vid in ids if VIDEO_ID.fullmatch(vid)]
                batch=get('videos',part='snippet,contentDetails,status,liveStreamingDetails',id=','.join(ids)) if ids else {'items':[]}
                for item in batch.get('items',[]):
                    sn=item.get('snippet',{});vid=item['id'];published=sn.get('publishedAt')
                    if vid not in ids or not published or sn.get('channelId')!=pending['channel_id']: continue
                    if item.get('status',{}).get('privacyStatus','public')!='public' or not in_period(published,cfg) or not in_scope(sn,cfg): continue
                    suggested,reason=classify(item,cfg['group'])
                    pending['videos'][vid]={'id':vid,'channel':cfg['key'],'published_utc':parse(published).isoformat(timespec='seconds'),'title':sn.get('title',''),'duration':duration(item.get('contentDetails',{}).get('duration')),'suggested':suggested,'reason':reason,'embeddable':bool(item.get('status',{}).get('embeddable',True)),'refreshed_utc':now}
                token=page.get('nextPageToken','')
                if not token:
                    ch['videos']=pending['videos'];ch['channel_id']=pending['channel_id'];ch['last_success']=now;ch['error']='';ch.pop('pending',None)
                    if checkpoint: checkpoint(state)
                    break
                if token==pending['token']: raise ApiError('동일 pageToken 반복: 전체 수집 미완료')
                pending['token']=token
                if checkpoint: checkpoint(state)
        except BudgetReached:
            state['budget_reached']=True;break
        except ApiError as exc:
            ch['error']=str(exc);errors+=1
            if 'invalidPageToken' in str(exc): ch.pop('pending',None)
            if checkpoint: checkpoint(state)
            if 'quotaExceeded' in str(exc) or 'dailyLimitExceeded' in str(exc): break
    else: state['budget_reached']=False
    state['updated_utc']=now;state['requests']=getattr(client,'calls',used);state['errors']=errors
    return state

def main():
    p=argparse.ArgumentParser();p.add_argument('--channels',default='channels.json');p.add_argument('--state',default='.state/state.json');p.add_argument('--budget',type=int,default=1800)
    args=p.parse_args();key=os.environ.get('YOUTUBE_API_KEY','').strip()
    if not key: raise SystemExit('GitHub Secrets에 YOUTUBE_API_KEY를 설정하세요.')
    state=json.loads(Path(args.state).read_text(encoding='utf-8')) if Path(args.state).exists() else empty_state()
    if state.get('schema')!=1: raise SystemExit('지원하지 않는 state schema')
    try: sync(state,load_channels(args.channels),YouTubeClient(key,max_calls=args.budget),budget=args.budget,checkpoint=lambda s:atomic_json(args.state,s))
    finally: atomic_json(args.state,state)
    print(json.dumps({k:state.get(k) for k in ('updated_utc','requests','errors','budget_reached')},ensure_ascii=False))
    if state.get('errors'): print('::warning::일부 채널 수집 실패. 사이트의 채널 상태를 확인하세요.')

if __name__=='__main__': main()
