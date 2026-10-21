"""Raw server HTML metadata with isolated renderer fixtures; no database imports."""
import hashlib,html,json,re
from pathlib import Path
from PIL import Image
from test_stock_report_seo import renderer

ROOT=Path(__file__).resolve().parents[2]
CARDS=json.loads((ROOT/'backend/app/data/social_cards.json').read_text(encoding='utf-8'))


def test_every_navigation_destination_has_unique_original_share_art():
    source=(ROOT/'frontend/src/neo/navigation.ts').read_text(encoding='utf-8').split('] as const;')[0]
    paths={match.split('?')[0] for match in re.findall(r'\["(/[^\"]*)", "[^\"]+", "[^\"]+"\]',source)}
    assert paths==set(CARDS) and len(paths)==42
    assert json.loads((ROOT/'frontend/src/neo/socialCards.json').read_text(encoding='utf-8'))==CARDS
    hashes=[]
    for card in CARDS.values():
        path=ROOT/'frontend/public'/card['image'].lstrip('/')
        hashes.append(hashlib.sha256(path.read_bytes()).hexdigest())
        with Image.open(path) as image:assert image.size==(1200,630) and image.format=='PNG'
    assert len(set(hashes))==42
    assert len({card['title'] for card in CARDS.values()})==42
    assert len({card['description'] for card in CARDS.values()})==42


def test_raw_html_has_page_specific_og_twitter_and_structured_images(renderer):
    renderer['SOCIAL_CARDS']=CARDS
    template=(ROOT/'frontend/index.html').read_text(encoding='utf-8')
    for path,card in CARDS.items():
        document=renderer['render_spa_shell'](template,path,{})
        for attribute,value in [('property="og:title"',card['title']),('property="og:description"',card['description']),('property="og:image"','https://kospimap.com'+card['image']),('name="twitter:image"','https://kospimap.com'+card['image']),('property="og:image:alt"',card['alt'])]:
            assert f'<meta {attribute} content="{html.escape(value,quote=True)}"' in document,path
        assert f'<link rel="canonical" href="https://kospimap.com{path}"' in document,path
        assert '"image": "https://kospimap.com'+card['image']+'"' in document,path


def test_dynamic_report_image_and_escaped_share_query_are_preserved(renderer):
    renderer['SOCIAL_CARDS']=CARDS
    template=(ROOT/'frontend/index.html').read_text(encoding='utf-8')
    output=renderer['render_spa_shell'](template,'/discussion-explorer',{'code':'005930','name':'<삼성 & 전자>'})
    assert 'https://kospimap.com'+CARDS['/discussion-explorer']['image'] in output
    assert '<삼성 & 전자>' not in output
