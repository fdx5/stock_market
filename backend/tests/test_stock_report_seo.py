"""Run the rendering functions with independent catalog fixtures, without DB imports."""
import ast
import html
import json
import re
from pathlib import Path
from types import SimpleNamespace
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
    env = dict(re=re, html=html, json=json, urlencode=urlencode, SITE='https://kospimap.com', IMAGE='fixture.png', SOCIAL_CARDS={}, PAGES={'/':('Home','Home description')}, INVESTOR_HUB='/market/kospi/foreign-buying',
               STOCK_LANDING_ROUTE=re.compile(r'/stock/(\d{6})/(investor|outlook|news)'), STOCK_ROUTE=re.compile(r'/stock/([A-Za-z0-9.-]{1,16})'), INVESTOR_ROUTE=re.compile(r'/investor/([A-Za-z0-9.-]{1,16})'), KRX_CODE=re.compile(r'\d[0-9A-Z]{5}'),
               _stock_entry=stock_entry, _stock_identity=lambda path: stock_entry(path)[:2], _market_brief=lambda _path:(None,'',''), _investor_identity=lambda _path:('',''), _detail_neighbours=lambda *_args:[], _kr_etf_names=lambda:{'069500':'KODEX 200'}, kr_universe=lambda:[{'code':'005930','market':'KOSPI'}], cache=FixtureCache(),
               investor_fetcher=SimpleNamespace(get_investor_trend=lambda code, _size: TREND if code == '005930' else []))
    funcs = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in {'_replace_meta','render_spa_shell','is_unknown_kr_code','legacy_redirect','_investor_digest','_kr_stock_numbers','_kr_rank','_moving_average','_rsi','_amount'}]
    env['public_markets'] = SimpleNamespace(MARKETS={'kospi': {'name': 'KOSPI'}}, PAGES={}, seo_content=lambda *_args: '')
    env['market_guides'] = SimpleNamespace(GUIDES={}, PAGES={})
    env['index_landing'] = SimpleNamespace(BY_PATH={}, PAGES={})
    env['hot_issues'] = SimpleNamespace(PAGE=('', ''), render_content=lambda: '', structured_data=lambda _site: {})
    exec(compile(ast.Module(body=funcs,type_ignores=[]),'seo-fixture','exec'), env)
    page_catalog = next(node.value for node in source.body if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == 'PAGES')
    env['PAGES'].update({key.value: ast.literal_eval(value) for key, value in zip(page_catalog.keys, page_catalog.values)
                         if isinstance(key, ast.Constant) and isinstance(key.value, str) and key.value.startswith('/etf')})
    return env


# Newest first, as Naver returns them: 30 sessions rising 100 won a day to 72,900.
TREND = [{'date': f'2026-11-{30 - i:02d}', 'close': 72900.0 - 100 * i, 'change': 100.0,
          'individual_amount': -1.0, 'institution_amount': 0.5, 'foreign_amount': 0.5} for i in range(30)]


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


@pytest.mark.parametrize('path,query,canonical,title', [
    ('/etf/kr', {}, '/etf/kr', '국내 ETF 마켓'),
    ('/etf/us', {}, '/etf/us', '해외 ETF 마켓'),
    ('/etf', {}, '/etf/kr', '국내 ETF 마켓'),
    ('/etf', {'region': 'US'}, '/etf/us', '해외 ETF 마켓'),
])
def test_etf_markets_and_legacy_links_share_the_correct_canonical(renderer, path, query, canonical, title):
    template = '<html><head><title>Home</title><meta name="description" content="Home"><meta property="og:title" content="Home"><meta property="og:url" content="Home"><link rel="canonical" href="Home"></head><body><div id="root"></div></body></html>'
    document = renderer['render_spa_shell'](template, path, query)
    assert f'<title>{title}' in document
    assert f'href="https://kospimap.com{canonical}"' in document
    assert 'href="/etf/kr"' in document and 'href="/etf/us"' in document


def test_kr_stock_pages_carry_their_own_numbers(renderer):
    template = '<html><head><title>Home</title><meta name="description" content="Home"></head><body><div id="root"></div></body></html>'
    detail = renderer['render_spa_shell'](template, '/stock/005930', {})
    assert '72,900원' in detail and '시가총액 1위' in detail and 'KOSPI 상장' in detail
    assert '최근 10거래일 종가와 수급' in detail
    assert 'content="삼성전자(005930) 2026-11-30 종가 72,900원' in detail
    outlook = renderer['render_spa_shell'](template, '/stock/005930/outlook', {})
    assert '5일 이동평균 72,700원' in outlook and '정배열' in outlook and 'RSI(14)는 100.0' in outlook
    assert '20일 이동평균 71,950원' in outlook and '5일 이동평균' not in detail
    renderer['investor_fetcher'] = SimpleNamespace(get_investor_trend=lambda *_: TREND[:10])
    short = renderer['render_spa_shell'](template, '/stock/005930/outlook', {})
    assert '10일 이동평균 72,450원' in short and 'RSI' not in short.split('최근 10거래일 종가와 수급')[0].split('지표는 참고')[0].split('5일 이동평균')[-1]


def test_kr_stock_without_data_keeps_the_plain_shell(renderer):
    renderer['investor_fetcher'] = SimpleNamespace(get_investor_trend=lambda *_: (_ for _ in ()).throw(RuntimeError('down')))
    document = renderer['render_spa_shell']('<html><head><title>Home</title></head><body><div id="root"></div></body></html>', '/stock/005930', {})
    assert '삼성전자 주가·차트' in document and '최근 10거래일' not in document


def test_news_code_links_redirect_to_the_stock_page(renderer):
    move = renderer['legacy_redirect']
    assert move('/news', {'code': '005930'}) == '/stock/005930/news'
    assert move('/news', {'code': 'aapl'}) == '/stock/AAPL'
    assert move('/news', {'code': '069500'}) == '/stock/069500'
    assert move('/news', {'code': 'NOPE', 'c': 'X'}) == '/news?c=X'
    assert move('/news', {}) is None
    assert move('/stock/005930', {'code': '005930'}) is None


def test_robots_blocks_query_variants_of_canonical_pages():
    robots = (Path(__file__).parents[2] / 'frontend/public/robots.txt').read_text(encoding='utf-8')
    source = (Path(__file__).parents[1] / 'app/services/discovery_catalog.py').read_text(encoding='utf-8')
    for path in re.findall(r"\('(/[a-z-]+)',", source) + ['/news', '/desk', '/global', '/discussion-explorer']:
        assert robots.splitlines().count(f'Disallow: {path}?') == 2, path
    lines = robots.splitlines()
    assert not {'Disallow: /stock', 'Disallow: /stock/', 'Disallow: /news', 'Disallow: /'} & set(lines)
