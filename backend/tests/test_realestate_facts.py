import json

import pytest

from app.services import realestate_facts as rf
from app.services import realestate_map as rm

LIST = [
    {"code": "A1", "name": "은마아파트", "dong": "대치동", "ri": ""},
    {"code": "A2", "name": "래미안대치팰리스1단지", "dong": "대치동", "ri": ""},
    {"code": "A3", "name": "래미안대치팰리스2단지", "dong": "대치동", "ri": ""},
    {"code": "A4", "name": "개포우성1차", "dong": "대치동", "ri": ""},
    {"code": "B1", "name": "은마", "dong": "개포동", "ri": ""},
    {"code": "C1", "name": "도곡렉슬", "dong": "도곡동", "ri": ""},
]


def test_match_prefers_own_dong_and_refuses_ambiguity():
    assert rf.match("은마", "대치동", LIST)["code"] == "A1"
    assert rf.match("은마", "개포동", LIST)["code"] == "B1"
    assert rf.match("개포우성1", "대치동", LIST)["code"] == "A4"
    assert rf.match("도곡렉슬(도곡1차)", "대치동", LIST)["code"] == "C1"  # not in its 동 → whole 시군구
    assert rf.match("래미안대치팰리스", "대치동", LIST) is None  # 1단지 or 2단지?
    assert rf.match("없는단지", "대치동", LIST) is None


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
