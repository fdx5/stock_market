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
    assert rows == [[20260905, "11650-2345", "래미안원베일리", "반포동", "1", 84.97, 720000, 21, 2023]]


def test_unregistered_key_is_an_error(monkeypatch):
    monkeypatch.setattr(rm.requests, "get", lambda *a, **k: FakeResponse(KEY_ERROR_XML, 403))
    with pytest.raises(rm.MolitError, match="NOT_REGISTERED"):
        rm.fetch_month("11650", "202609")


def test_brands():
    assert rm.brand_of("래미안원베일리") == "raemian"
    assert rm.brand_of("아크로리버파크") == "acro"
    assert rm.brand_of("디에이치아너힐즈") == "dh"
    assert rm.brand_of("압구정현대") == "hyundai"
    assert rm.brand_of("은마") is None


def _seed(monkeypatch, districts):
    monkeypatch.setattr(rm, "is_configured", lambda: False)
    monkeypatch.setattr(rm, "_district", lambda code: districts.get(code, {}))


def test_map_change_is_latest_versus_last_price_before_window(monkeypatch):
    today = dt.datetime.now(rm.KST).date()
    d = lambda days: int((today - dt.timedelta(days=days)).strftime("%Y%m%d"))  # noqa: E731
    deals = [
        # 대표 평형 84㎡: 200일 전 20억, 100일 전 21억, 10일 전 23억
        [d(200), "A1", "래미안A", "반포동", "1", 84.9, 200000, 10, 2010],
        [d(100), "A1", "래미안A", "반포동", "1", 84.9, 210000, 11, 2010],
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


def test_sido_map_groups_by_district_and_caps_at_500(monkeypatch):
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
    assert result["count"] == 500
    assert {r["group"] for r in result["items"]} <= {s["name"] for s in seoul["sgg"]}
    assert result["items"][0]["price"] >= result["items"][-1]["price"]
