"""Run the rendering functions with independent catalog fixtures, without DB imports."""
import ast
import html
import json
import re
from pathlib import Path
from urllib.parse import urlencode

import pytest


@pytest.fixture
def renderer():
    source = ast.parse((Path(__file__).parents[1] / 'app/services/seo.py').read_text(encoding='utf-8'))
    catalog = {'005930': ('삼성전자', 'kr_stock'), '069500': ('KODEX 200', 'kr_etf'), 'AAPL': ('Apple', 'us_stock'), 'SPY': ('SPDR S&P 500 ETF', 'us_etf')}
    def stock_entry(path):
        code = path.split('/')[-1].upper()
        return (code, *catalog[code]) if code in catalog else ('', '', '')
    class FixtureCache:
        def get_or_set(self, _key, _ttl, build):
            return build()
    env = dict(re=re, html=html, json=json, urlencode=urlencode, SITE='https://kospimap.com', IMAGE='fixture.png', PAGES={'/':('Home','Home description')}, INVESTOR_HUB='/market/kospi/foreign-buying',
               STOCK_LANDING_ROUTE=re.compile(r'/stock/(\d{6})/(investor|outlook|news)'), STOCK_ROUTE=re.compile(r'/stock/([A-Za-z0-9.-]{1,16})'), INVESTOR_ROUTE=re.compile(r'/investor/([A-Za-z0-9.-]{1,16})'), KRX_CODE=re.compile(r'\d[0-9A-Z]{5}'),
               _stock_entry=stock_entry, _market_brief=lambda _path:(None,'',''), _investor_identity=lambda _path:('',''), _detail_neighbours=lambda *_args:[], _kr_etf_names=lambda:{'069500':'KODEX 200'}, kr_universe=lambda:[{'code':'005930'}], cache=FixtureCache())
    funcs = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in {'_replace_meta','render_spa_shell','is_unknown_kr_code'}]
    exec(compile(ast.Module(body=funcs,type_ignores=[]),'seo-fixture','exec'), env)
    return env


@pytest.mark.parametrize('code', ['005930','069500','aapl','SPY'])
def test_report_has_its_own_metadata_canonical_and_evidence_link(renderer, code):
    template = '<html><head><title>Home</title><meta name="description" content="Home"><meta property="og:title" content="Home"><meta property="og:url" content="Home"><link rel="canonical" href="Home"></head><body><div id="root"></div></body></html>'
    document = renderer['render_spa_shell'](template, f'/stock/{code}/report', {})
    assert '종목 한 장 보고서' in document
    assert f'https://kospimap.com/stock/{code.upper()}/report' in document
    assert f'href="/stock/{code.upper()}"' in document
    assert '종목 상세와 분석 원표' in document
    assert '가격 변화, 기간 수익률' in document


def test_report_preserves_existing_stock_detail_metadata(renderer):
    document = renderer['render_spa_shell']('<html><head><title>Home</title></head><body><div id="root"></div></body></html>', '/stock/005930', {})
    assert '삼성전자 주가·차트' in document
    assert '종목 한 장 보고서' not in document


def test_unknown_kr_report_codes_are_real_404_candidates(renderer):
    check = renderer['is_unknown_kr_code']
    assert check('/stock/999999/report')
    assert not check('/stock/005930/report')
    assert not check('/stock/069500/report')
    assert not check('/stock/AAPL/report')
