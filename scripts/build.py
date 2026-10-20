"""Build only allow-listed public data; user progress never enters dist."""
import argparse
import hashlib
import json
import shutil
from collections import defaultdict
from datetime import timedelta
from pathlib import Path
try:
    from . import collector as c
except ImportError:
    import collector as c

ROOT=Path(__file__).resolve().parent.parent

def build_site(state,configs,overrides,dest,now=None,shard_size=500):
    now=now or c.now_iso();dest=Path(dest)
    if not 1<=shard_size<=1000: raise ValueError('shard size 오류')
    dest.mkdir(parents=True,exist_ok=True)
    data=dest/'data'
    if data.exists(): shutil.rmtree(data)
    data.mkdir()
    shutil.copytree(ROOT/'site',dest,dirs_exist_ok=True)
    (dest/'.nojekyll').write_text('',encoding='utf-8')
    rows=[];channels=[];lookup=defaultdict(dict)
    for cfg in configs:
        ch=state.get('channels',{}).get(cfg['key'],{})
        channels.append({**{k:cfg[k] for k in ('key','name','group','url','start','end','note','related_members','enabled') if k in cfg},'channel_id':ch.get('channel_id',cfg.get('channel_id','')),'last_success':ch.get('last_success'),'error':ch.get('error',''),'pending':bool(ch.get('pending')),'count':len(ch.get('videos',{}))})
        if not cfg.get('enabled',True): continue
        for row in ch.get('videos',{}).values():
            if not c.fresh(row,now) or not c.in_period(row['published_utc'],cfg): continue
            public={k:row[k] for k in ('id','channel','published_utc','title','duration','suggested','reason','embeddable','refreshed_utc')}
            public['published_kst']=c.parse(row['published_utc']).astimezone(c.KST).isoformat(timespec='seconds')
            public['expires_utc']=(c.parse(row['refreshed_utc'])+c.MAX_AGE).isoformat(timespec='seconds')
            decision=overrides.get(row['id'])
            if decision in ('include','exclude','review'): public['manual']=decision
            rows.append(public)
    rows.sort(key=lambda r:(c.parse(r['published_utc']),r['id']))
    descriptors=[]
    for at in range(0,len(rows),shard_size):
        chunk=rows[at:at+shard_size]
        digest=hashlib.sha256(json.dumps(chunk,ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:16]
        file=f'shards/{at//shard_size:05d}-{digest}.json';c.atomic_json(data/file,chunk)
        descriptors.append({'file':file,'count':len(chunk),'first':chunk[0]['published_utc'],'last':chunk[-1]['published_utc']})
        for row in chunk: lookup[row['id'][:2]][row['id']]=file
    for prefix,index in lookup.items(): c.atomic_json(data/f'lookup/{prefix}.json',index)
    c.atomic_json(data/'manifest.json',{'schema':1,'generated_utc':now,'generated_kst':c.parse(now).astimezone(c.KST).isoformat(timespec='seconds'),'total':len(rows),'shards':descriptors,'channels':channels,'errors':state.get('errors',0),'budget_reached':state.get('budget_reached',False)})
    print(f'정적 빌드: {len(rows)}개 영상 / {len(descriptors)}개 샤드')

def main():
    p=argparse.ArgumentParser();p.add_argument('--state',default='.state/state.json');p.add_argument('--out',default='dist');args=p.parse_args()
    state=json.loads(Path(args.state).read_text(encoding='utf-8')) if Path(args.state).exists() else c.empty_state()
    overrides=json.loads((ROOT/'overrides.json').read_text(encoding='utf-8'))
    if any(not c.VIDEO_ID.fullmatch(k) or v not in ('include','exclude','review') for k,v in overrides.items()): raise SystemExit('overrides.json 형식 오류')
    build_site(state,c.load_channels(ROOT/'channels.json'),overrides,args.out)

if __name__=='__main__': main()
