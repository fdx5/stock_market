from app.services import realestate_places as rp


def test_places_merge_and_dedupe(monkeypatch):
    calls = []
    def fake(code, lat, lon, radius):
        calls.append(code)
        return [{"name": "가게", "kind": rp.GROUPS[code], "category": None, "lat": 37.5, "lon": 127.0}] if code in ("FD6", "CE7") else []
    monkeypatch.setattr(rp, "_group", fake)
    monkeypatch.setattr(rp, "_sbiz", lambda lat, lon, r: [])
    __import__("app.services.realestate_building_info", fromlist=["_memo"])._memo.clear()
    d = rp.places(37.5, 127.05, 300)
    assert len(d["items"]) == 1 and set(calls) == set(rp.GROUPS)


def test_places_rejects_outside_korea():
    import pytest
    with pytest.raises(ValueError):
        rp.places(10.0, 127.0)


def test_places_prefers_the_shop_register(monkeypatch):
    monkeypatch.setattr(rp, "_sbiz", lambda lat, lon, r: [{"name": "OO약국", "kind": "pharmacy", "category": "약국", "lat": 37.5, "lon": 127.0, "floor": 1}])
    monkeypatch.setattr(rp, "_group", lambda *a: (_ for _ in ()).throw(AssertionError("kakao not asked")))
    __import__("app.services.realestate_building_info", fromlist=["_memo"])._memo.clear()
    d = rp.places(37.51, 127.06, 300)
    assert d["items"][0]["floor"] == 1 and "소상공인" in d["source"]


def test_kind_of():
    assert rp._kind_of("음식", "커피점/카페", "") == "cafe"
    assert rp._kind_of("소매", "의약·의료용품", "약국") == "pharmacy"
