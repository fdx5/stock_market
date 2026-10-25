"""Run the rendering functions with independent catalog fixtures, without DB imports."""
import ast
import html
import json
import re
from pathlib import Path
from urllib.parse import urlencode

import pytest
from app.services import market_guides


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
    env = dict(re=re, html=html, json=json, urlencode=urlencode, market_guides=market_guides, SOCIAL_CARDS={}, SITE='https://kospimap.com', IMAGE='fixture.png', PAGES={'/':('Home','Home description'), **market_guides.PAGES}, INVESTOR_HUB='/market/kospi/foreign-buying',
               STOCK_LANDING_ROUTE=re.compile(r'/stock/(\d{6})/(investor|outlook|news)'), STOCK_ROUTE=re.compile(r'/stock/([A-Za-z0-9.-]{1,16})'), INVESTOR_ROUTE=re.compile(r'/investor/([A-Za-z0-9.-]{1,16})'), KRX_CODE=re.compile(r'\d[0-9A-Z]{5}'),
               _stock_entry=stock_entry, _market_brief=lambda _path:(None,'',''), _investor_identity=lambda _path:('',''), _detail_neighbours=lambda *_args:[], _kr_etf_names=lambda:{'069500':'KODEX 200'}, kr_universe=lambda:[{'code':'005930'}], cache=FixtureCache())
    funcs = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in {'_replace_meta','render_spa_shell','is_unknown_kr_code'}]
    exec(compile(ast.Module(body=funcs,type_ignores=[]),'seo-fixture','exec'), env)
    return env


@pytest.mark.parametrize('path', market_guides.PAGES)
def test_guides_have_complete_body_and_matching_structured_data_without_javascript(renderer, path):
    template = (Path(__file__).parents[2] / 'frontend/index.html').read_text(encoding='utf-8')
    document = renderer['render_spa_shell'](template, path + '/', {'utm_source': 'test', 'token': 'must-not-leak'})
    assert f'<link rel="canonical" href="https://kospimap.com{path}"' in document
    assert 'must-not-leak' not in document
    assert document.count('<h1 ') == 1
    assert f'<title>{html.escape(market_guides.PAGES[path][0])}</title>' in document
    structured = re.search(r'<script id="route-structured-data" type="application/ld\+json">(.*?)</script>', document).group(1)
    assert json.loads(structured) == market_guides.structured_data(path, 'https://kospimap.com')
    guide = market_guides.GUIDES.get(path)
    if guide:
        for section in guide['sections']:
            for paragraph in section['paragraphs']:
                assert html.escape(paragraph) in document
        for tool in guide['tools']:
            assert f'href="{tool["href"]}"' in document
    else:
        for other in market_guides.GUIDES:
            assert f'href="{other}"' in document


def test_editorial_sitemap_uses_publication_date_and_has_no_duplicate_urls(renderer):
    from datetime import date, timedelta
    from types import SimpleNamespace
    from xml.etree import ElementTree
    source = ast.parse((Path(__file__).parents[1] / 'app/services/seo.py').read_text(encoding='utf-8'))
    funcs = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in {'_urlset', 'build_pages_sitemap'}]
    class FutureDate(date):
        @classmethod
        def today(cls):
            return date.fromisoformat(market_guides.CATALOG['updated']) + timedelta(days=15)
    renderer.update(date=FutureDate, market_brief_store=SimpleNamespace(dates=lambda _limit: []))
    exec(compile(ast.Module(body=funcs, type_ignores=[]), 'sitemap-fixture', 'exec'), renderer)
    root = ElementTree.fromstring(renderer['build_pages_sitemap']())
    ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
    entries = {item.find('s:loc', ns).text: item for item in root}
    assert len(entries) == len(root)
    for path in market_guides.PAGES:
        item = entries['https://kospimap.com' + path]
        assert item.find('s:lastmod', ns).text == market_guides.CATALOG['updated']


def test_guide_html_escapes_editorial_text(monkeypatch):
    path = '/guides/test-escape'
    monkeypatch.setitem(market_guides.GUIDES, path, {
        'minutes': 1, 'sections': [{'title': '<script>title</script>', 'paragraphs': ['<img src=x onerror=alert(1)>']}],
        'tools': [{'href': '/map?value="quoted"', 'label': '<b>open</b>'}],
    })
    document = market_guides.render_content(path)
    assert '<script>' not in document and '<img' not in document and '<b>' not in document
    assert '&lt;img' in document and '&quot;quoted&quot;' in document
