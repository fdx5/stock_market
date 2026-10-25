"""Public distribution features: pure fixtures, no app startup or saved databases."""
import ast
import html
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from xml.etree import ElementTree as ET

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from app.services import public_markets as markets
from app.routers import public_markets as routes


@pytest.fixture
def snapshot():
    return markets.summarize('kospi', [
        {'code': '005930', 'name': '삼성전자', 'close': 100, 'change_pct': 2, 'volume': 10, 'sector': '반도체'},
        {'code': '000660', 'name': 'SK하이닉스', 'close': 200, 'change_pct': -4, 'turnover': 700, 'sector': '반도체'},
        {'code': '035420', 'name': '<script>NAVER</script>', 'close': 50, 'change_pct': 0},
        {'code': '005380', 'name': '현대차', 'close': 40},
        {'code': '005930', 'close': 900, 'change_pct': 80},
        {'code': 'bad/code', 'close': 100}, {'code': 'ZERO', 'close': 0},
        {'code': 'NAN', 'close': float('nan')},
    ], '2026-10-23T16:30:00+09:00')


def test_distribution_preserves_missing_values_and_sample_basis(snapshot):
    assert (snapshot['count'], snapshot['known_count']) == (4, 3)
    assert (snapshot['up'], snapshot['down'], snapshot['flat'], snapshot['missing_change']) == (1, 1, 1, 1)
    assert snapshot['average_change'] == pytest.approx(-2 / 3)
    assert snapshot['advance_ratio'] == pytest.approx(100 / 3)
    assert '단순평균' in snapshot['basis'] and '전체 시장' in snapshot['basis']
    assert snapshot['turnover'][0]['turnover_kind'] == 'estimate'
    assert snapshot['turnover'][0]['turnover'] == 1000
    assert snapshot['turnover'][1]['turnover_kind'] == 'reported'
    assert not any(key.startswith('_') for key in markets.public_payload(snapshot))


def test_widget_escapes_names_and_contains_only_public_referral_links(snapshot):
    document = markets.widget_html('kospi', snapshot)
    assert '<script>' not in document and '<script>NAVER</script>' not in document
    assert '&lt;script&gt;NAVER&lt;/script&gt;' in document
    assert 'data-design="neo"' in document and '/public-market-widget.css' in document
    assert 'utm_source=market_widget' in document and 'utm_medium=referral' in document
    assert 'collected_at' not in document and snapshot['collected_at'] in document
    assert 'localStorage' not in document and 'cookie' not in document


def test_market_specific_sources_and_empty_data():
    value = markets.summarize('nasdaq100', [{'code': 'AAPL', 'name': 'Apple', 'close': 200, 'change_pct': 1}], '2026-10-23T21:00:00+09:00')
    assert value['currency'] == 'USD' and value['market'] == 'nasdaq100'
    assert value['turnover'] == []
    empty = markets.summarize('kosdaq', [], '2026-10-23T16:30:00+09:00')
    assert empty['average_change'] is None and empty['advance_ratio'] is None
    assert '준비 중' in markets.widget_html('kosdaq', None)


def test_card_is_valid_share_image(snapshot):
    image = Image.open(BytesIO(markets.card_png(snapshot)))
    assert image.size == (1200, 630) and image.format == 'PNG'
    assert image.getpixel((0, 0)) == (11, 7, 14)


def test_ics_folds_utf8_without_losing_text():
    source = 'DESCRIPTION:' + '시장 흐름 확인. ' * 30
    folded = markets.calendar_lines([source, 'END:VEVENT', ''])
    assert all(len(line.encode('utf-8')) <= 75 for line in folded.split('\r\n'))
    assert folded.replace('\r\n ', '').split('\r\n')[0] == source
    content = routes.reminder().body.decode('utf-8')
    assert 'DTSTART:20261026T073000Z' in content and 'BYDAY=MO,TU,WE,TH,FR' in content
    assert '휴장일' in content.replace('\r\n ', '')


def test_closing_feed_uses_real_publications_stable_guids_and_no_fake_freshness():
    rows = [{'date': '2026-10-23', 'market': 'KOSPI', 'created_at': '2026-10-23T08:30:00Z'},
            {'date': '2026-10-23', 'market': 'KOSPI', 'created_at': '2026-10-25T08:30:00Z'},
            {'date': '2026-10-22', 'market': 'kosdaq', 'created_at': 'unknown'},
            {'date': '2026-02-30', 'market': 'kospi'}, {'date': '<script>', 'market': 'kospi'}]
    root = ET.fromstring(markets.brief_feed(rows))
    entries = root.findall('./channel/item')
    assert len(entries) == 2
    assert entries[0].findtext('pubDate') == 'Fri, 23 Oct 2026 08:30:00 +0000'
    assert entries[1].find('pubDate') is None
    assert entries[0].findtext('guid') == 'https://kospimap.com/market-brief/2026-10-23/kospi'
    assert 'utm_source=market_feed&utm_medium=referral&utm_campaign=repeat_visit' in entries[0].findtext('link')
    assert root.findtext('./channel/lastBuildDate') == entries[0].findtext('pubDate')


def test_public_endpoints_validate_market_and_handle_source_failure(monkeypatch, snapshot):
    app = FastAPI(); app.include_router(routes.router)
    monkeypatch.setattr(markets, 'snapshot', lambda market: snapshot)
    with TestClient(app) as client:
        response = client.get('/market-snapshot/kospi.json')
        assert response.status_code == 200 and '_rows' not in response.json()
        assert client.get('/market-snapshot/unknown.json').status_code == 422
        widget = client.get('/embed/market/kospi')
        assert widget.status_code == 200 and 'set-cookie' not in widget.headers
        assert 'frame-ancestors *' in widget.headers['content-security-policy']
        assert widget.headers['x-robots-tag'] == 'noindex, follow'
        monkeypatch.setattr(markets, 'snapshot', lambda _market: (_ for _ in ()).throw(RuntimeError('not ready')))
        assert client.get('/market-snapshot/kospi.json').status_code == 503
        assert '준비 중' in client.get('/embed/market/kospi').text


def test_seo_shows_actual_values_and_escapes_public_data(monkeypatch, snapshot):
    monkeypatch.setattr(markets, 'snapshot', lambda _market: snapshot)
    body = markets.seo_content('/today')
    assert '상승 1, 하락 1, 보합 1' in body
    assert '100.00 KRW' in body and '화면 집계' in body
    assert '<script>NAVER</script>' not in body
    assert html.escape('<script>NAVER</script>') in body
