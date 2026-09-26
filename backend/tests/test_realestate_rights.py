import datetime as dt
import xml.etree.ElementTree as ET

from app.services import realestate_rights as rights
from app.services import realestate_map as rm
from app.services import realestate_leaders as leaders

TODAY = dt.date(2026, 9, 27)


def xml(**fields):
    values = dict(aptNm="신규단지", umdNm="이문동", jibun="1", dealYear="2026", dealMonth="9",
                  dealDay="1", excluUseAr="84.9", dealAmount="150,000", dealingGbn="중개거래", floor="10")
    values.update(fields)
    return ET.fromstring("<item>" + "".join(f"<{k}>{v}</{k}>" for k, v in values.items()) + "</item>")


def record(name="신규단지", dong="이문동", lot="1", price=150000, day=20260901, area=84.9, direct=0):
    return [day, "", name, dong, lot, area, price, 10, 0, direct, "분양권"]


def complex_(cid="11230:A", name="신규 단지", dong="이문동", day=20250801, direct=0):
    return {"id": cid, "name": name, "lawd": "11230", "dong": dong, "built": 2025,
            "last": day, "types": {85: [(day, 100000, 10, 84.9, direct)]}}


def test_parse_cancellation_invalid_future_units_and_direct():
    nodes = [xml(), xml(cdealType="O"), xml(cdealDay="20260903"), xml(excluUseAr="NaN"),
             xml(dealYear="2027"), xml(dealDay="32"), xml(dealAmount="0"), xml(excluUseAr="-1"),
             xml(dealingGbn="직거래", ownershipGbn="입주권")]
    rows = rights.parse_items(nodes, TODAY)
    assert len(rows) == 2
    assert rows[0][5:7] == [84.9, 150000]
    assert rows[1][9:] == [1, "입주권"]
    assert rm.api_of(rights.ENDPOINT) == "rights"


def test_matching_uses_district_dong_name_and_does_not_mutate_sales():
    c = complex_()
    merged = rights.merge_records({c["id"]: c}, {"11230": [record()]}, TODAY)
    assert list(merged) == [c["id"]]
    assert merged[c["id"]]["type_sources"][85] == "rights"
    assert merged[c["id"]]["types"][85][0][1] == 150000
    assert c["types"][85][0][1] == 100000
    assert merged[c["id"]]["aliases"][0].startswith("11230:rights:")


def test_ambiguous_names_and_other_dongs_never_merge():
    a, b = complex_(), complex_(cid="11230:B")
    assert len(rights.merge_records({a["id"]: a, b["id"]: b}, {"11230": [record()]}, TODAY)) == 3
    assert len(rights.merge_records({a["id"]: a}, {"11230": [record(dong="휘경동")]}, TODAY)) == 2
    assert len(rights.merge_records({a["id"]: a}, {"11680": [record()]}, TODAY)) == 2


def test_recent_sales_precede_rights_and_sources_never_mix_in_one_history():
    c = complex_(day=20260901)
    result = rights.merge_records({c["id"]: c}, {"11230": [record(day=20260920)]}, TODAY)[c["id"]]
    assert result["type_sources"][85] == "sale"
    assert len(result["types"][85]) == 1 and result["types"][85][0][1] == 100000
    c = complex_(day=20260901, direct=1)
    result = rights.merge_records({c["id"]: c}, {"11230": [record()]}, TODAY)[c["id"]]
    assert result["type_sources"][85] == "rights"


def test_new_rights_only_complexes_are_ranked_provisionally():
    merged = rights.merge_records({}, {"11230": [record(name=n, price=p) for n, p in [("A", 100000), ("B", 200000), ("C", 300000)]]}, TODAY)
    assessed = leaders.evaluate(merged, TODAY)
    assert len(assessed) == 3
    assert all(a["rank"] and a["status"] == "provisional" for a in assessed.values())
    assert all(a["bands"][0]["source"] == "rights" for a in assessed.values())


def test_recent_direct_is_not_hidden_by_year_old_brokered_sale():
    rows = [(20250101, 100000, 10, 84.9, 0), (20260901, 150000, 10, 84.9, 1)]
    sample, _, direct = leaders.select_reference(rows, TODAY)
    assert direct and sample[0][1] == 150000


def test_sparse_neighbors_do_not_duplicate_one_complex_in_peer_pool():
    data = {"A": {"types": {100: [(20260901, 200000, 10, 99.98, 1)]}},
            "B": {"types": {95: [(20260901, 100000, 10, 94.98, 0)], 105: [(20260901, 110000, 10, 104.98, 0)]}}}
    result = leaders.evaluate(data, TODAY)
    assert result["A"]["rank"]
    assert result["A"]["bands"][0]["peers"] == 2
    assert result["A"]["bands"][0]["expanded_comparison"]


def test_failed_refresh_keeps_persisted_snapshot(monkeypatch):
    monkeypatch.setattr(rights, "_cache", rights.OrderedDict())
    months = rm._months_back(rights.MONTHS)
    payload = {months[0]: ("2026-09-01T00:00:00+09:00", [record()])}
    monkeypatch.setattr(rights.store, "load_facts", lambda key: ("x", payload))
    loaded = rights._load("11230")
    loaded["bad"] = ("x", [])
    assert "bad" not in rights._cache["11230"]
    assert rights._load("11230")[months[0]][1] == [record()]


def test_rights_only_map_detail_filter_and_source_consistency(monkeypatch):
    today = dt.datetime.now(rm.KST).date()
    date = rm._as_int(today - dt.timedelta(days=5))
    rows = [record(name=n, price=p, day=date) for n, p in [("A", 100000), ("B", 200000), ("C", 300000)]]
    monkeypatch.setattr(rm, "is_configured", lambda: False)
    monkeypatch.setattr(rm, "_prefetch", lambda codes: None)
    monkeypatch.setattr(rm, "_district", lambda code: {})
    monkeypatch.setattr(rights, "merge", lambda complexes, codes, **kwargs: rights.merge_records(complexes, {"11230": rows}, today))
    monkeypatch.setattr(rm, "_older_trades", lambda *args: (_ for _ in ()).throw(AssertionError("must not mix older sales with rights")))
    data = rm.build_map("11", "11230", "이문동", "1y", filters={"include_leaders": True, "limit": 1})
    assert len(data["items"]) == 3 and data["ranking"]["provisional_count"] == 3
    assert all(it["price_source"] == "rights" and it["leader"]["rank"] for it in data["items"])
    cid = data["items"][0]["id"]
    detail = rm.complex_detail(cid, "1y")
    assert detail["item"]["price_source"] == "rights"
    assert all(v["price_source"] == "rights" for v in detail["types"])
    assert detail["history"]["target"] == "최근 13개월"
    filtered = rm.build_map("11", "11230", "이문동", "3m", filters={"q": "B", "include_leaders": True})
    assert filtered["items"][0]["leader"]["rank"] == 2


def test_month_pagination_uses_independent_rights_endpoint(monkeypatch):
    calls = []
    def page(endpoint, code, month, number):
        calls.append((endpoint, number))
        return [xml(aptNm=f"단지{number}")], 2
    monkeypatch.setattr(rm, "ROWS_PER_PAGE", 1)
    monkeypatch.setattr(rm, "CALL_SPACING_SECONDS", 0)
    monkeypatch.setattr(rm, "_get_page", page)
    result = rights.fetch_month("11230", "202609")
    assert len(result) == 2
    assert calls == [(rights.ENDPOINT, 1), (rights.ENDPOINT, 2)]


def test_source_choice_ignores_future_and_nonfinite_price():
    rows = [(20260901, float("nan"), 10, 84.9, 0), (20260901, 150000, 10, 84.9, 1), (20270901, 999999, 10, 84.9, 0)]
    sample, _, direct = leaders.select_reference(rows, TODAY)
    assert len(sample) == 1 and direct
