from app.services import realestate_nearby as rn


def _setup(monkeypatch, complexes):
    monkeypatch.setattr(rn.rm, "_sgg_index", lambda: {"11680": {"name": "강남구", "sido_name": "서울특별시"}})
    monkeypatch.setattr(rn.rm, "_complexes", lambda codes: {c["id"]: c for c in complexes})
    import app.services.realestate_rights as rr
    monkeypatch.setattr(rr, "merge", lambda found, codes, priority=False: found)


def _c(cid, name, umd, jibun):
    return {"id": cid, "name": name, "lawd": "11680", "dong": umd, "umd": umd, "jibun": jibun, "built": 1980}


def _parcel(addr, *buildings, pnu="1168011000103690001"):
    return {"pnu": pnu, "addr": addr, "buildings": list(buildings)}


def test_dong_lists_in_names():
    assert rn._dongs_in("현대6차(78~81,83,84동)") == {78, 79, 80, 81, 83, 84}
    assert rn._dongs_in("현대8차(성수현대:91~95동)") == {91, 92, 93, 94, 95}
    assert rn._dongs_in("한양4") == set()
    assert rn._dong_of({"name": "현대아파트 제127동", "dong": ""}) == 127
    assert rn._dong_of({"name": "현대아파트", "dong": "76"}) == 76
    assert rn._dong_of({"name": "칼릭스빌 A동", "dong": ""}) is None


def test_parcels_match_by_lot_and_split_by_dong(monkeypatch):
    _setup(monkeypatch, [
        _c("11680:a", "현대1차(12,13,21,22동)", "압구정동", "369-1"),
        _c("11680:b", "현대2차(10,11,20동)", "압구정동", "369-1"),
        _c("11680:c", "한양4", "압구정동", "486"),
        _c("11680:d", "다른동아파트", "신사동", "486"),
        _c("11680:home", "한양1차", "압구정동", "490"),
    ])
    out = rn.nearby("11680:home", [
        _parcel("서울특별시 강남구 압구정동 369-1",
                {"x": 100, "y": 0, "name": "현대아파트12동", "floors": 12},
                {"x": 300, "y": 0, "name": "현대아파트 제10동", "floors": 14}),
        _parcel("서울특별시 강남구 압구정동 486", {"x": 0, "y": 50, "name": "", "dong": "", "floors": 12}, pnu="1168011000104860000"),
        _parcel("서울특별시 강남구 압구정동 490", {"x": 0, "y": 0, "name": "한양", "floors": 13}, pnu="1168011000104900000"),
        _parcel("서울특별시 강남구 압구정동 999", {"x": 5, "y": 5, "name": "빌라", "floors": 5}, pnu="1168011000109990000"),
    ])
    names = [i["name"] for i in out["items"]]
    # nearest first; the home complex and unmatched lots left out; 신사동 486 is another lot
    assert names == ["한양4", "현대1차(12,13,21,22동)", "현대2차(10,11,20동)"]
    assert out["items"][1]["x"] == 100 and out["items"][2]["x"] == 300


def test_lot_from_address():
    assert rn._lot("서울특별시 강남구 압구정동 369-1") == ("압구정동", "369-1")
    assert rn._lot("경기도 양평군 양평읍 양근리 산 12") == ("양근리", "산12")
    assert rn._lot("서울특별시 강남구") is None


def test_driving_point_finds_complexes_without_a_home_district(monkeypatch):
    _setup(monkeypatch, [_c("11680:a", "현대아파트", "압구정동", "369-1")])
    out = rn.nearby("pt:37.53,127.02", [
        _parcel("서울특별시 강남구 압구정동 369-1", {"x": 120, "y": 80, "floors": 12}),
    ])
    assert out["items"][0]["id"] == "11680:a"


def test_invalid_driving_point_is_rejected(monkeypatch):
    import pytest
    _setup(monkeypatch, [])
    for point in ["pt:nan,127", "pt:0,127", "pt:37,200", "pt:37,127<script>"]:
        with pytest.raises(ValueError):
            rn.nearby(point, [])
