"""Asset monitoring graph and seven distinct runtime routes; no app or database."""
from fastapi import FastAPI
from app.routers.asset_prices import router
from app.services.asset_prices import ASSETS
from app.services import site_graph


def test_each_asset_has_a_separate_page_api_and_yahoo_dependency():
    app=FastAPI();app.include_router(router,prefix='/api/market/assets')
    graph=site_graph.build_graph(app.routes)
    paths={route.path for route in app.routes if route.path.startswith('/api/market/assets/')}
    assert paths=={f'/api/market/assets/{key}/history' for key in ASSETS}
    assert len(paths)==7 and all('{' not in path for path in paths)
    labels=[]
    for key in ASSETS:
        page=f'page:/prices/{key}';api=f'api:/api/market/assets/{key}/history'
        node=next(node for node in graph['nodes'] if node['id']==page)
        labels.append(node['label'])
        assert {'source':page,'target':api,'kind':'call'} in graph['edges']
        assert {'source':api,'target':'up:yahoo','kind':'depend'} in graph['edges']
        assert {'source':api,'target':'store:cache','kind':'depend'} in graph['edges']
        assert not any(page in warning and '/assets/' in warning for warning in graph['warnings'])
    assert len(set(labels))==7
