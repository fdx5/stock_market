"""Pure photo selection tests: extract functions without loading app, secrets or DB."""
import ast
import concurrent.futures as cf
import math
from pathlib import Path
import re
from types import SimpleNamespace
import unittest
import urllib.parse

source = Path(__file__).resolve().parents[1] / 'backend/app/services/realestate_building_info.py'
tree = ast.parse(source.read_text(encoding='utf8'))
names = {'_blog_photo', '_photos', '_wiki', '_dist', '_num', 'building_info'}
functions = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names], type_ignores=[])
scope = {'re': re, 'math': math, 'urllib': urllib, 'UA': 'isolated-test', 'KAKAO_IMAGE': 'https://test.invalid/image',
         'WIKI_SUMMARY': 'https://test.invalid/wiki/', '_kakao_key': lambda: 'synthetic'}
exec(compile(functions, str(source), 'exec'), scope)
originals = dict(scope)

class PhotoSources(unittest.TestCase):
    def setUp(self):
        scope.update(originals)

    def response(self, data, status=200):
        return SimpleNamespace(json=lambda: data, status_code=status, raise_for_status=lambda: None)

    def test_blog_hosts_and_malformed_links(self):
        for url in ['https://m.blog.naver.com/post', 'https://blogfiles.pstatic.net/file', 'https://postfiles.pstatic.net/file',
                    'https://blogthumb.pstatic.net/file', 'https://example.tistory.com/file', 'https://naver.me/redirect', 'https://[broken']:
            self.assertTrue(scope['_blog_photo']({'thumb': url}))
        self.assertFalse(scope['_blog_photo']({'thumb': 'https://upload.wikimedia.org/photo.jpg', 'link': 'https://official.example/building'}))

    def test_search_keeps_building_photo_and_rejects_blog(self):
        def document(host, site):
            return {'thumbnail_url': f'https://{host}/thumb', 'image_url': f'https://{host}/full', 'display_sitename': site,
                    'doc_url': f'https://{host}/building', 'width': 1000, 'height': 800}
        scope['requests'] = SimpleNamespace(get=lambda *a, **k: self.response({'documents': [document('blog.naver.com','블로그'), document('official.example','건물 안내')]}))
        self.assertEqual([p['site'] for p in scope['_photos']('망미동 "한성기린" 전경')], ['건물 안내'])

    def test_wiki_geotag_and_original(self):
        data = {'type': 'standard', 'title': '건물', 'coordinates': {'lat':35.17,'lon':129.12},
                'thumbnail': {'source':'https://wiki.example/thumb'}, 'originalimage': {'source':'https://wiki.example/full'}}
        scope['requests'] = SimpleNamespace(get=lambda *a, **k: self.response(data))
        self.assertEqual(scope['_wiki']('건물',35.17,129.12)['image'],'https://wiki.example/full')
        self.assertIsNone(scope['_wiki']('건물',37.56,126.97))
        data['type']='disambiguation';self.assertIsNone(scope['_wiki']('건물',35.17,129.12))

    def card(self, wiki):
        queries=[]
        scope.update({'_cached':lambda key, ttl, fn: fn(), '_register': lambda pnu: None, '_place':lambda *a: None,
                      '_wiki':lambda *a:wiki,
                      '_commons':lambda *a:[{'thumb':'https://commons.example/named','near':False},{'thumb':'https://commons.example/other','near':True}],
                      '_photos':lambda query:queries.append(query) or [{'thumb':'https://official.example/photo'},{'thumb':'https://blogfiles.pstatic.net/blog'}]})
        with cf.ThreadPoolExecutor(max_workers=4) as pool:
            scope['_pool']=pool
            card=scope['building_info']('한성기린',35.17,129.12,area='망미동')
        self.assertEqual(queries,['망미동 "한성기린" 전경'])
        return card

    def test_article_leads_named_commons_and_search(self):
        card=self.card({'thumb':'https://wiki.example/thumb','image':'https://wiki.example/full','url':'https://wiki.example/article'})
        self.assertEqual([p['thumb'] for p in card['photos']],['https://wiki.example/thumb','https://commons.example/named','https://official.example/photo'])
        self.assertEqual(card['photos'][0]['image'],'https://wiki.example/full')

    def test_no_article_keeps_non_blog_fallback(self):
        card=self.card(None)
        self.assertEqual([p['thumb'] for p in card['photos']],['https://commons.example/named','https://official.example/photo'])

if __name__ == '__main__':
    unittest.main()
