"""Kakao receives apartment-specific raw HTML without app startup or a database."""
import html
import re
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest
from test_stock_report_seo import renderer

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
    assert shared['name'] == ['강남데시앙포레'] and shared['f'] == ['7']
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
