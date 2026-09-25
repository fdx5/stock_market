import datetime as dt

import pytest

from app.services import realestate_map as rm

SAMPLE_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
<body><items>
<item><aptNm>래미안원베일리</aptNm><aptSeq>11650-2345</aptSeq><buildYear>2023</buildYear>
<cdealDay> </cdealDay><cdealType> </cdealType><dealAmount>   720,000</dealAmount><dealDay>5</dealDay>
<dealMonth>9</dealMonth><dealYear>2026</dealYear><excluUseAr>84.97</excluUseAr><floor>21</floor>
<jibun>1</jibun><sggCd>11650</sggCd><umdNm>반포동</umdNm></item>
<item><aptNm>래미안원베일리</aptNm><aptSeq>11650-2345</aptSeq><buildYear>2023</buildYear>
<cdealDay>26.09.10</cdealDay><cdealType>O</cdealType><dealAmount>700,000</dealAmount><dealDay>6</dealDay>
<dealMonth>9</dealMonth><dealYear>2026</dealYear><excluUseAr>84.97</excluUseAr><floor>3</floor>
<jibun>1</jibun><sggCd>11650</sggCd><umdNm>반포동</umdNm></item>
</items><numOfRows>1000</numOfRows><pageNo>1</pageNo><totalCount>2</totalCount></body></response>"""

# What apis.data.go.kr actually answers (HTTP 403) for a key not registered to the API.
KEY_ERROR_XML = """<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</errMsg>
<returnAuthMsg>등록되지 않은 서비스키</returnAuthMsg><returnReasonCode>30</returnReasonCode>
</cmmMsgHeader></OpenAPI_ServiceResponse>"""


class FakeResponse:
    def __init__(self, body: str, status: int = 200):
        self.content = body.encode("utf-8")
        self.text = body
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    monkeypatch.setenv("MOLIT_API_KEY", "abc%2Bdef")
    monkeypatch.setattr(rm, "_endpoint_choice", None)
    monkeypatch.setattr(rm, "CALL_SPACING_SECONDS", 0)


def test_encoded_key_is_decoded_once():
    assert rm._service_key() == "abc+def"


def test_fetch_month_parses_and_drops_cancelled(monkeypatch):
    monkeypatch.setattr(rm.requests, "get", lambda *a, **k: FakeResponse(SAMPLE_XML))
    rows = rm.fetch_month("11650", "202609")
    assert rows == [[20260905, "11650-2345", "래미안원베일리", "반포동", "1", 84.97, 720000, 21, 2023, 0]]


def test_unregistered_key_is_an_error(monkeypatch):
    monkeypatch.setattr(rm.requests, "get", lambda *a, **k: FakeResponse(KEY_ERROR_XML, 403))
    with pytest.raises(rm.MolitError, match="NOT_REGISTERED"):
        rm.fetch_month("11650", "202609")


def test_brands():
    assert rm.brand_of("래미안원베일리") == "raemian"
    assert rm.brand_of("아크로리버파크") == "acro"
    assert rm.brand_of("디에이치아너힐즈") == "dh"
    assert rm.brand_of("압구정현대") == "hyundai"
    assert rm.brand_of("I-PARK") == "ipark"
    assert rm.brand_of("e편한세상") == "eplus"
    assert rm.brand_of("은마") is None


def _seed(monkeypatch, districts):
    monkeypatch.setattr(rm, "is_configured", lambda: False)
    monkeypatch.setattr(rm, "_district", lambda code: districts.get(code, {}))
    monkeypatch.setattr(rm, "_prefetch", lambda codes: None)


def test_map_change_is_latest_versus_last_price_before_window(monkeypatch):
    today = dt.datetime.now(rm.KST).date()
    d = lambda days: int((today - dt.timedelta(days=days)).strftime("%Y%m%d"))  # noqa: E731
    deals = [
        # 대표 평형 84㎡: 250일 전 20억, 120일 전 21억, 10일 전 23억 (서로 90일 넘게 떨어져 있다)
        [d(250), "A1", "래미안A", "반포동", "1", 84.9, 200000, 10, 2010],
        [d(120), "A1", "래미안A", "반포동", "1", 84.9, 210000, 11, 2010],
        [d(10), "A1", "래미안A", "반포동", "1", 84.8, 230000, 12, 2010],
        # 한 번 거래된 59㎡는 대표 평형이 아니다
        [d(5), "A1", "래미안A", "반포동", "1", 59.9, 150000, 3, 2010],
        # 기간 안에 거래가 없는 단지
        [d(300), "B1", "은마", "대치동", "2", 76.8, 250000, 5, 1979],
    ]
    _seed(monkeypatch, {"11650": {"x": deals}})

    three = rm.build_map(None, "11650", None, "3m")
    a = next(r for r in three["items"] if r["name"] == "래미안A")
    assert a["price"] == 230000 and round(a["area"]) == 85
    assert a["base_price"] == 210000
    assert a["change_pct"] == pytest.approx((230000 - 210000) / 210000 * 100, abs=0.01)
    b = next(r for r in three["items"] if r["name"] == "은마")
    assert b["change_pct"] is None and b["trades"] == 0

    year = rm.build_map(None, "11650", None, "1y")
    a = next(r for r in year["items"] if r["name"] == "래미안A")
    assert a["base_price"] == 200000

    only = rm.build_map(None, "11650", "대치동", "3m")
    assert [r["name"] for r in only["items"]] == ["은마"]
    assert only["level"] == "dong"


def test_sido_map_caps_at_top_n_and_keeps_ten_per_district(monkeypatch):
    today = dt.datetime.now(rm.KST).date()
    day = int((today - dt.timedelta(days=3)).strftime("%Y%m%d"))
    districts = {}
    seoul = next(s for s in rm.regions()["sido"] if s["code"] == "11")
    for i, sgg in enumerate(seoul["sgg"]):
        districts[sgg["code"]] = {
            "x": [[day, f"{sgg['code']}-{j}", f"단지{i}-{j}", "어떤동", str(j), 84.0, 100000 + i * 1000 + j, 5, 2000] for j in range(30)]
        }
    _seed(monkeypatch, districts)
    result = rm.build_map("11", None, None, "7d")
    items = result["items"]
    assert result["top_n"] == 500 and result["group_floor"] == 10
    assert {r["group"] for r in items} <= {s["name"] for s in seoul["sgg"]}
    assert all(a["price"] >= b["price"] for a, b in zip(items, items[1:]))
    # The 500 priciest, then each 구 topped up to its own 10 priciest.
    all_prices = sorted((100000 + i * 1000 + j for i in range(len(seoul["sgg"])) for j in range(30)), reverse=True)
    assert [r["price"] for r in items[:500]] == all_prices[:500]
    per_gu = {}
    for r in items:
        per_gu[r["sgg"]] = per_gu.get(r["sgg"], 0) + 1
    assert set(per_gu) == {s["name"] for s in seoul["sgg"]}
    assert min(per_gu.values()) == 10
    assert result["count"] == len(items)

    phone = rm.build_map("11", None, None, "7d", top=100)
    assert phone["top_n"] == 100
    counts = {}
    for r in phone["items"]:
        counts[r["sgg"]] = counts.get(r["sgg"], 0) + 1
    assert set(counts) == {s["name"] for s in seoul["sgg"]} and min(counts.values()) == 10
    assert [r["price"] for r in phone["items"][:100]] == all_prices[:100]
    # 100 priciest come from the top 4 구 (30 each → 3 full + 10), the other 21 keep 10.
    assert phone["count"] == 100 + 10 * (len(seoul["sgg"]) - 4)


def test_newest_request_is_collected_first(monkeypatch):
    monkeypatch.setattr(rm, "_queue", [])
    monkeypatch.setattr(rm, "_queued", {})
    rm.request_districts(["11110", "11140"], priority=0)
    rm.request_districts(["41150"], priority=0)
    rm.request_districts(["26110"], priority=10)
    rm.request_districts(["11140"], priority=10)  # a warm pass must not demote a viewed district
    order = [rm._next_district() for _ in range(4)]
    assert order == ["41150", "11110", "11140", "26110"]


def test_dong_shows_every_complex_and_ignores_direct_trades(monkeypatch):
    today = dt.datetime.now(rm.KST).date()
    d = lambda days: int((today - dt.timedelta(days=days)).strftime("%Y%m%d"))  # noqa: E731
    deals = [[d(5), f"C{j}", f"단지{j}", "호원동", str(j), 84.9, 50000 + j, 3, 2000, 0] for j in range(45)]
    deals += [
        # 우성1: 3.15억 직거래가 비교 기준이 되면 +35%로 튄다
        [d(400), "W1", "우성1", "호원동", "9", 84.97, 41000, 5, 1995, 0],
        [d(40), "W1", "우성1", "호원동", "9", 84.97, 31500, 2, 1995, 1],
        [d(10), "W1", "우성1", "호원동", "9", 84.97, 42500, 7, 1995, 0],
        # 1년 넘게 거래가 없어도 동 단위에는 나온다
        [d(500), "Q1", "조용한단지", "호원동", "8", 59.9, 30000, 4, 1990, 0],
    ]
    _seed(monkeypatch, {"41150": {"x": deals}})
    result = rm.build_map(None, "41150", "호원동", "3m")
    assert result["count"] == 47 and result["top_n"] == 100
    w = next(r for r in result["items"] if r["name"] == "우성1")
    assert w["base_price"] == 41000 and w["change_pct"] == pytest.approx(3.66, abs=0.01)
    assert rm.build_map(None, "41150", None, "3m")["count"] == 46  # 시·군·구는 1년 거래 단지만, 100개 한도


def test_dong_caps_at_100(monkeypatch):
    today = dt.datetime.now(rm.KST).date()
    day = int((today - dt.timedelta(days=5)).strftime("%Y%m%d"))
    deals = [[day, f"C{j}", f"단지{j}", "호원동", str(j), 84.9, 50000 + j, 3, 2000, 0] for j in range(130)]
    _seed(monkeypatch, {"41150": {"x": deals}})
    result = rm.build_map(None, "41150", "호원동", "7d")
    assert result["count"] == 100 and result["items"][0]["price"] == 50129


def test_one_low_trade_does_not_set_the_reference(monkeypatch):
    # 한주3 59㎡ 실제 거래: 기간 직전 24층 2.55억 한 건이 주변 거래(2.9~3.0억)보다 낮았다.
    rows = [
        ("20250828", 29000), ("20250830", 29800), ("20250923", 25500),
        ("20260531", 28000), ("20260531", 30700), ("20260817", 31500),
    ]
    deals = [[int(d), "H3", "한주3", "호원동", "436", 59.82, p, 10, 1995, 0] for d, p in rows]
    _seed(monkeypatch, {"41150": {"x": deals}})
    monkeypatch.setattr(rm, "_as_int", rm._as_int)
    real_now = rm.dt.datetime.now

    class FakeDateTime(rm.dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return real_now(tz).replace(year=2026, month=9, day=24)

    monkeypatch.setattr(rm.dt, "datetime", FakeDateTime)
    item = rm.build_map(None, "41150", "호원동", "1y")["items"][0]
    assert item["price"] == 30700 and item["base_price"] == 29000
    assert item["change_pct"] == pytest.approx(5.86, abs=0.01)


def test_failed_store_read_is_not_cached(monkeypatch):
    monkeypatch.setattr(rm, "_districts", rm.OrderedDict())
    monkeypatch.setattr(rm.time, "sleep", lambda s: None)
    calls = {"n": 0}

    def flaky(code):
        calls["n"] += 1
        if calls["n"] <= 3:
            raise RuntimeError("gate timeout")
        return {"202609": ("t", [[20260905, "A", "단지", "동", "1", 84.0, 100000, 3, 2000, 0]])}

    monkeypatch.setattr(rm.realestate_store, "load_district", flaky)
    assert rm._district("11680") == {}
    assert "11680" not in rm._districts
    assert list(rm._district("11680")) == ["202609"]


def test_items_carry_popup_detail(monkeypatch):
    today = dt.datetime.now(rm.KST).date()
    d = lambda days: int((today - dt.timedelta(days=days)).strftime("%Y%m%d"))  # noqa: E731
    deals = [
        [d(300), "A", "래미안A", "반포동", "1", 84.9, 200000, 10, 2010, 0],
        [d(200), "A", "래미안A", "반포동", "1", 84.9, 150000, 2, 2010, 1],  # 직거래
        [d(100), "A", "래미안A", "반포동", "1", 84.9, 240000, 20, 2010, 0],
        [d(10), "A", "래미안A", "반포동", "1", 84.9, 230000, 12, 2010, 0],
        [d(50), "A", "래미안A", "반포동", "1", 59.8, 160000, 5, 2010, 0],
    ]
    _seed(monkeypatch, {"11650": {"x": deals}})
    item = rm.build_map(None, "11650", None, "3m")["items"][0]
    assert [h[1] for h in item["history"]] == [200000, 150000, 240000, 230000]
    assert item["history"][1][3] == 1
    assert item["high_1y"]["price"] == 240000 and item["low_1y"]["price"] == 200000  # 직거래는 범위에서 뺀다
    assert item["trades_1y"] == 5
    assert item["types"] == [{"area": 59.8, "price": 160000, "date": item["types"][0]["date"], "trades_1y": 1}]


def test_complex_detail_lays_out_every_pyeong(monkeypatch):
    today = dt.datetime.now(rm.KST).date()
    d = lambda days: int((today - dt.timedelta(days=days)).strftime("%Y%m%d"))  # noqa: E731
    deals = [
        [d(200), "A", "래미안A", "반포동", "1", 84.9, 200000, 10, 2010, 0],
        [d(20), "A", "래미안A", "반포동", "1", 84.9, 220000, 12, 2010, 0],
        [d(30), "A", "래미안A", "반포동", "1", 84.8, 215000, 7, 2010, 0],
        [d(150), "A", "래미안A", "반포동", "1", 59.9, 150000, 3, 2010, 0],
        [d(10), "A", "래미안A", "반포동", "1", 59.9, 165000, 5, 2010, 0],
        [d(400), "A", "래미안A", "반포동", "1", 114.5, 300000, 9, 2010, 0],
    ]
    _seed(monkeypatch, {"11650": {"x": deals}})
    item = rm.build_map(None, "11650", None, "3m")["items"][0]
    detail = rm.complex_detail(item["id"], "3m")
    assert [t["key"] for t in detail["types"]] == [85, 60, 114]  # 1년 거래 많은 순
    t85, t60, t114 = detail["types"]
    assert t85["price"] == item["price"] and t85["change_pct"] == item["change_pct"]
    assert t60["price"] == 165000 and t60["base_price"] == 150000
    assert t114["trades_1y"] == 0 and t114["change_pct"] is None
    with pytest.raises(LookupError):
        rm.complex_detail("11650:없는단지", "3m")


def test_sido_map_is_served_from_the_last_build_and_rebuilt_behind(monkeypatch):
    import json

    stored = {}
    monkeypatch.setattr(rm.realestate_store, "save_map", lambda key, body, at: stored.__setitem__(key, (at, body)))
    monkeypatch.setattr(rm.realestate_store, "load_map", lambda key: stored.get(key))
    monkeypatch.setattr(rm, "_map_cache", rm.OrderedDict())
    queued = []
    monkeypatch.setattr(rm, "_schedule_rebuild", lambda key, first=False: queued.append(key))
    builds = []

    def fake_build(sido, sgg, dong, period, top):
        builds.append(sido)
        return {"generated_at": "x", "level": "sido", "items": [len(builds)], "status": {"stale": True}}

    monkeypatch.setattr(rm, "build_map", fake_build)
    monkeypatch.setattr(rm, "is_configured", lambda: False)
    first = json.loads(rm.get_map("41", None, None, "3m", 500))
    assert builds == ["41"] and first["items"] == [1] and "stale" not in first["status"]
    assert "sido:41:3m:500" in stored

    # Answered from memory, no rebuild while fresh.
    assert json.loads(rm.get_map("41", None, None, "3m", 500))["items"] == [1] and builds == ["41"]

    # After a restart: answered from the store; once stale, rebuilt in the background.
    monkeypatch.setattr(rm, "_map_cache", rm.OrderedDict())
    key = ("41", None, None, "3m", 500)
    at, body = stored["sido:41:3m:500"]
    stored["sido:41:3m:500"] = ("2020-01-01T00:00:00+09:00", body)
    assert json.loads(rm.get_map("41", None, None, "3m", 500))["items"] == [1]
    assert builds == ["41"] and queued == [key]
