"""Kakao receives apartment-specific raw HTML without app startup or a database."""
import html
import re
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest
from test_stock_report_seo import renderer
from app.services.walk_share import expand_walk_query, compact_walk_query

TEMPLATE = (Path(__file__).parents[2] / 'frontend/index.html').read_text(encoding='utf-8')


def meta(document, key):
    return html.unescape(re.search(r'<meta property="' + key + r'" content="([^"]*)"', document)[1])


@pytest.mark.parametrize('path', ['/walk', '/walk/', '/walk/room'])
def test_apartment_title_and_thumbnail_survive_raw_crawler_html(renderer, path):
    query = {'name': '강남데시앙포레', 'at': '37.5,127.05', 'id': '11680:수서동:795:강남데시앙포레', 'f': '7', 'back': '/private-return', 'token': 'do-not-share'}
    doc = renderer['render_spa_shell'](TEMPLATE, path, query)
    assert meta(doc, 'og:title') == '강남데시앙포레 | 룸투어(임장) | KOSPIMAP'
    assert '강남데시앙포레의 평형' in meta(doc, 'og:description')
    assert meta(doc, 'og:image') == 'https://kospimap.com/img/social/walk-roomtour-v1.png'
    assert meta(doc, 'og:image:secure_url') == meta(doc, 'og:image')
    shared = parse_qs(urlsplit(meta(doc, 'og:url')).query)
    decoded = expand_walk_query({k: v[0] for k, v in shared.items()})
    assert decoded['id'] == query['id'] and decoded['f'] == '7'
    assert not {'name', 'id'} & shared.keys()
    assert 'token' not in shared and 'back' not in shared


def test_legacy_complex_id_and_generic_links_have_roomtour_metadata(renderer):
    render = renderer['render_spa_shell']
    assert meta(render(TEMPLATE, '/walk', {'id': '11680:수서동:1:삼익'}), 'og:title').startswith('삼익 | 룸투어')
    assert meta(render(TEMPLATE, '/walk', {}), 'og:title') == '룸투어(임장) | KOSPIMAP'
    # No HTML injection, even when a supplied public label is malformed.
    doc = render(TEMPLATE, '/walk', {'name': '<script>" & 테스트\\q\n'})
    assert '<script>" & 테스트' not in doc
    assert '&amp;' in doc


def test_generated_share_art_matches_og_dimensions_and_size():
    from PIL import Image
    image = Path(__file__).parents[2] / 'frontend/public/img/social/walk-roomtour-v1.png'
    assert image.stat().st_size < 5 * 1024 * 1024
    with Image.open(image) as artwork:
        assert artwork.size == (1729, 910) and artwork.format == 'PNG'


def test_compact_core_identity_has_same_title_area_and_short_url(renderer):
    original = {'id': '11680:수서동:795:강남데시앙포레', 'name': '강남데시앙포레', 'area': '84.86', 'tour': '1', 'back': '/realestate-map?long=1', 'hour': '14'}
    compact = compact_walk_query(original)
    assert set(compact) == {'c', 'a'}
    doc = renderer['render_spa_shell'](TEMPLATE, '/walk', compact)
    assert meta(doc, 'og:title') == '강남데시앙포레 | 룸투어(임장) | KOSPIMAP'
    assert len(meta(doc, 'og:url')) < 100
    decoded = expand_walk_query(compact)
    assert decoded['id'] == original['id'] and decoded['area'] == '84.86' and decoded['tour'] == '1'
    assert compact_walk_query(decoded) == compact


@pytest.mark.parametrize('token', ['bad_', '###', 'A' * 900, 'AA', 'wA'])
def test_bad_compact_tokens_do_not_raise_or_become_apartment_ids(token):
    assert 'id' not in expand_walk_query({'c': token})
