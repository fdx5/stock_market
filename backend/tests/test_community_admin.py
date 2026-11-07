"""Administration metadata checks with an isolated FastAPI app; no DB or lifespan."""
from unittest import TestCase
from unittest.mock import patch
from fastapi import FastAPI
from app.routers.community import router
from app.services import site_graph, system_atlas


class CommunityAdminTests(TestCase):
    def test_three_pages_have_api_and_upstream_edges(self):
        app = FastAPI()
        app.include_router(router, prefix='/api/community')
        graph = site_graph.build_graph(app.routes)
        for board in ('kr','global','property'):
            node = f'page:/community/{board}'
            self.assertTrue(any(n['id']==node for n in graph['nodes']))
            for api in ('/api/community/{board}', '/api/community/{board}/post', '/api/community/{board}/comments'):
                self.assertIn({'source':node,'target':'api:'+api,'kind':'call'},graph['edges'])
                for source in ('up:ppomppu','up:damoang','up:clien','up:82cook','store:cache'):
                    self.assertIn({'source':'api:'+api,'target':source,'kind':'depend'},graph['edges'])
        self.assertFalse(any('→ /api/community' in warning for warning in graph['warnings']))

    def test_community_endpoints_and_sources_use_content_group(self):
        self.assertEqual(system_atlas.group_for('app.routers.community'),'community')
        self.assertEqual(system_atlas.group_for('app.services.community_feed'),'community')
        with patch.dict(system_atlas.os.environ,{},clear=True):
            self.assertEqual(system_atlas.host_group('www.paxnet.co.kr'),'ext-content')
            self.assertEqual(system_atlas.host_group('www.82cook.com'),'ext-content')
