from app.services import realestate_places as rp


def test_places_merge_and_dedupe(monkeypatch):
    calls = []
    def fake(code, lat, lon, radius):
        calls.append(code)
        return [{"name": "가게", "kind": rp.GROUPS[code], "category": None, "lat": 37.5, "lon": 127.0}] if code in ("FD6", "CE7") else []
    monkeypatch.setattr(rp, "_group", fake)
    __import__("app.services.realestate_building_info", fromlist=["_memo"])._memo.clear()
    d = rp.places(37.5, 127.05, 300)
    assert len(d["items"]) == 1 and set(calls) == set(rp.GROUPS)


def test_places_rejects_outside_korea():
    import pytest
    with pytest.raises(ValueError):
        rp.places(10.0, 127.0)
