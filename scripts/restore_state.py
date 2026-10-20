"""Restore one JSON member from the last same-branch Actions state artifact."""
import io
import json
import os
from pathlib import Path
import zipfile
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
try:
    from .collector import atomic_json
except ImportError:
    from collector import atomic_json

def restore():
    repo=os.environ['GITHUB_REPOSITORY'];token=os.environ['GH_TOKEN'];branch=os.environ['DEFAULT_BRANCH']
    def get(url):
        # GitHub redirects artifact downloads to signed storage. urllib strips neither
        # arbitrary auth nor custom headers on redirect, so handle redirect explicitly.
        return urlopen(Request(url,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}),timeout=60)
    with get(f'https://api.github.com/repos/{repo}/actions/artifacts?name=collector-state&per_page=100') as response: artifacts=json.load(response)['artifacts']
    candidates=[a for a in artifacts if not a['expired'] and a.get('workflow_run',{}).get('head_branch')==branch]
    for artifact in sorted(candidates,key=lambda a:a['created_at'],reverse=True):
        try:
            # Use a no-redirect opener; never forward GitHub token to blob storage.
            from urllib.request import build_opener, HTTPRedirectHandler
            class NoRedirect(HTTPRedirectHandler):
                def redirect_request(self,*args,**kwargs): return None
            req=Request(artifact['archive_download_url'],headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'})
            try:
                response=build_opener(NoRedirect).open(req,timeout=60)
            except HTTPError as exc:
                if exc.code!=302: raise
                target=exc.headers['Location']
                if not target.startswith('https://'): raise ValueError('artifact redirect protocol')
                response=urlopen(target,timeout=60)
            with response:
                archive=response.read(100*1024*1024+1)
            if len(archive)>100*1024*1024: raise ValueError('artifact size')
            with zipfile.ZipFile(io.BytesIO(archive)) as z:
                info=z.getinfo('state.json')
                if info.file_size>200*1024*1024: raise ValueError('state size')
                state=json.loads(z.read(info))
            if state.get('schema')!=1 or not isinstance(state.get('channels'),dict): raise ValueError('state schema')
            atomic_json('.state/state.json',state)
            print('이전 수집 체크포인트 복원 완료');return
        except (HTTPError,URLError,ValueError,KeyError,zipfile.BadZipFile):
            print('이전 artifact를 복원하지 못해 다른 체크포인트 확인 중')
    print('복원 가능한 상태 없음: 전체 소급 수집으로 시작')

if __name__=='__main__':
    try: restore()
    except (HTTPError,URLError,KeyError): print('::warning::상태 복원 실패: 이번 실행은 전체 소급 수집으로 시작합니다.')
