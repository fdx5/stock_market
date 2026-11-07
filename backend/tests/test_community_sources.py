"""Synthetic public pages and isolated router only. No main lifespan or DB."""
import json
from unittest.mock import patch
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.services import community_feed as f
from app.routers.community import router

PP = ('pp-stock','뽐뿌 · 증권포럼','pp','stock')
CL = ('cl-stock','클리앙 · 주식한당','cl','cm_stock')
DA = ('da-stock','다모앙 · 주식한당','da','stock')

def pp(number, title):
    return f'<tr class="baseList"><td class="baseList-numb">{number}</td><td><a class="baseList-title" href="view.php?id=stock&no={number}">{title}</a></td><td>PRIVATE-NAME PRIVATE-IP</td><td><time title="26.11.07 12:01:02"></time></td></tr>'

def test_pp_real_dates_correct_boards_and_promotion_filter():
    html = pp('1','삼성전자 실적과 주가 분석')+pp('2','미국 나스닥 ETF 투자 의견')+pp('3','테슬라 원금보장 무료체험')+pp('공지','삼성전자 게시판 공지')
    kr, us = f.parse_pp(html,PP,'kr'), f.parse_pp(html,PP,'global')
    assert [x['id'] for x in kr] == ['pp-stock-1']
    assert [x['id'] for x in us] == ['pp-stock-2']
    assert kr[0]['published_at'] == '2026-11-07T03:01:02+00:00'
    assert 'PRIVATE' not in str(kr+us)
    assert not f.parse_pp(html.replace('id=stock','id=freeboard'),PP,'kr')
    assert f.relevant_title('삼성전자 공시발표와 주가 분석','kr')

def test_cl_uses_article_title_and_exact_creation_time_without_author():
    html='<div class="list_item"><a class="list_subject" href="/service/board/cm_stock/42?od=T31"><span class="subject_fixed" title="엔비디아 실적 분석"></span></a><span class="timestamp">2026-11-07 12:01:02</span><div class="list_author">PRIVATE</div></div>'
    rows=f.parse_cl(html,CL,'global')
    assert rows[0]['id']=='cl-cm_stock-42'
    assert 'PRIVATE' not in str(rows)
    assert not f.parse_cl(html,CL,'kr')

def test_damoang_does_not_invent_dates_for_undated_or_yesterday_rows():
    row='<a class="post-row" href="/stock/42"><span class="post-title" title="미국 나스닥 주식 분석"></span><span class="date-today">12:01</span></a>'
    assert f.parse_da(row,DA,'global')[0]['id']=='da-stock-42'
    assert not f.parse_da(row.replace('date-today','date-old'),DA,'global')
    assert not f.parse_da(row.replace('12:01','unknown'),DA,'global')

@pytest.mark.parametrize('url,html,expected',[
    ('https://www.ppomppu.co.kr/zboard/view.php?id=stock&no=1','<div class="JS_ContentMain"><td class="han"><p>공개 본문</p><script>evil()</script></td></div><div>PRIVATE-AUTHOR</div>','공개 본문'),
    ('https://www.clien.net/service/board/cm_stock/1','<article class="post"><header>PRIVATE-AUTHOR</header><div class="content">공개 본문</div><footer>PRIVATE-IP</footer></article>','공개 본문'),
    ('https://damoang.net/stock/1','<div id="economy-post-content" class="prose">공개 본문</div><div>PRIVATE-AUTHOR</div>','공개 본문'),
    ('https://www.82cook.com/entiz/read.php?bn=15&num=1','<div id="articleBody">공개 본문</div><div>PRIVATE-AUTHOR</div>','공개 본문'),
])
def test_new_source_bodies_are_internal_readable_content_without_profile_chrome(url,html,expected):
    body=f.parse_preview(html,url,False)
    assert body['status']=='ok' and body['text']==expected
    assert 'PRIVATE' not in str(body) and 'evil' not in str(body)

def test_permalink_survives_expired_snapshot_without_replacing_latest_feed(monkeypatch):
    monkeypatch.setattr(f,'_snapshots',f.OrderedDict())
    monkeypatch.setattr(f,'_latest',{'kr':'existing-feed'})
    html='<script type="application/ld+json">'+json.dumps({'@type':'Article','headline':'삼성전자 실적 분석','datePublished':'2026-11-07T12:01:02+09:00'})+'</script><div class="JS_ContentMain"><p>전체 공개 본문</p></div>'
    calls=[]
    monkeypatch.setattr(f,'_get',lambda url:(calls.append(url) or html))
    result=f.entry('kr','pp-stock-42','f'*32)
    assert result['post']['id']=='pp-stock-42'
    assert calls==['https://www.ppomppu.co.kr/zboard/view.php?id=stock&no=42']
    assert f._latest=={'kr':'existing-feed'}
    assert f.preview('kr',result['snapshot'],'pp-stock-42')['text']=='전체 공개 본문'
    assert f.entry('kr','pp-stock-42',result['snapshot'])==result
    with pytest.raises(LookupError):f.entry('global','pp-stock-42')
    with pytest.raises(LookupError):f.entry('kr','dc-kospi-42')
    with pytest.raises(LookupError):f.entry('property','pp-stock-42')

def test_isolated_router_validates_new_ids_without_app_startup(monkeypatch):
    app=FastAPI();app.include_router(router,prefix='/api/community')
    with patch('app.routers.community.entry',return_value={'post':{'id':'pp-stock-42'},'snapshot':'a'*32}):
        with TestClient(app) as client:
            assert client.get('/api/community/kr/entry?post_id=pp-stock-42').status_code==200
            assert client.get('/api/community/kr/entry?post_id=https://evil.test').status_code==422
            assert client.get('/api/community/other/entry?post_id=pp-stock-42').status_code==404


def test_82_internal_permalink_uses_article_heading_and_creation_date(monkeypatch):
    monkeypatch.setattr(f,'_snapshots',f.OrderedDict())
    monkeypatch.setattr(f,'_latest',{})
    html='<h1>사이트 로고</h1><h4 class="bbstitle">아파트 전세 계약과 대출 질문</h4><div class="readRight">작성일 : 2026-11-07 12:01:02</div><div id="articleBody">실거주 전세 계약 본문</div>'
    monkeypatch.setattr(f,'_get',lambda *a:html)
    result=f.entry('property','82-42')
    assert result['post']['title']=='아파트 전세 계약과 대출 질문'
    assert result['post']['published_at']=='2026-11-07T03:01:02+00:00'
