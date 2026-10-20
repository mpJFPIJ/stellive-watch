import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from scripts import migrate, collector as c
from test_collector import CFG

TEMP=Path(__file__).resolve().parent.parent/'.state/test-temp'
TEMP.mkdir(parents=True,exist_ok=True)

class MigrationTests(unittest.TestCase):
    def test_private_progress_and_manual_decisions_separated_from_catalogue(self):
        with tempfile.TemporaryDirectory(dir=TEMP) as folder:
            root=Path(folder);database=root/'old.sqlite3'
            db=sqlite3.connect(database)
            db.executescript('''
              CREATE TABLE channels(channel_key,channel_id,last_success,last_error);
              CREATE TABLE videos(video_id,channel_key,published_utc,title,duration_seconds,suggested,reason,manual,status,embeddable,refreshed_utc);
              CREATE TABLE watch_progress(video_id,position_seconds,completed,updated_utc);
            ''')
            now=c.now_iso()
            db.execute('INSERT INTO channels VALUES (?,?,?,?)',('test',CFG['channel_id'],now,''))
            db.execute('INSERT INTO videos VALUES (?,?,?,?,?,?,?,?,?,?,?)',('a'*11,'test','2023-01-07T00:00:00Z','표제',600,'review','확인','include','available',1,now))
            db.execute('INSERT INTO watch_progress VALUES (?,?,?,?)',('a'*11,37,1,now))
            db.commit();db.close();before=database.read_bytes()
            migrate.migrate(database,[CFG],root/'state.json',root/'private.json')
            state=json.loads((root/'state.json').read_text(encoding='utf-8'));private=json.loads((root/'private.json').read_text(encoding='utf-8'))
            self.assertEqual(private['records']['a'*11]['position'],37)
            self.assertTrue(private['records']['a'*11]['completed'])
            self.assertEqual(private['records']['a'*11]['manual'],'include')
            self.assertNotIn('manual',state['channels']['test']['videos']['a'*11])
            self.assertNotIn('completed',state['channels']['test']['videos']['a'*11])
            self.assertEqual(before,database.read_bytes())

if __name__=='__main__':unittest.main()
