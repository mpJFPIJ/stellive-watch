"""Fail closed on credential patterns and accidentally bundled private files."""
import argparse
import re
from pathlib import Path

def check(root):
    total=0
    for path in Path(root).rglob('*'):
        if not path.is_file(): continue
        if path.name in ('config.local.json','state.json') or path.suffix in ('.sqlite3','.db') or 'progress' in path.name.lower() or path.name.startswith('.env'):
            raise SystemExit(f'비공개 파일이 공개 출력에 포함됨: {path.name}')
        content=path.read_bytes();total+=1
        if re.search(rb'AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}',content): raise SystemExit('자격증명 패턴 감지: 공개 출력을 중단합니다.')
    print(f'공개 출력 검사 통과: {total}개 파일, 키/개인 기록 파일 없음')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--dist',default='dist');args=p.parse_args();check(args.dist)
