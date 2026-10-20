import json
import tempfile
import unittest
from pathlib import Path
from scripts import build, collector as c
from test_collector import CFG, NOW, Fake
TEMP=Path(__file__).resolve().parent.parent/'.state/test-temp'
TEMP.mkdir(parents=True,exist_ok=True)

class BuildTests(unittest.TestCase):
    def test_sorted_shards_lookup_and_no_private_data(self):
        state=c.empty_state();c.sync(state,[CFG],Fake(),NOW,budget=20)
        state['private']='NEVER_PUBLISH'
        with tempfile.TemporaryDirectory(dir=TEMP) as d:
            root=Path(d);build.build_site(state,[CFG],{},root,now=NOW,shard_size=1)
            m=json.loads((root/'data/manifest.json').read_text(encoding='utf-8'))
            self.assertEqual(m['total'],2);self.assertEqual(len(m['shards']),2)
            rows=[json.loads((root/'data'/s['file']).read_text(encoding='utf-8'))[0] for s in m['shards']]
            self.assertEqual([r['id'] for r in rows],['a'*11,'b'*11])
            self.assertEqual(rows[0]['published_kst'],'2023-01-07T00:00:00+09:00')
            idx=json.loads((root/'data/lookup/aa.json').read_text(encoding='utf-8'))
            self.assertEqual(idx['a'*11],m['shards'][0]['file'])
            self.assertNotIn('NEVER_PUBLISH',''.join(p.read_text(encoding='utf-8') for p in root.rglob('*.json')))
    def test_expired_rows_not_exported(self):
        state=c.empty_state();c.sync(state,[CFG],Fake(),NOW,budget=20)
        with tempfile.TemporaryDirectory(dir=TEMP) as d:
            build.build_site(state,[CFG],{},Path(d),now='2026-11-19T00:00:00+00:00')
            self.assertEqual(json.loads((Path(d)/'data/manifest.json').read_text(encoding='utf-8'))['total'],0)

if __name__=='__main__': unittest.main()
