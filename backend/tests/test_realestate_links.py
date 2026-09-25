from app.services import realestate_links as rl
from app.services import realestate_map as rm


def test_candidates_put_cha_after_a_closing_number_first():
    assert rl.candidates("신도6", "")[:2] == ["신도6차", "신도6"]
    assert rl.candidates("개포우성2", "대치동")[:2] == ["대치동 개포우성2차", "대치동 개포우성2"]
    assert rl.candidates("은마", "대치동") == ["대치동 은마"]


def test_candidates_handle_parentheses_and_building_lists():
    assert rl.candidates("현대2차(10,11,20,23,24,25동)", "압구정동")[0] == "압구정동 현대2차"
    got = rl.candidates("상록마을(우성)1", "정자동")
    assert got[:4] == ["정자동 상록마을우성1차", "정자동 상록마을우성1", "정자동 상록마을1차", "정자동 상록마을1"]
    assert "정자동 상록마을우성" in got  # the closing number dropped, last


def test_first_search_that_opens_a_complex_is_kept(monkeypatch):
    monkeypatch.setattr(rm, "_complexes", lambda codes: {"41135:X": {"name": "신도6", "dong": "서현동"}})
    monkeypatch.setattr(rm, "_sgg_index", lambda: {"41135": {}})
    stored = {}
    monkeypatch.setattr(rl.realestate_store, "load_facts", lambda k: stored.get(k))
    monkeypatch.setattr(rl.realestate_store, "save_facts", lambda k, p, at: stored.__setitem__(k, (at, p)))
    tried = []

    def resolve(words):
        tried.append(words)
        return ("complex", "2127") if words.endswith("6차") else ("none", None)

    monkeypatch.setattr(rl, "_resolve", resolve)
    got = rl.naver_link("41135:X")
    assert got == {"query": "서현동 신도6차", "kind": "complex", "complex": "2127"}
    assert rl.naver_link("41135:X") == got and len(tried) == 1  # remembered


def test_falls_back_to_the_map_then_to_the_plain_search(monkeypatch):
    monkeypatch.setattr(rm, "_complexes", lambda codes: {"11650:Y": {"name": "타워팰리스3", "dong": "도곡동"}})
    monkeypatch.setattr(rm, "_sgg_index", lambda: {"11650": {}})
    monkeypatch.setattr(rl.realestate_store, "load_facts", lambda k: None)
    monkeypatch.setattr(rl.realestate_store, "save_facts", lambda *a: None)
    monkeypatch.setattr(rl, "_resolve", lambda w: ("map", None) if w == "도곡동 타워팰리스" else ("none", None))
    assert rl.naver_link("11650:Y") == {"query": "도곡동 타워팰리스", "kind": "map"}
    monkeypatch.setattr(rl, "_resolve", lambda w: ("none", None))
    assert rl.naver_link("11650:Y")["kind"] == "search"


def test_lot_numbers_in_parentheses_are_dropped():
    assert rl.candidates("상지리츠빌카일룸(1009-4)", "대치동")[0] == "대치동 상지리츠빌카일룸"
