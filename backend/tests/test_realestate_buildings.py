import math

from app.services import realestate_buildings as rb


def _square(x, y, size):
    return [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]


def test_register_floors_become_heights_and_unknowns_stay_low():
    towers = [{"rings": [[(0, 0), (30, 0), (30, 15), (0, 15)]], "height": None, "floors": 35,
               "base": 0, "height_source": "floors"} for _ in range(3)]
    shed = {"rings": [[(0, 0), (40, 0), (40, 40), (0, 40)]], "height": None, "floors": None,
            "base": 0, "height_source": None}
    rb._fill_heights(towers + [shed])
    assert towers[0]["height"] == round(35 * rb.FLOOR_M + rb.GROUND_M, 1)
    # A register footprint without 층수 is never raised into an invented tower.
    assert shed["floors"] == 2 and shed["height_source"] == "estimated"


def test_osm_tower_without_levels_takes_the_complex_median():
    known = [{"rings": [[(0, 0), (20, 0), (20, 20), (0, 20)]], "height": None, "floors": f,
              "base": 0, "height_source": "floors"} for f in (20, 25, 30)]
    blank = {"rings": [[(0, 0), (30, 0), (30, 30), (0, 30)]], "height": None, "floors": None,
             "base": 0, "height_source": None}
    rb._fill_heights(known + [blank], tower_fallback=True)
    assert blank["floors"] == 25 and blank["height_source"] == "estimated"


def test_names_match_ignores_spacing_and_apartment_suffix():
    assert rb._names_match("래미안 원베일리", "래미안원베일리")
    assert rb._names_match("송파헬리오시티", "헬리오시티아파트")
    # Two-letter names ("현대") would pull in every neighbour sharing the word.
    assert not rb._names_match("대치현대", "현대")
    assert not rb._names_match("잠실엘스", "잠실리센츠")
    assert not rb._names_match("", "은마")


def test_vworld_picks_buildings_inside_the_parcel(monkeypatch):
    lon0, lat0 = 127.1, 37.5
    d = 0.0005
    parcel = {"type": "Feature", "properties": {"pnu": "1171010700109130000"},
              "geometry": {"type": "Polygon", "coordinates": [_square(lon0 - d, lat0 - d, 2 * d)]}}
    inside = {"properties": {"bld_nm": "", "dong_nm": "101동", "grnd_flr": "30", "height": "0"},
              "geometry": {"type": "MultiPolygon", "coordinates": [[_square(lon0, lat0, 0.0001)]]}}
    outside = {"properties": {"bld_nm": "다른 빌딩", "dong_nm": "", "grnd_flr": "12", "height": "40"},
               "geometry": {"type": "MultiPolygon", "coordinates": [[_square(lon0 + 3 * d, lat0, 0.0001)]]}}

    def fake(url, params):
        if url == rb.VWORLD_ADDRESS:
            return {"point": {"x": str(lon0), "y": str(lat0)}}
        if params["data"] == "LP_PA_CBND_BUBUN":
            return {"featureCollection": {"features": [parcel]}}
        return {"featureCollection": {"features": [inside, outside]}}

    monkeypatch.setattr(rb, "_vworld", fake)
    result = rb._from_vworld({"name": "헬리오시티"}, "서울특별시 송파구 가락동 913")
    assert result["source"] == "vworld"
    assert [b["name"] for b in result["buildings"]] == ["101동"]
    assert result["buildings"][0]["floors"] == 30 and result["buildings"][0]["height_source"] == "floors"
    assert len(result["context"]) == 1 and result["context"][0]["height"] == 40
    # Metres around the geocoded point, counter-clockwise outer rings.
    outer = result["buildings"][0]["rings"][0]
    assert rb._area(outer) > 0 and all(abs(x) < 60 and abs(y) < 60 for x, y in outer)
    assert math.isclose(abs(rb._area(outer)), 0.0001 * 111_320 * math.cos(math.radians(lat0)) * 0.0001 * 110_540, rel_tol=0.02)


def test_missing_key_falls_back_to_osm_without_calling_vworld(monkeypatch):
    monkeypatch.delenv("VWORLD_API_KEY", raising=False)
    monkeypatch.setattr(rb, "_lookup", lambda cid: {"name": "은마", "dong": "대치동", "jibun": "316",
                                                    "sgg_name": "강남구", "sido_name": "서울특별시"})
    monkeypatch.setattr(rb, "_from_vworld", lambda *a: (_ for _ in ()).throw(AssertionError("no key, no call")))
    monkeypatch.setattr(rb, "_from_osm", lambda c, addr: None)
    body = rb._build("11680:대치동:316:은마")
    assert body["found"] is False and body["vworld"] is False
