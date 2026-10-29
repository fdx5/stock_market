"""Public location fixtures, isolated from all databases and upstream services."""
from app.services import realestate_places as rp


def test_shop_register_does_not_hide_hospitals_public_offices_or_stations(monkeypatch):
    shop={"name":"상가","lat":37.5,"lon":127.1,"kind":"store","floor":1}
    monkeypatch.setattr(rp,"_cached",lambda key,ttl,fetch:fetch())
    monkeypatch.setattr(rp,"_sbiz",lambda *args:[shop])
    def group(code,*args):
        return [{"name":code,"lat":37.5,"lon":127.1,"kind":rp.GROUPS[code]}]
    monkeypatch.setattr(rp,"_group",group)
    result=rp.places(37.5,127.1,300)
    assert {p['kind'] for p in result['items']} >= {'store','clinic','public','station'}


def test_basement_floors_are_negative():
    assert rp._floor("B1") == -1 and rp._floor("지하2") == -2 and rp._floor("지1") == -1
    assert rp._floor("3") == 3 and rp._floor("") is None
