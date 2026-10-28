"""Walk-mode flat types: grouping the register's 전유 rows, and the route's fallbacks.

No network and no database: the register and trade lookups are replaced here."""

from app.services import realestate_units as ru


def test_dong_key_normalises_register_spellings():
    assert ru.dong_key("제101동") == "101"
    assert ru.dong_key("101동") == "101"
    assert ru.dong_key("101") == "101"
    assert ru.dong_key("a동") == "A"


def test_summarize_groups_flats_by_area_and_sums_split_rows():
    rows = [
        {"dong": "101동", "floor": 3, "ho": "301", "area": 84.97, "use": "아파트"},
        {"dong": "101동", "floor": 4, "ho": "401", "area": 84.97, "use": "아파트"},
        {"dong": "101동", "floor": 4, "ho": "402", "area": 59.9, "use": "아파트"},
        # one flat registered in two parts
        {"dong": "101동", "floor": 12, "ho": "1201", "area": 50.0, "use": "아파트"},
        {"dong": "101동", "floor": 12, "ho": "1201", "area": 9.9, "use": "아파트"},
        # not a flat
        {"dong": "101동", "floor": 1, "ho": "101", "area": 30.0, "use": "제1종근린생활시설"},
    ]
    out = ru.summarize_flats(rows)
    assert [(g["area"], g["count"]) for g in out] == [(59.9, 2), (84.97, 2)]
    assert out[1]["floor_min"] == 3 and out[1]["floor_max"] == 4


def test_units_prefers_register_and_falls_back_to_trades(monkeypatch):
    monkeypatch.setattr(ru.rm, "complex_detail", lambda cid, period: {"name": "테스트", "item": {"built": 2018},
                        "types": [{"area": 84.97, "trades_total": 12, "price_source": "sale"}, {"area": 59.9, "trades_total": 3, "price_source": "sale"}]})
    monkeypatch.setattr(ru.realestate_facts, "complex_facts", lambda cid: {"matched": True, "households": 900})
    ru._memo.clear()
    monkeypatch.setattr(ru, "_expos_rows", lambda pnu, dong: [{"dong": "101동", "floor": 7, "ho": "701", "area": 84.97, "use": "아파트"}])
    body = ru.units("11680:x:1:테스트", "101동", "1168010300112820000")
    assert body["types"][0]["source"].startswith("건축물대장")
    assert body["types"][0]["trades"] == 12 and body["types"][0]["households"] == 1
    assert body["households"] == 900
    # no PNU: the traded 평형
    body = ru.units("11680:x:1:테스트", "101동", None)
    assert [t["areaM2"] for t in body["types"]] == [59.9, 84.97]
    assert body["types"][0]["source"] == "국토교통부 실거래 전용면적"
