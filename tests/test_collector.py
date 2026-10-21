import json
import unittest
import io
from unittest.mock import patch
from urllib.error import HTTPError
from copy import deepcopy
from scripts import collector as c

NOW = '2026-10-20T00:00:00+00:00'
CFG = {'key':'test','name':'테스트','group':'member','channel_id':'UC'+'x'*22,'start':'2023-01-07','end':'2024-12-02'}

def video(vid='a'*11, published='2023-01-06T15:00:00Z', title='편집 하이라이트', duration='PT10M'):
    return {'id':vid,'snippet':{'title':title,'channelId':CFG['channel_id'],'publishedAt':published},'contentDetails':{'duration':duration},'status':{'embeddable':True,'privacyStatus':'public'}}

class Fake:
    def __init__(self):
        self.pages={'':[video()], 'p2':[video('b'*11)]}
        self.fail=False
    def get(self, endpoint, **query):
        if self.fail: raise c.ApiError('일시 오류')
        if endpoint=='channels': return {'items':[{'id':CFG['channel_id'],'snippet':{'title':'테스트'},'contentDetails':{'relatedPlaylists':{'uploads':'UU_test'}}}]}
        if endpoint=='playlistItems':
            token=query.get('pageToken','')
            return {'items':[{'contentDetails':{'videoId':v['id']}} for v in self.pages[token]], **({'nextPageToken':'p2'} if token=='' else {})}
        if endpoint=='videos':
            ids=query['id'].split(',')
            return {'items':[v for page in self.pages.values() for v in page if v['id'] in ids]}
        raise AssertionError(endpoint)

class CollectorTests(unittest.TestCase):
    def test_mixed_channel_collects_related_uploads_only(self):
        fake=Fake();fake.pages={'':[video(title='아오쿠모 린 팬 애니메이션'),video('b'*11,title='다른 버튜버 애니메이션')],'p2':[]}
        state=c.empty_state();c.sync(state,[{**CFG,'group':'fan','relevance':'metadata'}],fake,NOW,budget=20)
        self.assertEqual(set(state['channels']['test']['videos']),{'a'*11})
    def test_title_scoped_channel_does_not_match_generic_description_footer(self):
        fake=Fake();unrelated=video('b'*11,title='오늘의 일반 게임 편집본');unrelated['snippet']['description']='스텔라이브 공식 사이트 https://stellive.me'
        fake.pages={'':[video(title='스텔라이브 합방 하이라이트'),unrelated],'p2':[]}
        state=c.empty_state();c.sync(state,[{**CFG,'relevance':'title'}],fake,NOW,budget=20)
        self.assertEqual(set(state['channels']['test']['videos']),{'a'*11})
    def test_dedicated_channel_keeps_implicit_member_clip_titles(self):
        fake=Fake();fake.pages={'':[video(title='이거 완전 개쳐귀여움')],'p2':[]}
        state=c.empty_state();c.sync(state,[CFG],fake,NOW,budget=20)
        self.assertEqual(set(state['channels']['test']['videos']),{'a'*11})
    def test_replay_channel_link_does_not_hide_edited_video(self):
        item=video(title='오늘의 게임 하이라이트',duration='PT8M')
        item['snippet']['description']='다시보기 채널 : https://www.youtube.com/@replay'
        self.assertEqual(c.classify(item,'member')[0],'include')
    def test_music_premiere_metadata_does_not_hide_cover(self):
        item=video(title='노래 제목 / Cover',duration='PT4M')
        item['snippet']['categoryId']='10'
        item['liveStreamingDetails']={'actualStartTime':'2023-01-07T10:00:00Z','actualEndTime':'2023-01-07T10:06:00Z','scheduledStartTime':'2023-01-07T10:00:00Z'}
        for category in ('10','22','24'):
            item['snippet']['categoryId']=category
            self.assertEqual(c.classify(item,'member')[0],'include')
        item['snippet']['title']='노래방 방송 풀영상 Cover 모음'
        self.assertEqual(c.classify(item,'member')[0],'review')
    def test_legacy_two_minute_video_is_not_a_three_minute_short(self):
        self.assertEqual(c.classify(video(duration='PT1M1S'),'official')[0],'include')
        self.assertEqual(c.classify(video(duration='PT2M'),'member')[0],'include')
        self.assertEqual(c.classify(video(duration='PT1M'),'member')[0],'review')
        self.assertEqual(c.classify(video(published='2026-01-01T00:00:00Z',duration='PT2M'),'member')[0],'review')
    def test_true_live_archive_stays_in_review(self):
        item=video(title='오늘 게임 방송',duration='PT3H')
        item['liveStreamingDetails']={'actualStartTime':'2023-01-07T10:00:00Z'}
        self.assertEqual(c.classify(item,'member')[0],'review')
    def test_request_budget_counts_network_retries(self):
        error=HTTPError('https://example.invalid',503,'test',{},io.BytesIO(b'{}'))
        client=c.YouTubeClient('PRIVATE_KEY_FOR_TEST',max_calls=2)
        with patch.object(c,'urlopen',side_effect=error),patch.object(c.time,'sleep'):
            with self.assertRaises(c.BudgetReached):client.get('channels',part='id',id=CFG['channel_id'])
        self.assertEqual(client.calls,2)
    def test_api_error_never_exposes_key_or_raw_body(self):
        error=HTTPError('https://example.invalid',403,'PRIVATE_KEY_FOR_TEST',{},io.BytesIO(b'{"error":{"errors":[{"reason":"PRIVATE_KEY_FOR_TEST"}]}}'))
        with patch.object(c,'urlopen',side_effect=error):
            with self.assertRaises(c.ApiError) as caught:c.YouTubeClient('PRIVATE_KEY_FOR_TEST').get('channels',part='id')
        self.assertNotIn('PRIVATE_KEY_FOR_TEST',str(caught.exception))
    def test_checkpoint_persisted_before_forced_interruption(self):
        state=c.empty_state();fake=Fake();saved=[]
        original=fake.get
        def get(endpoint,**query):
            if endpoint=='playlistItems' and query.get('pageToken')=='p2': raise KeyboardInterrupt()
            return original(endpoint,**query)
        fake.get=get
        with self.assertRaises(KeyboardInterrupt): c.sync(state,[CFG],fake,NOW,budget=20,checkpoint=lambda s:saved.append(deepcopy(s)))
        self.assertEqual(saved[-1]['channels']['test']['pending']['token'],'p2')
        self.assertEqual(len(saved[-1]['channels']['test']['pending']['videos']),1)
    def test_kst_boundaries_and_classification(self):
        self.assertTrue(c.in_period('2023-01-06T15:00:00Z',CFG))
        self.assertFalse(c.in_period('2023-01-06T14:59:59Z',CFG))
        self.assertTrue(c.in_period('2024-12-02T14:59:59Z',CFG))
        self.assertFalse(c.in_period('2024-12-02T15:00:00Z',CFG))
        self.assertEqual(c.classify(video(published='2026-01-01T00:00:00Z',duration='PT2M'),'member')[0],'review')
        self.assertEqual(c.classify(video(title='클립 #shorts'),'member')[0],'exclude')
        self.assertEqual(c.classify(video(title='무편집 다시보기',duration='PT2H'),'member')[0],'review')
        self.assertEqual(c.classify(video(duration='PT2H'),'member')[0],'include')
    def test_scan_checkpoint_then_full_reconciliation(self):
        state=c.empty_state(); fake=Fake()
        c.sync(state,[CFG],fake,NOW,budget=3)
        self.assertEqual(len(state['channels']['test'].get('videos',{})),0)
        state=json.loads(json.dumps(state))
        c.sync(state,[CFG],fake,NOW,budget=10)
        self.assertEqual(set(state['channels']['test']['videos']),{'a'*11,'b'*11})
        fake.pages={'':[], 'p2':[]}
        c.sync(state,[CFG],fake,NOW,budget=10)
        self.assertEqual(state['channels']['test']['videos'],{})
    def test_failure_preserves_completed_catalogue(self):
        state=c.empty_state(); fake=Fake(); c.sync(state,[CFG],fake,NOW,budget=20)
        before=deepcopy(state['channels']['test']['videos']);fake.fail=True
        c.sync(state,[CFG],fake,NOW,budget=20)
        self.assertEqual(state['channels']['test']['videos'],before)
        self.assertTrue(state['channels']['test']['error'])
    def test_period_change_resets_pending_scan(self):
        state=c.empty_state();fake=Fake();c.sync(state,[CFG],fake,NOW,budget=3)
        cfg={**CFG,'start':'2024-01-01'}
        c.sync(state,[cfg],fake,NOW,budget=20)
        self.assertEqual(state['channels']['test']['videos'],{})
    def test_stale_data_purged_even_on_failure(self):
        state=c.empty_state();fake=Fake();c.sync(state,[CFG],fake,NOW,budget=20)
        fake.fail=True;c.sync(state,[CFG],fake,'2026-11-19T00:00:00+00:00',budget=20)
        self.assertEqual(state['channels']['test']['videos'],{})
    def test_no_content_deduplication(self):
        fake=Fake();state=c.empty_state();c.sync(state,[CFG],fake,NOW,budget=20)
        self.assertEqual(len(state['channels']['test']['videos']),2)

if __name__=='__main__': unittest.main()
