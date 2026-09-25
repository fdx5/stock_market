import datetime as dt

import pytest

from app.services import realestate_map as rm
from app.services import realestate_summary as rs


@pytest.fixture
def seoul(monkeypatch):
    today = dt.datetime.now(rm.KST).date()
    d = lambda days: int((today - dt.timedelta(days=days)).strftime("%Y%m%d"))  # noqa: E731
    districts = {
        # 강남: 대치동 A 10억 → 11억 (+10%), 대치동 B 20억 → 19억 (-5%), 역삼동 C 기간 내 거래 없음
        "11680": {
            "x": [
                [d(200), "A", "A", "대치동", "1", 84.9, 100000, 5, 2000],
                [d(10), "A", "A", "대치동", "1", 84.9, 110000, 5, 2000],
                [d(200), "B", "B", "대치동", "2", 84.9, 200000, 5, 2000],
                [d(10), "B", "B", "대치동", "2", 84.9, 190000, 5, 2000],
                [d(200), "C", "C", "역삼동", "3", 84.9, 150000, 5, 2000],
            ]
        },
        # 서초: D 30억 → 33억 (+10%)
        "11650": {
            "x": [
                [d(200), "D", "D", "반포동", "1", 84.9, 300000, 5, 2000],
                [d(10), "D", "D", "반포동", "1", 84.9, 330000, 5, 2000],
            ]
        },
    }
    monkeypatch.setattr(rm, "_district", lambda code: districts.get(code, {}))
    monkeypatch.setattr(rs, "_cache", {})
    return districts


def test_dong_level_is_price_weighted_and_counts_quiet_complexes(seoul):
    got = {i["name"]: i for i in rs.region_summary("dong", "3m", sgg="11680")["items"]}
    # (11억 × 10% + 19억 × -5.26%) / 30억
    assert got["대치동"]["change"] == pytest.approx((110000 * 10 + 190000 * (-10000 / 200000 * 100)) / 300000, abs=0.01)
    assert got["대치동"]["up"] == 1 and got["대치동"]["down"] == 1
    assert got["역삼동"]["change"] is None and got["역삼동"]["complexes"] == 1 and got["역삼동"]["moved"] == 0


def test_sgg_level_reports_ready_districts_and_queues_the_rest(seoul, monkeypatch):
    queued = []
    monkeypatch.setattr(rs, "_request", lambda keys, first=False: queued.extend(keys))
    first = rs.region_summary("sgg", "3m", sido="11")
    assert first["pending"] == len(rm.regions()["sido"][0]["sgg"])
    assert ("11680", "3m") in queued
    # What the worker would do for the two districts with trades.
    for code in ("11680", "11650"):
        rs._store(code, "3m", rm._lawd_versions.get(code, 0), rs.summarise(code, "3m"))
    items = {i["code"]: i for i in rs.region_summary("sgg", "3m", sido="11")["items"]}
    assert items["11650"]["change"] == 10.0 and items["11650"]["ready"] == 1
    assert items["11110"]["ready"] == 0


def test_new_trades_invalidate_a_district(seoul, monkeypatch):
    rs._store("11650", "3m", rm._lawd_versions.get("11650", 0), rs.summarise("11650", "3m"))
    assert rs._fresh("11650", "3m") is not None
    monkeypatch.setitem(rm._lawd_versions, "11650", rm._lawd_versions.get("11650", 0) + 1)
    assert rs._fresh("11650", "3m") is None


def test_a_changed_district_keeps_its_last_summary_while_redone(seoul, monkeypatch):
    monkeypatch.setattr(rs, "_request", lambda keys, first=False: None)
    rs._store("11650", "3m", rm._lawd_versions.get("11650", 0), rs.summarise("11650", "3m"))
    monkeypatch.setitem(rm._lawd_versions, "11650", rm._lawd_versions.get("11650", 0) + 1)
    items = {i["code"]: i for i in rs.region_summary("sgg", "3m", sido="11")["items"]}
    assert items["11650"]["change"] == 10.0 and items["11650"]["ready"] == 1
