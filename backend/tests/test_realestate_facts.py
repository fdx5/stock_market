import json

import pytest

from app.services import realestate_facts as rf
from app.services import realestate_map as rm

def _dong(dong, *names):
    return [{"code": f"{dong}{i}", "name": n, "dong": dong, "ri": ""} for i, n in enumerate(names)]


# K-apt's own names, as its list answered for these 동 (2026-09).
APGUJEONG = _dong("압구정동", "압구정미성1차", "압구정미성2차", "압구정신현대", "압구정 현대(10,13,14차)", "압구정현대8차",
                  "압구정한양아파트제1단지", "압구정현대아파트", "압구정한양아파트제2단지", "압구정한양3단지")
DAECHI = _dong("대치동", "래미안 대치 팰리스", "개포1차2차우성", "대치우성1차아파트", "은마", "대치현대")
DOGOK = _dong("도곡동", "타워팰리스1차", "타워팰리스2차", "타워팰리스G동", "도곡렉슬")
MAPO = (
    _dong("용강동", "마포대림2차e-편한세상아파트 ", "마포대림1차", "e편한세상마포리버파크", "래미안마포리버웰")
    + _dong("상수동", "래미안밤섬리베뉴 Ⅰ", "래미안밤섬리베뉴 2", "상수두산위브")
    + _dong("아현동", "마포트라팰리스2", "공덕자이 아파트", "공덕자이(임대)", "마포래미안푸르지오")
    + _dong("공덕동", "공덕SK리더스뷰 1단지", "공덕SK리더스뷰 2단지", "공덕파크자이 아파트")
)
BUNDANG = (
    _dong("삼평동", "봇들마을3단지아파트", "봇들마을7단지", "봇들마을휴먼시아8단지", "판교봇들마을9단지금호어울림아파트")
    + _dong("이매동", "이매아름마을효성", "이매아름마을풍림", "아름마을 두산삼호")
    + _dong("정자동", "정자상록마을라이프", "정자상록마을우성", "아이파크분당")
    + _dong("서현동", "분당시범삼성한신아파트", "서현시범우성", "시범현대아파트")
)
JAMSIL = _dong("신천동", "신천장미1차2차", "장미3차", "잠실파크리오")


def _name(name, dong, pool):
    found = rf.match(name, dong, pool)
    return found and found["name"]


@pytest.mark.parametrize(
    "name,dong,pool,expected",
    [
        ("은마", "대치동", DAECHI, "은마"),
        ("개포우성2", "대치동", DAECHI, "개포1차2차우성"),
        ("래미안대치팰리스", "대치동", DAECHI, "래미안 대치 팰리스"),
        ("신현대11차", "압구정동", APGUJEONG, "압구정신현대"),
        ("현대2차(10,11,20,23,24,25동)", "압구정동", APGUJEONG, "압구정현대아파트"),
        ("현대13차(208~211동)", "압구정동", APGUJEONG, "압구정 현대(10,13,14차)"),
        ("한양3", "압구정동", APGUJEONG, "압구정한양3단지"),
        ("한양4", "압구정동", APGUJEONG, None),  # K-apt has no 한양4
        ("타워팰리스3", "도곡동", DOGOK, None),  # not 타워팰리스G동
        ("도곡렉슬", "대치동", DAECHI + DOGOK, "도곡렉슬"),  # another 동, exact name
        ("이편한세상마포리버파크", "용강동", MAPO, "e편한세상마포리버파크"),
        ("래미안밤섬리베뉴Ⅱ", "상수동", MAPO, "래미안밤섬리베뉴 2"),
        ("공덕자이", "아현동", MAPO, "공덕자이 아파트"),
        ("공덕SK리더스뷰", "공덕동", MAPO, None),  # 1단지 or 2단지?
        ("봇들마을8단지(주공)", "삼평동", BUNDANG, "봇들마을휴먼시아8단지"),
        ("아름마을(효성)", "이매동", BUNDANG, "이매아름마을효성"),
        ("상록마을(우성)1", "정자동", BUNDANG, "정자상록마을우성"),
        ("시범한신", "서현동", BUNDANG, "분당시범삼성한신아파트"),
        ("장미2", "신천동", JAMSIL, "신천장미1차2차"),
        ("에테르노청담", "청담동", _dong("청담동", "청담르엘", "청담자이"), None),
    ],
)
def test_match_against_real_kapt_names(name, dong, pool, expected):
    assert _name(name, dong, pool) == expected


class FakeResponse:
    def __init__(self, payload):
        self.text = json.dumps(payload, ensure_ascii=False)
        self.content = self.text.encode()
        self.status_code = 200

    def json(self):
        return json.loads(self.text)

    def raise_for_status(self):
        pass


def _ok(items, total=None):
    return {"response": {"header": {"resultCode": "00"}, "body": {"items": items, "totalCount": total or 1}}}


@pytest.fixture
def world(monkeypatch):
    monkeypatch.setenv("MOLIT_API_KEY", "k")
    monkeypatch.setattr(rm, "_district", lambda code: {"x": [[20260901, "S1", "은마", "대치동", "1", 76.8, 250000, 5, 1979]]})
    store = {}
    monkeypatch.setattr(rf.realestate_store, "load_facts", lambda k: store.get(k))
    monkeypatch.setattr(rf.realestate_store, "save_facts", lambda k, p, at: store.__setitem__(k, (at, p)))
    monkeypatch.setattr(rf, "_memo", {})
    monkeypatch.setattr(rf, "_failures", {})
    calls = []

    def get(url, params, timeout):
        calls.append(url.rsplit("/", 1)[-1])
        if "getSigunguAptList4" in url:
            return FakeResponse(_ok([{"kaptCode": "A1", "kaptName": "은마아파트", "as3": "대치동"}]))
        if "getAphusBassInfoV5" in url:
            return FakeResponse(_ok({"item": {"kaptCode": "A1", "kaptdaCnt": "4424"}}))
        return FakeResponse(_ok({"item": {"kaptCode": "A1", "kaptdPcnt": "1000", "kaptdPcntu": "2500"}}))

    monkeypatch.setattr(rf.requests, "get", get)
    return calls


def test_facts_count_households_and_parking_and_are_stored(world):
    got = rf.complex_facts("11680:S1")
    assert got["matched"] and got["households"] == 4424 and got["parking"] == 3500
    assert got["parking_per_household"] == 0.8
    assert world == ["getSigunguAptList4", "getAphusBassInfoV5", "getAphusDtlInfoV5"]
    rf._memo.clear()
    assert rf.complex_facts("11680:S1")["parking"] == 3500
    assert len(world) == 3  # the second read came from the store


def test_unregistered_key_reports_error_once(world, monkeypatch):
    err = {"OpenAPI_ServiceResponse": {"cmmMsgHeader": {"errMsg": "SERVICE_KEY_IS_NOT_REGISTERED_ERROR", "returnReasonCode": "30"}}}
    monkeypatch.setattr(rf.requests, "get", lambda *a, **k: world.append(1) or FakeResponse(err))
    assert "NOT_REGISTERED" in rf.complex_facts("11680:S1")["error"]
    assert "NOT_REGISTERED" in rf.complex_facts("11680:S1")["error"]
    assert len(world) == 1  # the failure is remembered, not retried per card


def test_bare_envelope_is_read():
    res = FakeResponse({"header": {"resultCode": "00"}, "body": {"items": [{"kaptCode": "A1", "kaptName": "은마"}], "totalCount": 1}})
    items, total = rf._items(res)
    assert items[0]["kaptCode"] == "A1" and total == 1
