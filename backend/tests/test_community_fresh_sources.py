"""Source parsing and freshness regressions. In-memory only, no app lifespan or DB."""
from unittest import TestCase
from unittest.mock import patch
from app.services import community_feed as f


class FreshSourceTests(TestCase):
    def row(self, number="123", kind="icon_txt", title="아파트 전세 시세", written="2026-11-06 11:20:30"):
        return f'''<tr class="ub-content" data-no="{number}" data-type="{kind}"><td class="gall_subject">일반</td><td class="gall_tit"><a href="javascript:evil()">{title}</a><a class="reply_numbox"><span class="reply_num">[12]</span></a></td><td class="gall_writer">PRIVATE-NAME PRIVATE-IP</td><td class="gall_date" title="{written}">11:20</td></tr>'''

    def test_active_sources_mix_domestic_communities_without_dc(self):
        for sources in f.SOURCES.values():
            self.assertTrue(sources)
            self.assertTrue(all(s[2] != "dc" for s in sources))
            self.assertGreaterEqual(len({s[2] for s in sources}), 2)

    def test_dc_dates_canonical_urls_and_no_writer_fields(self):
        item = f.parse_dc(self.row(), ('dc-immovables','legacy','dc','immovables'), 'property')[0]
        self.assertEqual(item['published_at'], '2026-11-06T02:20:30+00:00')
        self.assertEqual(item['url'], 'https://gall.dcinside.com/board/view/?id=immovables&no=123')
        self.assertEqual(item['comments'], 12)
        self.assertNotIn('PRIVATE', str(item))

    def test_notices_ads_and_unrelated_property_posts_do_not_displace_latest(self):
        html = self.row(kind='icon_notice') + self.row(number='-', title='광고') + self.row(number='124',title='오늘 점심 뭐 먹지') + self.row(number='125')
        self.assertEqual([i['id'] for i in f.parse_dc(html, ('dc-immovables','legacy','dc','immovables'), 'property')], ['dc-immovables-125'])
        self.assertEqual(f.parse_dc(self.row(written='bad'), ('dc-kospi','legacy','dc','kospi'), 'kr'), [])

    def test_dc_body_and_images_are_readable_and_script_free(self):
        body = f.parse_preview('<div class="write_div"><p>첫 문단<br>둘째 줄</p><img src="https://dcimg4.dcinside.co.kr/viewimage.php?id=abc"><script>evil()</script><div class="appending_file">앱 홍보</div></div>', 'https://gall.dcinside.com/board/view/?id=immovables&no=1')
        self.assertEqual(body['status'], 'ok')
        self.assertIn('첫 문단\n둘째 줄', body['text'])
        self.assertEqual(len(body['images']), 1)
        self.assertNotIn('evil', str(body)); self.assertNotIn('앱 홍보', str(body))
        self.assertIsNone(f.attachment_url('https://dcimg4.dcinside.co.kr.evil.test/x.png', 'https://gall.dcinside.com'))

    def test_dc_comments_exclude_identity_preserve_replies_and_paging(self):
        data = {'total_cnt':'2','pagination':'<a onclick="viewComments(2, null)">2</a>','comments':[
            {'no':'10','c_no':0,'memo':'<p>첫 댓글</p>','reg_date':'2026-11-06 11:20:30','name':'PRIVATE-NAME','user_id':'SECRET','ip':'PRIVATE-IP'},
            {'no':'11','c_no':'10','memo':'답글','reg_date':'11.06 11:21:00'},
            {'no':'12','memo':'지워진 글','del_yn':'Y'}]}
        result = f.parse_dc_comments(data,'https://gall.dcinside.com/board/view/?id=immovables&no=1')
        self.assertEqual(len(result['items']),2)
        self.assertEqual(result['items'][1]['parent_id'],'10')
        self.assertEqual(result['items'][0]['published_at'],'2026-11-06T02:20:30+00:00')
        self.assertTrue(result['has_more'])
        self.assertNotIn('PRIVATE',str(result)); self.assertNotIn('SECRET',str(result))
        self.assertFalse(f.parse_dc_comments(data,'https://gall.dcinside.com/board/view/?id=immovables&no=1',2)['has_more'])

    def test_empty_comments_are_distinct_from_upstream_failure(self):
        self.assertEqual(f.parse_dc_comments({'total_cnt':0,'comments':None},'https://gall.dcinside.com')['status'],'ok')
        self.assertEqual(f.parse_dc_comments({},'https://gall.dcinside.com')['status'],'unavailable')

    def test_freshness_reports_post_time_independent_of_collection_time(self):
        item = f.parse_dc(self.row(),('dc-immovables','legacy','dc','immovables'),'property')[0]
        with patch.object(f,'_snapshots',f.OrderedDict()),patch.object(f,'_latest',{}):
            result=f.publish('property',[item],[{'id':'dc-immovables','status':'ok'}])
        self.assertEqual(result['latest_published_at'],item['published_at'])
        self.assertEqual(result['sources'][0]['latest_published_at'],item['published_at'])

    def test_partial_refresh_keeps_prior_verified_active_source_rows(self):
        fresh = f.parse_dc(self.row(number='2'),('dc-immovables','legacy','dc','immovables'),'property')[0]
        old = dict(fresh,id='dc-immovables-1',published_at='2026-11-05T01:00:00+00:00',_body={'status':'ok','blocks':[{'type':'paragraph','text':'prior body'}]})
        retired = dict(old,id='pax-1',source_id='pax-property')
        with patch.object(f,'_snapshots',f.OrderedDict()),patch.object(f,'_latest',{}):
            result=f.publish('property',[fresh],[{'id':'dc-immovables','status':'ok'}],old={'items':[old,retired]},complete=False)
        self.assertEqual([p['id'] for p in result['items']],['dc-immovables-2','dc-immovables-1'])
