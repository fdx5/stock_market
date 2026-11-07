"""Freshness/source regressions, synthetic pages only; no app lifespan or DB."""
from datetime import datetime,timezone,timedelta
import json
import requests
import pytest
from app.services import community_feed as f

TQ=('tq-stock','더쿠 · 주식','tq','stock')
DOG=('dog-stock','개드립 · 재테크','dog','stock')
BB=('bb-property','보배드림 · 부동산','bb','strange')
RW=('rw-finance','루리웹 · 경제','rw','300143')

@pytest.mark.parametrize('source,html,board,expected',[
 (TQ,'<table class="bd_lst"><tr><td class="title"><a href="/stock/42">엔비디아 실적 분석</a><a class="replyNum">12</a></td><td class="time">21:01</td><td>PRIVATE-IP</td></tr></table>','global','tq-stock-42'),
 (DOG,'<tr><td><a href="https://www.dogdrip.net/42"><span class="title-link">삼성전자 주가 분석</span><span>9</span></a></td><td class="time">12 분 전</td><td>PRIVATE-NAME</td></tr>','kr','dog-stock-42'),
 (BB,'<table class="clistTable02"><tbody><tr><td><a class="bsubject" href="/view?code=strange&No=42">아파트 전세 계약 질문</a></td><td class="date">21:01</td><td>PRIVATE-IP</td></tr></tbody></table>','property','bb-strange-42'),
 (RW,'<table class="board_list_table"><tbody><tr><td class="id">42</td><td><a class="subject_link" href="https://bbs.ruliweb.com/community/board/300143/read/42">아파트 전세 계약 질문</a></td><td class="time">21:01</td><td>PRIVATE-NAME</td></tr></tbody></table>','property','rw-300143-42'),
])
def test_new_lists_validate_channel_identity_and_discard_profiles(source,html,board,expected):
    rows=f.parse_extra(html,source,board)
    assert len(rows)==1 and rows[0]['id']==expected
    assert 'PRIVATE' not in str(rows)
    assert not rows[0]['title'].endswith(' 9')
    assert not f.parse_extra(html.replace('21:01','unknown').replace('12 분 전','unknown'),source,board)

@pytest.mark.parametrize('provider,markup',[
 ('theqoo.net','<div class="rd_hd"><span class="title">아파트 전세 계약 질문</span><div class="btm_area"><div class="side fl">잡담</div><div class="side fr"><span>2026.11.07 21:01</span></div></div></div>'),
 ('www.bobaedream.co.kr','<title>아파트 전세 계약 질문 | 보배드림</title><span class="countGroup">2026.11.07 (토) 21:01</span>'),
 ('bbs.ruliweb.com','<span class="subject_text">아파트 전세 계약 질문</span><span class="regdate">2026.11.07 (21:01:02)</span>'),
 ('www.paxnet.co.kr','<title>아파트 전세 계약 질문 | 팍스넷</title><span data-date-format="2026-11-07 21:01:00.0"></span>'),
])
def test_full_article_header_replaces_conservative_list_date(provider,markup):
    title,written=f.article_metadata(f.html_soup(markup),provider)
    assert title=='아파트 전세 계약 질문'
    assert written.startswith('2026-11-07T12:01:')

def test_rounded_relative_hour_never_counts_as_last_hour():
    now=datetime.now(timezone.utc)
    assert datetime.fromisoformat(f.listing_time('1 시간 전')) < now-timedelta(hours=1)
    assert datetime.fromisoformat(f.listing_time('12 분 전')) < now-timedelta(minutes=12)
    assert f.listing_time('unknown') is None
    assert f.listing_time('99:99') is None

def test_toss_projects_content_only_and_keeps_creation_time(monkeypatch):
    from app.data import toss_session as t
    monkeypatch.setattr(t,'resolve_product_code',lambda *a,**k:'US19990122001')
    row={'commentId':42,'createdAt':'2026-11-07T21:01:02+09:00','message':{'message':'반도체 실적과 장기 투자에 대한 의견입니다.'},'author':{'nickname':'PRIVATE','userId':'SECRET'},'parentId':None}
    monkeypatch.setattr(t,'request_json',lambda *a,**k:{'result':{'results':[row,dict(row,commentId=43,parentId=42)],'hasNext':False}})
    rows=f.toss_items(('toss-stocks','토스증권','toss','global'),'NVDA')
    assert len(rows)==1 and rows[0]['id']=='toss-NVDA-42'
    assert rows[0]['published_at']=='2026-11-07T12:01:02+00:00'
    assert rows[0]['_body']['status']=='ok'
    assert 'PRIVATE' not in str(rows) and 'SECRET' not in str(rows)

def test_hourly_count_is_deduplicated_uses_creation_time_and_excludes_future(monkeypatch):
    now=datetime.now(timezone.utc)
    posts=[{'id':str(i),'title':'Title '+str(i),'source_id':'tq-stock','source':'더쿠','url':'https://theqoo.net/stock/'+str(i),'published_at':(now+timedelta(minutes=m)).isoformat()} for i,m in enumerate([-2,-59,-61,5])]
    monkeypatch.setattr(f,'_snapshots',f.OrderedDict())
    monkeypatch.setattr(f,'_latest',{})
    published=f.publish('kr',posts,[{'id':'tq-stock','status':'ok'}])
    data=f.listing('kr',snapshot=published['snapshot'])
    assert data['recent_hour_count']==2 and data['hourly_target']==10 and not data['hourly_target_met']

def test_missing_robots_is_distinct_from_explicit_denial(monkeypatch):
    monkeypatch.setattr(f,'_robots',{})
    def fetch(url):
        if url.endswith('robots.txt'):
            response=requests.Response();response.status_code=404
            raise requests.HTTPError(response=response)
        return b'public article'
    monkeypatch.setattr(f,'_request',fetch)
    assert f._get('https://example.org/public')==b'public article'
    monkeypatch.setattr(f,'_robots',{})
    def denied(url):return b'User-agent: *\nDisallow: /'
    monkeypatch.setattr(f,'_request',denied)
    with pytest.raises(ValueError,match='source policy'): f._get('https://example.org/public')

def test_expired_new_provider_permalink_keeps_exact_article(monkeypatch):
    monkeypatch.setattr(f,'_snapshots',f.OrderedDict())
    monkeypatch.setattr(f,'_latest',{'global':'unrelated-feed'})
    html='<div class="rd_hd"><span class="title">엔비디아 실적과 장기 투자</span><div class="btm_area"><div class="side fr">2026.11.07 21:01</div></div></div><div class="rd_body"><section><div class="xe_content">전체 공개 본문</div></section></div><aside>PRIVATE-NAME</aside>'
    monkeypatch.setattr(f,'_get',lambda *a:html)
    entry=f.entry('global','tq-stock-42','a'*32)
    assert entry['post']['title']=='엔비디아 실적과 장기 투자'
    assert f.preview('global',entry['snapshot'],'tq-stock-42')['text']=='전체 공개 본문'
    assert f._latest=={'global':'unrelated-feed'}

def test_expired_toss_permalink_does_not_fetch_an_unlisted_symbol(monkeypatch):
    monkeypatch.setattr(f,'_snapshots',f.OrderedDict())
    monkeypatch.setattr(f,'toss_items',lambda *a,**k:pytest.fail('unlisted symbol fetched'))
    with pytest.raises(LookupError):f.entry('global','toss-UNLISTED-42')

def test_expired_toss_permalink_keeps_body_without_overwriting_feed(monkeypatch):
    monkeypatch.setattr(f,'_snapshots',f.OrderedDict())
    monkeypatch.setattr(f,'_latest',{'global':'unrelated-feed'})
    item={'id':'toss-NVDA-42','title':'[NVDA] 반도체 실적 분석','source_id':'toss-stocks','published_at':'2026-11-07T12:00:00Z','_body':{'status':'ok','blocks':[{'type':'paragraph','text':'전체 공개 본문'}]}}
    monkeypatch.setattr(f,'toss_items',lambda *a,**k:[item])
    entry=f.entry('global','toss-NVDA-42','f'*32)
    assert entry['post']['id']=='toss-NVDA-42' and '_body' not in entry['post']
    assert f.preview('global',entry['snapshot'],entry['post']['id'])['status']=='ok'
    assert f._latest=={'global':'unrelated-feed'}
