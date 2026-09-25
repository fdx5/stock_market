import datetime as dt

import pytest

from app.services import realestate_map as rm
from app.services import realestate_rent as rr

RENT_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
<body><items>
<item><aptNm>은마</aptNm><aptSeq>11680-S1</aptSeq><buildYear>1979</buildYear><contractTerm>26.10~28.10</contractTerm>
<contractType>신규</contractType><dealDay>5</dealDay><dealMonth>9</dealMonth><dealYear>2026</dealYear>
<deposit>80,000</deposit><excluUseAr>76.79</excluUseAr><floor>7</floor><jibun>316</jibun><monthlyRent>0</monthlyRent>
<preDeposit></preDeposit><preMonthlyRent></preMonthlyRent><sggCd>11680</sggCd><umdNm>대치동</umdNm></item>
<item><aptNm>은마</aptNm><aptSeq>11680-S1</aptSeq><contractType>갱신</contractType><dealDay>9</dealDay><dealMonth>9</dealMonth>
<dealYear>2026</dealYear><deposit>10,000</deposit><excluUseAr>76.79</excluUseAr><floor>3</floor><jibun>316</jibun>
<monthlyRent>250</monthlyRent><preDeposit>10,000</preDeposit><preMonthlyRent>230</preMonthlyRent><umdNm>대치동</umdNm></item>
</items><numOfRows>1000</numOfRows><pageNo>1</pageNo><totalCount>2</totalCount></body></response>"""


class FakeResponse:
    def __init__(self, body):
        self.content = body.encode("utf-8")
        self.text = body
        self.status_code = 200

    def raise_for_status(self):
        pass


def test_fetch_rent_month_parses_jeonse_and_wolse(monkeypatch):
    monkeypatch.setenv("MOLIT_API_KEY", "k")
    monkeypatch.setattr(rm.requests, "get", lambda *a, **k: FakeResponse(RENT_XML))
    rows = rr.fetch_rent_month("11680", "202609")
    assert rows == [
        [20260905, "11680-S1", "은마", "대치동", "316", 76.79, 80000, 0, 7, 1, 0, 0],
        [20260909, "11680-S1", "은마", "대치동", "316", 76.79, 10000, 250, 3, 2, 10000, 230],
    ]


@pytest.fixture
def world(monkeypatch):
    today = dt.datetime.now(rm.KST).date()
    d = lambda days: int((today - dt.timedelta(days=days)).strftime("%Y%m%d"))  # noqa: E731
    monkeypatch.setattr(rm, "_district", lambda code: {"x": [[d(10), "S1", "은마", "대치동", "316", 76.8, 250000, 5, 1979, 0]]})
    monkeypatch.setattr(rm, "is_configured", lambda: True)
    leases = {
        "x": ("2099-01-01T00:00:00+09:00", [
            [d(200), "", "은마아파트", "대치동", "316", 76.79, 70000, 0, 5, 1, 0, 0],   # no seq: matched by 지번
            [d(30), "S1", "은마", "대치동", "316", 76.79, 82000, 0, 9, 1, 0, 0],
            [d(20), "S1", "은마", "대치동", "316", 76.79, 78000, 0, 2, 2, 70000, 0],
            [d(15), "S1", "은마", "대치동", "316", 84.43, 10000, 300, 4, 1, 0, 0],
            [d(12), "S9", "다른단지", "대치동", "500", 76.79, 99000, 0, 4, 1, 0, 0],
        ]),
    }
    monkeypatch.setattr(rr, "_district", lambda code: leases)
    monkeypatch.setattr(rr, "_missing", lambda code: [])
    return d


def test_complex_rent_groups_leases_by_pyeong(world):
    d = world
    got = rr.complex_rent("11680:S1")
    types = {t["key"]: t for t in got["types"]}
    j = types[77]
    assert [x[0] for x in j["deals"]] == [d(20), d(30), d(200)]  # newest first, other 단지 left out
    assert j["jeonse"]["price"] == 80000  # the median of the last trades within 90 days of the latest
    assert j["jeonse"]["trades_1y"] == 3 and j["jeonse"]["high_1y"] == 82000
    w = types[84]["wolse"]
    assert (w["deposit"], w["rent"]) == (10000, 300)
    assert got["status"]["collecting"] is False


def test_missing_months_are_collected_for_the_district(world, monkeypatch):
    asked = []
    monkeypatch.setattr(rr, "_missing", lambda code: ["202609"])
    monkeypatch.setattr(rr, "_request", lambda code: asked.append(code))
    got = rr.complex_rent("11680:S1")
    assert asked == ["11680"] and got["status"]["collecting"] is True
