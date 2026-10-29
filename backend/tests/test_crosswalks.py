"""Crosswalk register: rows parsed and asked by radius, with no network or database."""
from app.services import realestate_crosswalks as cw


def test_rows_and_radius(monkeypatch):
    rows = [cw._row({"latitude": "37.5560", "longitude": "126.9050", "bt": "4", "et": "12", "cartrkCo": "2", "tfclghtYn": "Y"}),
            cw._row({"latitude": "37.6", "longitude": "127.0"})]
    assert rows[0][:6] == [37.556, 126.905, 4.0, 12.0, 2, 1]
    monkeypatch.setattr(cw, "_ensure", lambda: None)
    monkeypatch.setitem(cw._state, "rows", rows)
    monkeypatch.setitem(cw._state, "grid", cw._index(rows))
    got = cw.crosswalks(37.5561, 126.9051, 300)
    assert got["status"] == "available" and len(got["items"]) == 1 and got["items"][0]["signals"] is True


def test_bad_rows_skipped():
    assert cw._row({"latitude": "", "longitude": "126.9"}) is None
    assert cw._row({"latitude": "10", "longitude": "126.9"}) is None
