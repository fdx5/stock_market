from app.services import realestate_floors as rf


def test_floor_level():
    assert rf.floor_level("지하", "2") == -2
    assert rf.floor_level("지상", "7") == 7
    assert rf.floor_level("지상", None) is None


def test_building_floors_groups_rows(monkeypatch):
    titles = [{"bldNm": "테스트타워", "dongNm": "", "mainPurpsCdNm": "업무시설", "grndFlrCnt": "12", "ugrndFlrCnt": "3", "rideUseElvtCnt": "4", "emgenUseElvtCnt": "1", "totArea": "20000", "mainAtchGbCdNm": "주건축물"},
              {"bldNm": "부속동", "dongNm": "", "mainPurpsCdNm": "창고", "grndFlrCnt": "1", "totArea": "30", "mainAtchGbCdNm": "부속건축물"}]
    rows = [{"dongNm": "", "flrGbCdNm": "지하", "flrNo": "1", "flrNoNm": "지하1층", "mainPurpsCdNm": "주차장", "area": "1500"},
            {"dongNm": "", "flrGbCdNm": "지상", "flrNo": "1", "flrNoNm": "1층", "mainPurpsCdNm": "제1종근린생활시설", "etcPurps": "소매점", "area": "300"},
            {"dongNm": "", "flrGbCdNm": "지상", "flrNo": "1", "flrNoNm": "1층", "mainPurpsCdNm": "업무시설", "etcPurps": "로비", "area": "500"},
            {"dongNm": "", "flrGbCdNm": "지상", "flrNo": "2", "flrNoNm": "2층", "mainPurpsCdNm": "업무시설", "etcPurps": "사무소", "area": "900"}]
    monkeypatch.setattr(rf, "_fetch", lambda op, pnu: titles if op == "getBrTitleInfo" else rows)
    rf_cache = __import__("app.services.realestate_building_info", fromlist=["_memo"])._memo
    rf_cache.clear()
    d = rf.building_floors("1168010600103160000", "테스트타워")
    assert d["building"]["rideLifts"] == 4 and d["building"]["basements"] == 3
    assert [f["level"] for f in d["floors"]] == [-1, 1, 2]
    assert d["floors"][1]["area"] == 800 and d["floors"][1]["uses"][0]["detail"] == "로비"
