"""Regression coverage for search scope, evidence and filtering before truncation."""
import datetime as dt
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services import realestate_map as rm
from app.routers.realestate import router


def day(ago):
    return int((dt.datetime.now(rm.KST).date() - dt.timedelta(days=ago)).strftime("%Y%m%d"))


def row(seq, name, price, area=84.9, ago=5, direct=0, built=2010):
    return [day(ago), seq, name, "대치동", "1", area, price, 10, built, direct]


@pytest.fixture
def seed(monkeypatch):
    monkeypatch.setattr(rm, "is_configured", lambda: False)
    monkeypatch.setattr(rm, "_prefetch", lambda codes: None)
    monkeypatch.setattr(rm, "_explore_cache", rm.OrderedDict())
    def load(rows):
        monkeypatch.setattr(rm, "_district", lambda code: {"sample": rows} if code == "11680" else {})
    return load


def test_search_and_budget_run_before_top_cut(seed):
    rows = [row(f"L{i}", f"고가단지{i}", 200000 + i) for i in range(105)]
    rows.append(row("target", "검색대상아파트", 50000))
    seed(rows)
    result = rm.build_map("11", "11680", None, "3m", filters={"q": "검색 대상", "price_max": 60000})
    assert [x["name"] for x in result["items"]] == ["검색대상아파트"]
    assert result["matched_count"] == 1


def test_area_filter_selects_matching_type_before_price_filter(seed):
    seed([row("A", "A아파트", 180000, area=114.9, ago=i) for i in range(1, 5)] + [row("A", "A아파트", 80000, area=59.9)])
    result = rm.build_map("11", "11680", None, "3m", filters={"area_max": 60, "price_max": 100000})
    assert result["count"] == 1
    assert result["items"][0]["area"] == 59.9
    assert result["items"][0]["price"] == 80000


def test_pagination_sort_and_total(seed):
    seed([row(str(i), f"아파트{i}", 50000 + i) for i in range(8)])
    result = rm.build_map("11", "11680", None, "3m", filters={"sort": "price_asc", "offset": 2, "limit": 3})
    assert result["matched_count"] == 8
    assert [x["price"] for x in result["items"]] == [50002, 50003, 50004]


def test_exact_year_count_is_not_chart_point_count():
    rows = [(day(i), 50000 + i, 10, 84.9, 0) for i in range(1, 71)]
    view = rm._type_view(rows, day(91), day(365))
    assert len(view["history"]) == 40
    assert view["type_trades_1y"] == 70
    assert view["price_sample_count"] == 3
    assert len(view["price_samples"]) == 3
    assert view["price_basis"] == "brokered"


def test_trade_without_baseline_and_direct_evidence():
    view = rm._type_view([(day(5), 50000, 7, 84.9, 1)], day(91), day(365))
    assert view["trades"] == 1 and view["change_pct"] is None
    assert view["baseline_kind"] is None
    assert view["price_basis"] == "direct"
    assert view["price_sample_count"] == 1


def test_within_period_baseline_is_explicit():
    view = rm._type_view([(day(60), 50000, 7, 84.9, 0), (day(5), 60000, 9, 84.9, 0)], day(91), day(365))
    assert view["baseline_kind"] == "within_period"
    assert view["base_date"] == rm._ymd(day(60)).isoformat()


def test_old_reference_exposes_sample_date():
    view = rm._type_view([(day(400), 50000, 7, 84.9, 0)], day(91), day(365))
    assert view["price_sample_from"] == rm._ymd(day(400)).isoformat()
    assert view["trades"] == 0
    assert view["type_trades_1y"] == 0


def test_freshness_and_built_filters(seed):
    seed([row("A", "새단지", 70000, built=2020), row("B", "구축", 50000, built=1980), row("C", "오래된거래", 80000, ago=200, built=2021)])
    result = rm.build_map("11", "11680", None, "3m", filters={"built_min": 2010, "recent_days": 90, "min_trades": 1})
    assert [x["name"] for x in result["items"]] == ["새단지"]


def test_explore_cache_invalidates_when_data_changes(seed, monkeypatch):
    seed([row("A", "A", 100000)])
    first = json.loads(rm.explore("11", "11680", None, "3m", {}))
    seed([row("B", "B", 200000)])
    assert json.loads(rm.explore("11", "11680", None, "3m", {}))["items"] == first["items"]
    monkeypatch.setattr(rm, "_version", rm._version + 1)
    assert json.loads(rm.explore("11", "11680", None, "3m", {}))["items"][0]["name"] == "B"


def test_explore_api_validation_and_no_store(seed):
    seed([row("A", "A", 100000)])
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    assert client.get("/explore?sido=11&sgg=11680&price_min=20&price_max=10").status_code == 400
    assert client.get("/explore?sido=41&sgg=11680").status_code == 400
    assert client.get("/explore?sort=invalid").status_code == 422
    result = client.get("/explore?sido=11&sgg=11680")
    assert result.status_code == 200
    assert result.headers["cache-control"] == "no-store"
    assert result.json()["items"][0]["name"] == "A"
