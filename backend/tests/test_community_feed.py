"""Isolated in-memory tests; never imports app.main or any database module."""
from datetime import datetime, timezone, timedelta
from unittest import TestCase
from unittest.mock import patch
from app.services import community_feed as feed
REAL_LOAD_POST = feed.load_post


class CommunityTests(TestCase):
    def setUp(self):
        body = {"status": "ok", "text": "수집한 전체 본문", "blocks": [{"type": "paragraph", "text": "수집한 전체 본문"}], "images": []}
        self.body_loader = patch.object(feed, "load_post", return_value=body)
        self.mock_body_loader = self.body_loader.start()
        self.addCleanup(self.body_loader.stop)
    def posts(self, count=123):
        start = datetime(2026, 11, 5, tzinfo=timezone.utc)
        return [{"id": f"pax-{1000+i}", "title": f"시장 의견 {i}", "published_at": (start-timedelta(minutes=i)).isoformat(), "source_id": "pax-market", "topic": "의견"} for i in range(count)]

    def test_stable_paging_and_refresh(self):
        # Replace only process-local caches for this test; no stored data exists here.
        with patch.object(feed, "_snapshots", feed.OrderedDict()), patch.object(feed, "_latest", {}), patch.object(feed, "_attempted", {}), patch.object(feed, "collect", return_value=(self.posts(), {"id": "pax-market", "status": "ok"})) as collect:
            first = feed.listing("kr")
            second = feed.listing("kr", page=2, snapshot=first["snapshot"])
            third = feed.listing("kr", page=3, snapshot=first["snapshot"])
            self.assertEqual([len(p["items"]) for p in [first, second, third]], [50, 50, 23])
            self.assertFalse({p["id"] for p in first["items"]} & {p["id"] for p in second["items"]})
            self.assertEqual(first["total"], 123)
            calls = collect.call_count
            feed.listing("kr", refresh=True)
            self.assertEqual(calls, collect.call_count)  # coalesce simultaneous entries
            feed._attempted["kr"] -= 6
            refreshed = feed.listing("kr", refresh=True)
            self.assertNotEqual(first["snapshot"], refreshed["snapshot"])
            self.assertEqual(second["items"], feed.listing("kr", page=2, snapshot=first["snapshot"])["items"])

    def test_expired_and_wrong_board(self):
        with self.assertRaises(LookupError): feed.listing("kr", snapshot="f"*32)

    def test_pax_parser_utc_and_safe_links(self):
        html = b'<li><div data-seq="123">1</div><p><a class="best-title" href="javascript:bad()">Market &amp; rates</a><b class="comment-num">3</b></p><span data-date-format="Thu Nov 05 07:49:12 KST 2026"></span></li>'
        items = feed.parse_pax(html, feed.SOURCES["kr"][0], "kr")
        self.assertEqual(items[0]["published_at"], "2026-11-04T22:49:12+00:00")
        self.assertEqual(items[0]["url"], "https://www.paxnet.co.kr/tbbs/view?id=N00801&seq=123")
        self.assertEqual(items[0]["title"], "Market & rates")

    def test_partial_failure_retains_previous(self):
        with patch.object(feed, "_snapshots", feed.OrderedDict()), patch.object(feed, "_latest", {}), patch.object(feed, "_attempted", {}), patch.object(feed, "collect", return_value=(self.posts(), {"id": "pax-market", "status": "ok"})) as collect:
            first = feed.listing("kr")
            feed._attempted["kr"] -= 61
            collect.return_value = ([], {"id": "pax-market", "status": "unavailable"})
            second = feed.listing("kr")
            self.assertEqual(first["items"], second["items"])
            self.assertEqual(first["collected_at"], second["collected_at"])

    def test_korean_utf8_and_cp949_without_question_replacements(self):
        html = '<meta charset="euc-kr"><div id="bbsWrtCntn"><p>한글 본문과 첨부 이미지가 정상으로 보입니다.</p></div>'
        for encoding in ["utf-8", "cp949", "euc-kr"]:
            result = feed.parse_preview(html.encode(encoding), "https://www.paxnet.co.kr/tbbs/view?id=N00801&seq=1")
            self.assertEqual(result["text"], "한글 본문과 첨부 이미지가 정상으로 보입니다.")
            self.assertNotIn("?", result["text"])
        self.assertEqual(feed.html_soup("<p>질문인가요??</p>".encode()).get_text(), "질문인가요??")

    def test_repeated_titles_group_latest_but_keep_distinct_links(self):
        posts = self.posts(4)
        posts[0]["title"] = "오늘 반도체 시장의 수급과 전망"
        posts[1]["title"] = "★ 오늘 반도체 시장의 수급과 전망 ★"
        posts[2]["title"] = "오늘\u200b반도체 시장의 수급과 전망"
        for p in posts: p.update(source="테스트", url=f"https://www.paxnet.co.kr/tbbs/view?id=N00801&seq={p['id'][4:]}")
        posts.append(dict(posts[0], id="duplicate-url", url=posts[0]["url"] + "&tracking=1"))
        grouped = feed.deduplicate(posts)
        self.assertEqual(len(grouped), 2)
        self.assertEqual(grouped[0]["title"], posts[0]["title"])
        self.assertEqual(grouped[0]["duplicate_count"], 2)
        self.assertEqual(len(grouped[0]["related_posts"]), 2)

    def test_full_text_newlines_image_order_and_ui_controls(self):
        ending = "마지막 문장까지 온전히 표시됩니다."
        html = '<div id="bbsWrtCntn"><p>첫 문단<br>같은 문단의 다음 줄</p><button>공유하기</button><div class="sns"><a href="https://twitter.com/share">트위터</a><img src="/button.png"></div><p>' + "긴 본문 문장입니다. " * 80 + '</p><img data-src="/tbbs/files/graph.png" src="data:image/gif;base64,ignored"><p>https://news.einfomax.co.kr/news/articleView.html?idxno=4185659 0 공유 공유하기 페이스북 트위터 네이버 밴드 스크랩 카카오톡 카카오 스토리 라인 URL복사 닫기</p><p>' + ending + '</p><img src="javascript:alert(1)"><img src="https://127.0.0.1/private.png"><img src="/pixel.png" width="1" height="1"></div>'
        result = feed.parse_preview(html.encode(), "https://www.paxnet.co.kr/tbbs/view?id=N00801&seq=1")
        self.assertGreater(len(result["text"]), 1000)
        self.assertIn(ending, result["text"])
        self.assertIn("첫 문단\n같은 문단의 다음 줄", result["text"])
        self.assertIn("\n\n긴 본문", result["text"])
        self.assertNotIn("공유", result["text"])
        self.assertNotIn("페이스북", result["text"])
        self.assertIn("idxno=4185659", result["text"])
        self.assertEqual([b["type"] for b in result["blocks"]], ["paragraph", "paragraph", "image", "paragraph", "paragraph"])
        self.assertEqual(len(result["images"]), 1)
        self.assertEqual(result["images"][0]["url"], "https://www.paxnet.co.kr/tbbs/files/graph.png")

    def test_anchor_destination_retained_and_prose_not_stripped(self):
        result = feed.parse_preview('<div id="bbsWrtCntn"><p>공유 경제와 페이스북 실적은 어떤 관계인가요?</p><p><a href="https://news.einfomax.co.kr/news/articleView.html?idxno=4185659">관련 기사</a></p><a href="https://facebook.com/sharer.php?u=foo">페이스북</a><!-- hidden --></div>'.encode(), "https://www.paxnet.co.kr/tbbs/view?id=N00801&seq=1")
        self.assertIn("공유 경제와 페이스북 실적", result["text"])
        self.assertIn("관련 기사 (https://news.einfomax.co.kr/", result["text"])
        self.assertNotIn("sharer", result["text"])
        self.assertNotIn("hidden", result["text"])

    def test_unreadable_articles_never_enter_public_pages(self):
        posts = self.posts(3)
        self.mock_body_loader.side_effect = lambda item: {"status": "unavailable", "blocks": []} if item["id"] == "pax-1001" else {"status": "ok", "blocks": [{"type": "paragraph", "text": "전체 본문"}]}
        with patch.object(feed, "_snapshots", feed.OrderedDict()), patch.object(feed, "_latest", {}), patch.object(feed, "_attempted", {}), patch.object(feed, "collect", return_value=(posts, {"id": "pax-market", "status": "ok"})):
            result = feed.listing("kr")
            self.assertEqual(result["total"], 2)
            self.assertNotIn("pax-1001", [p["id"] for p in result["items"]])
            self.assertNotIn("_body", result["items"][0])
            with patch.object(feed, "load_post", side_effect=AssertionError("must use verified snapshot body")):
                detail = feed.preview("kr", result["snapshot"], result["items"][0]["id"])
            self.assertEqual(detail["blocks"][0]["text"], "전체 본문")

    def test_background_refresh_returns_readable_list_without_waiting(self):
        jobs = []
        with patch.object(feed, "_snapshots", feed.OrderedDict()), patch.object(feed, "_latest", {}), patch.object(feed, "_attempted", {}), patch.object(feed, "_refreshing", set()), patch.object(feed, "collect", return_value=(self.posts(), {"id": "pax-market", "status": "ok"})) as collect, patch.object(feed._refresh_pool, "submit", side_effect=lambda job: jobs.append(job)):
            first = feed.listing("kr")
            feed._attempted["kr"] -= 6
            calls = collect.call_count
            waiting = feed.listing("kr", refresh=True, background=True)
            self.assertTrue(waiting["refreshing"])
            self.assertEqual(waiting["items"], first["items"])
            self.assertEqual(collect.call_count, calls)
            feed.listing("kr", refresh=True, background=True)
            self.assertEqual(len(jobs), 1)
            jobs[0]()
            updated = feed.listing("kr", background=True)
            self.assertFalse(updated["refreshing"])
            self.assertNotEqual(first["snapshot"], updated["snapshot"])

    def test_actual_and_escaped_youtube_iframes_become_video_blocks(self):
        from html import escape
        embed = '<iframe width="619" height="1100" src="https://www.youtube.com/embed/NlIHBkE28nA ↗" title="과격한" 선동은 이재명이 했다...></iframe>'
        for markup in [embed, escape(embed), escape(escape(embed))]:
            result = feed.parse_preview(('<div id="bbsWrtCntn"><p>영상 앞 문장</p>' + markup + '<p>영상 뒤 문장</p></div>').encode(), 'https://www.paxnet.co.kr/tbbs/view?id=N00801&seq=1')
            self.assertEqual([b['type'] for b in result['blocks']], ['paragraph', 'youtube', 'paragraph'])
            self.assertEqual(result['blocks'][1]['video_id'], 'NlIHBkE28nA')
            self.assertTrue(result['blocks'][1]['portrait'])
            self.assertNotIn('iframe', result['text'])
            self.assertNotIn('width=', result['text'])
            self.assertIn('영상 뒤 문장', result['text'])

    def test_youtube_url_variants_and_duplicate_embeds(self):
        urls = ['https://youtu.be/NlIHBkE28nA', 'https://www.youtube.com/watch?v=NlIHBkE28nA', 'https://www.youtube.com/shorts/NlIHBkE28nA', '//www.youtube-nocookie.com/embed/NlIHBkE28nA']
        for url in urls: self.assertEqual(feed.youtube_video(url)['video_id'], 'NlIHBkE28nA')
        result = feed.parse_preview('<div id="bbsWrtCntn"><p>https://youtu.be/NlIHBkE28nA</p><iframe src="https://www.youtube.com/embed/NlIHBkE28nA"></iframe><p>이어지는 본문</p></div>'.encode(), 'https://www.paxnet.co.kr/tbbs/view?id=N00801&seq=1')
        self.assertEqual(len([b for b in result['blocks'] if b['type']=='youtube']), 1)
        self.assertIn('이어지는 본문', result['text'])

    def test_untrusted_iframe_and_literal_scripts_are_never_rendered(self):
        from html import escape
        for url in ['https://youtube.com.evil.test/embed/NlIHBkE28nA', 'javascript:alert(1)', 'https://127.0.0.1/embed/NlIHBkE28nA', 'https://www.youtube.com/embed/not-an-id']:
            self.assertIsNone(feed.youtube_video(url))
        markup = escape('<iframe src="https://evil.test/embed/123"></iframe><script>alert(1)</script><img src="javascript:alert(2)"><p>정상 문단</p>')
        result = feed.parse_preview(('<div id="bbsWrtCntn">' + markup + '</div>').encode(), 'https://www.paxnet.co.kr/tbbs/view?id=N00801&seq=1')
        self.assertEqual(result['text'], '정상 문단')
        self.assertEqual([b['type'] for b in result['blocks']], ['paragraph'])

    def test_cold_background_request_does_not_wait_for_collection(self):
        jobs = []
        with patch.object(feed, "_snapshots", feed.OrderedDict()), patch.object(feed, "_latest", {}), patch.object(feed, "_attempted", {}), patch.object(feed, "_refreshing", set()), patch.object(feed, "collect", return_value=(self.posts(), {"id": "pax-market", "status": "ok"})) as collect, patch.object(feed._refresh_pool, "submit", side_effect=lambda job: jobs.append(job)):
            pending = feed.listing("kr", background=True)
            self.assertTrue(pending['refreshing'])
            self.assertEqual(pending['items'], [])
            self.assertEqual(collect.call_count, 0)
            self.assertEqual(len(jobs), 1)
            jobs[0]()
            ready = feed.listing("kr", background=True)
            self.assertFalse(ready['refreshing'])
            self.assertEqual(len(ready['items']), 50)

    def test_partial_snapshots_contain_only_verified_bodies(self):
        with patch.object(feed, "_snapshots", feed.OrderedDict()), patch.object(feed, "_latest", {}), patch.object(feed, "_attempted", {}), patch.object(feed, "collect", return_value=(self.posts(), {"id": "pax-market", "status": "ok"})):
            result = feed.listing('kr')
            partial = [s for s in feed._snapshots.values() if s['snapshot'] != result['snapshot']]
            self.assertTrue(partial)
            self.assertTrue(any(s['checked_count'] < s['candidate_count'] for s in partial))
            self.assertTrue(all(item.get('_body', {}).get('status') == 'ok' for s in partial for item in s['items']))

    def test_unavailable_public_bodies_back_off_without_repeating_every_post(self):
        with patch.object(feed, '_previews', feed.OrderedDict()), patch.object(feed, '_body_failures', {}), patch.object(feed, '_body_backoff', {}), patch.object(feed, '_get', return_value=b'<html><body>Login required</body></html>') as get:
            for n in range(1, 5):
                result = REAL_LOAD_POST({'id': f'82-{n}', 'url': f'https://www.82cook.com/entiz/read.php?bn=15&num={n}'})
                self.assertEqual(result['status'], 'unavailable')
            self.assertEqual(get.call_count, 3)

    def test_public_comments_preserve_replies_and_exclude_profiles(self):
        html = '''<li class="list"><div class="text" id="text_11"><p class="writer">SECRET-WRITER<img src="/profile.png"><span class="data-date-format" data-date-format="Thu Nov 05 08:02:48 KST 2026"></span></p><p id="cont_11" style="display:none">hidden duplicate</p><p class="cont">댓글 첫 줄<br>둘째 줄<button>신고</button></p></div><div class="list"><div class="text" id="text_12"><p class="writer">PRIVATE-USER-ID</p><p class="cont">답글입니다.</p></div></div></li><script>$("#commentCnt").html("2");if("1"=="2"){$("#und-list").hide();}</script>'''
        result = feed.parse_comments(html, 'https://www.paxnet.co.kr/tbbs/view?id=N00801&seq=1')
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['total'], 2)
        self.assertTrue(result['has_more'])
        self.assertEqual([c['id'] for c in result['items']], ['11', '12'])
        self.assertEqual(result['items'][1]['parent_id'], '11')
        self.assertEqual(result['items'][0]['published_at'], '2026-11-04T23:02:48+00:00')
        self.assertEqual(result['items'][0]['blocks'][0]['text'], '댓글 첫 줄\n둘째 줄')
        payload = str(result)
        for text in ['SECRET-WRITER','PRIVATE-USER-ID','profile.png','hidden duplicate','신고']:
            self.assertNotIn(text, payload)
        self.assertFalse(feed.parse_comments(html.replace('if("1"=="2")','if("2"=="2")'), 'https://www.paxnet.co.kr/tbbs/view?id=N00801&seq=1', 2)['has_more'])

    def test_comments_distinguish_empty_and_failed_sources(self):
        empty = feed.parse_comments('<script>$("#commentCnt").html("0");</script>', 'https://www.paxnet.co.kr/tbbs/view?id=N00801&seq=1')
        self.assertEqual(empty['status'], 'ok')
        self.assertEqual(empty['total'], 0)
        self.assertEqual(empty['items'], [])
        failed = feed.parse_comments('<html>Login required</html>', 'https://www.paxnet.co.kr/tbbs/view?id=N00801&seq=1')
        self.assertEqual(failed['status'], 'unavailable')
        self.assertIsNone(failed['total'])

    def test_reply_to_unavailable_parent_keeps_reply_classification(self):
        html = '''<div class="list"><div class="text" id="text_12"><p class="cont">부모 댓글이 없어도 공개된 답글입니다.</p><button onclick="javascript:replyAddForm('12', this, '10');">답글달기</button></div></div><script>$("#commentCnt").html("1");</script>'''
        result = feed.parse_comments(html, 'https://www.paxnet.co.kr/tbbs/view?id=N00801&seq=1')
        self.assertEqual(result['items'][0]['parent_id'],'10')

    def test_comment_endpoint_is_bounded_and_snapshot_scoped(self):
        post = {'id':'pax-1', 'url':'https://www.paxnet.co.kr/tbbs/view?id=N00801&seq=1'}
        snapshot = {'board':'kr', 'items':[post]}
        with patch.object(feed, '_snapshots', {'a'*32:snapshot}), patch.object(feed, '_comment_cache', feed.OrderedDict()), patch.object(feed, '_get', return_value=b'<script>$("#commentCnt").html("0");</script>') as get:
            feed.comments('kr','a'*32,'pax-1')
            feed.comments('kr','a'*32,'pax-1')
            self.assertEqual(get.call_count,1)
            self.assertTrue(get.call_args.args[0].startswith('https://www.paxnet.co.kr/tbbs/bbsCommentList?'))
            self.assertNotIn('regmnId', get.call_args.args[0])
            with self.assertRaises(LookupError):feed.comments('global','a'*32,'pax-1')
