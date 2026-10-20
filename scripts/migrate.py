"""Optional one-time migration. Stop the old local server first."""
import argparse
import json
import sqlite3
from pathlib import Path
try:
    from . import collector as c
except ImportError:
    import collector as c

def migrate(database,configs,state_path,progress_path):
    # immutable read-only avoids creating WAL/SHM files beside the user's original DB.
    uri=Path(database).resolve().as_uri()+'?mode=ro&immutable=1'
    db=sqlite3.connect(uri,uri=True);db.row_factory=sqlite3.Row
    state=c.empty_state();records={};config={cfg['key']:cfg for cfg in configs}
    try:
        for ch in db.execute('SELECT * FROM channels'):
            key=ch['channel_key']
            if key in config: state['channels'][key]={'videos':{},'channel_id':ch['channel_id'],'last_success':ch['last_success'],'error':ch['last_error'] or ''}
        for row in db.execute('SELECT * FROM videos'):
            vid=row['video_id']
            if row['manual']: records[vid]={'position':0,'completed':False,'updated':0,'manual':row['manual']}
            key=row['channel_key']
            if key not in state['channels'] or row['status']!='available' or not row['published_utc']: continue
            data={'id':vid,'channel':key,'published_utc':row['published_utc'],'title':row['title'] or '', 'duration':row['duration_seconds'] or 0,'suggested':row['suggested'],'reason':row['reason'],'embeddable':bool(row['embeddable']),'refreshed_utc':row['refreshed_utc']}
            if c.fresh(data,c.now_iso()) and c.in_period(row['published_utc'],config[key]): state['channels'][key]['videos'][vid]=data
        for row in db.execute('SELECT * FROM watch_progress'):
            records[row['video_id']]={**records.get(row['video_id'],{}),'position':row['position_seconds'],'completed':bool(row['completed']),'updated':int(c.parse(row['updated_utc']).timestamp()*1000)}
    finally: db.close()
    c.atomic_json(state_path,state);c.atomic_json(progress_path,{'schema':1,'records':records})
    print(f'이전 완료: metadata {sum(len(ch["videos"]) for ch in state["channels"].values())}개 / 개인 기록 {len(records)}개 (별도 파일)')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('database');p.add_argument('--state',default='.state/state.json');p.add_argument('--progress',default='.state/stellive-progress-migrated.json');args=p.parse_args()
    migrate(args.database,c.load_channels('channels.json'),args.state,args.progress)
