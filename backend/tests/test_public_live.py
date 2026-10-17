"""public_live: the drone's live public data. No network, no database: providers are stubbed."""
import datetime as dt

import pytest

from app.services import public_live as pl


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    pl._cache.clear()
    pl._topis.clear()
    pl._topis_busy.clear()
    pl._its_down = 0.0
    for k in ("SEOUL_OPEN_API_KEY", "SEOUL_API_KEY", "SEOUL_SUBWAY_API_KEY", "DATA_GO_KR_API_KEY", "EGEN_API_KEY", "MOLIT_API_KEY", "ITS_API_KEY", "ITS_TRAFFIC_API_KEY"):
        monkeypatch.delenv(k, raising=False)


def test_day_type_weekday_saturday_holiday_and_after_midnight():
    kst = pl.KST
    assert pl.day_type(dt.datetime(2026, 10, 16, 12, tzinfo=kst)) == "1"   # Friday
    assert pl.day_type(dt.datetime(2026, 10, 17, 12, tzinfo=kst)) == "2"   # Saturday
    assert pl.day_type(dt.datetime(2026, 10, 18, 12, tzinfo=kst)) == "3"   # Sunday
    assert pl.day_type(dt.datetime(2026, 10, 9, 12, tzinfo=kst)) == "3"    # 한글날
    assert pl.day_type(dt.datetime(2026, 10, 19, 1, tzinfo=kst)) == "3"    # Monday 1 a.m.: still Sunday's trains


def test_missing_keys_are_reported_not_raised():
    assert pl.bikes(37.5, 127.0)["status"] == "needs_key"
    assert pl.emergency(37.5, 127.0)["status"] == "needs_key"
    assert pl.subway_trains(["2호선"])["status"] == "needs_key"
    assert pl.parking(37.5, 127.0)["status"] == "needs_key"


def test_line_codes_map_to_line_names():
    assert pl._line_of_code("02호선") == "2호선"
    assert pl._line_of_code("수인분당선") == "수인분당선"
    assert pl._line_of_code("신분당선") == "신분당선"
    assert pl._line_of_code("경의선") == "경의중앙선"


def test_timetable_uses_arrival_for_trains_ending_here(monkeypatch):
    monkeypatch.setenv("SEOUL_OPEN_API_KEY", "k")
    rows = [{"LEFTTIME": "00:00:00", "ARRIVETIME": "23:58:00", "TRAIN_NO": "1", "SUBWAYENAME": "압구정", "SUBWAYSNAME": "대화"},
            {"LEFTTIME": "00:12:00", "ARRIVETIME": "00:11:00", "TRAIN_NO": "2", "SUBWAYENAME": "오금", "SUBWAYSNAME": "대화"},
            {"LEFTTIME": "05:30:00", "ARRIVETIME": "00:00:00", "TRAIN_NO": "3", "SUBWAYENAME": "오금", "SUBWAYSNAME": "압구정"}]
    monkeypatch.setattr(pl, "_seoul", lambda *a, **k: rows)
    items = pl._timetable("0336", "1", "1")
    assert [i["time"] for i in items] == ["05:30", "23:58", "00:12"]


def test_traffic_in_seoul_never_waits_on_its(monkeypatch):
    monkeypatch.setenv("ITS_API_KEY", "k")
    monkeypatch.setenv("SEOUL_OPEN_API_KEY", "k")
    called = []
    monkeypatch.setattr(pl, "_its_cell", lambda *a: called.append(a) or {})
    monkeypatch.setattr(pl, "_topis_speeds", lambda links: ({links[0]: 30.0}, 0))
    r = pl.traffic(37.5, 127.03, ["1220003800"])
    assert called == [] and r["speeds"] == {"1220003800": 30.0} and r["status"] == "ok"


def test_its_failure_backs_off_outside_seoul(monkeypatch):
    monkeypatch.setenv("ITS_API_KEY", "k")
    calls = []

    def down(*a):
        calls.append(a)
        raise TimeoutError("connect timeout")
    monkeypatch.setattr(pl, "_its_cell", down)
    assert pl.traffic(35.1, 129.0, [])["status"] == "outside"
    assert pl.traffic(35.1, 129.0, [])["status"] == "outside"
    assert len(calls) == 1


def test_bike_rows_are_parsed_and_sorted_by_distance(monkeypatch):
    monkeypatch.setenv("SEOUL_OPEN_API_KEY", "k")
    rows = [{"stationId": "ST-1", "stationName": "102. 먼 곳", "stationLatitude": "37.51", "stationLongitude": "127.0", "parkingBikeTotCnt": "2", "rackTotCnt": "10", "shared": "20"},
            {"stationId": "ST-2", "stationName": "103. 가까운 곳", "stationLatitude": "37.5001", "stationLongitude": "127.0", "parkingBikeTotCnt": "5", "rackTotCnt": "10", "shared": "50"}]
    monkeypatch.setattr(pl, "_seoul", lambda service, start, end, *a, **k: rows if start == 1 else [])
    r = pl.bikes(37.5, 127.0)
    assert r["status"] == "ok" and [i["name"] for i in r["items"]] == ["가까운 곳", "먼 곳"]
