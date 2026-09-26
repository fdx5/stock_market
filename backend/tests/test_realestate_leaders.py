import datetime as dt

from app.services import realestate_leaders as leaders
from app.services import realestate_map as rm

TODAY = dt.date(2026, 9, 27)


def fixture_complex(cid, price, area=84.9, today=TODAY):
    days = [5, 35, 65, 95, 125, 155, 190, 220, 250, 280, 310, 340,
            370, 400, 430, 460, 490, 520, 550, 580, 610, 640, 670, 700]
    return {"id": cid, "types": {round(area): [
        (leaders._day(today - dt.timedelta(days=ago)), price, 10, area, 0) for ago in days]}}


def pool(today=TODAY):
    return {cid: fixture_complex(cid, price, today=today) for cid, price in
            (("A", 300000), ("B", 200000), ("C", 100000), ("D", 50000))}


def test_price_persistence_and_evidence():
    result = leaders.evaluate(pool(), TODAY)
    assert result["A"]["rank"] == 1
    assert result["A"]["score"] > result["B"]["score"] > result["C"]["score"]
    assert result["A"]["confidence"] == "limited", "few comparable complexes limit confidence"
    assert result["A"]["bands"][0]["quarters"] >= 6
    assert result["A"]["bands"][0]["sample_count"] == 6


def test_one_outlier_and_direct_trade_do_not_create_a_leader():
    data = pool()
    before = leaders.evaluate(data, TODAY)
    data["D"]["types"][85].extend([
        (20260926, 99999999, 30, 84.9, 0),
        (20260925, 99999999, 30, 84.9, 1),
    ])
    result = leaders.evaluate(data, TODAY)
    assert result["D"]["price_score"] == before["D"]["price_score"]
    assert result["D"]["rank"] == 4
    data["only_direct"] = {"types": {85: [(20260901, 99999999, 10, 84.9, 1)] * 8}}
    assert "only_direct" not in leaders.evaluate(data, TODAY)


def test_area_groups_do_not_mix_and_sparse_history_has_no_score():
    data = pool()
    data["small"] = fixture_complex("small", 999999, area=59.9)
    data["new"] = {"types": {85: [(20260901, 999999, 10, 84.9, 0)] * 3}}
    result = leaders.evaluate(data, TODAY)
    assert "small" not in result
    assert "new" not in result
    assert leaders.evaluate({"A": data["A"], "B": data["B"]}, TODAY) == {}


def test_fallback_and_stale_samples():
    data = pool()
    data["A"]["types"][85] = [r for r in data["A"]["types"][85] if r[0] < 20260301] + [(20260901, 300000, 10, 84.9, 0)]
    result = leaders.evaluate(data, TODAY)
    assert result["A"]["bands"][0]["window_months"] == 12
    assert result["A"]["confidence"] == "limited"
    data["A"]["types"][85] = [r for r in data["A"]["types"][85] if r[0] < 20260301]
    assert "A" not in leaders.evaluate(data, TODAY)


def test_ties_and_future_trades():
    assert leaders._percentiles({"a": 1, "b": 1, "c": 1}) == {"a": 50, "b": 50, "c": 50}
    data = pool()
    before = leaders.evaluate(data, TODAY)
    data["A"]["types"][85].append((20270101, 99999999, 10, 84.9, 0))
    assert leaders.evaluate(data, TODAY) == before


def test_demand_is_bounded_when_365_days_touch_13_calendar_months():
    data = pool()
    for c in data.values():
        rows = c["types"][85]
        rows.extend((leaders._day(TODAY - dt.timedelta(days=n)), rows[0][1], 10, 84.9, 0) for n in range(365))
    assert all(0 <= r["demand_score"] <= 100 and 0 <= r["score"] <= 100 for r in leaders.evaluate(data, TODAY).values())


def test_small_peer_groups_are_not_equivalent_to_large_peer_groups():
    assert 50 < leaders._supported(100, 3) < leaders._supported(100, 100) < 100
    assert leaders._supported(50, 3) == 50
    assert 0 < leaders._supported(0, 100) < leaders._supported(0, 3) < 50


def test_map_ranks_before_limits_filters_and_period(monkeypatch):
    today = dt.datetime.now(rm.KST).date()
    data = pool(today)
    trades = [[day, cid, cid, "대치동", "1", area, price, floor, 2010, direct]
              for cid, c in data.items() for rows in c["types"].values()
              for day, price, floor, area, direct in rows]
    monkeypatch.setattr(rm, "is_configured", lambda: False)
    monkeypatch.setattr(rm, "_prefetch", lambda codes: None)
    monkeypatch.setattr(rm, "_district", lambda code: {"sample": trades})
    first = rm.build_map("11", "11680", None, "3m", filters={"limit": 1, "sort": "price_asc", "include_leaders": True})
    assert first["ranking"]["pinned_count"] == 3
    assert {r["leader"]["rank"] for r in first["items"]} == {1, 2, 3, 4}
    other = rm.build_map("11", "11680", None, "1y", filters={"q": "B", "limit": 1, "include_leaders": True})
    assert len(other["items"]) == 1
    assert other["items"][0]["leader"]["rank"] == 2
    assert other["items"][0]["leader"] == next(r["leader"] for r in first["items"] if r["name"] == "B")
    assert other["items"][0]["price_rank"] == 2
    page = rm.build_map("11", "11680", None, "3m", filters={"limit": 1, "offset": 3, "include_leaders": True})
    assert len(page["items"]) == 1 and page["ranking"]["pinned_count"] == 0


def test_price_mode_pins_price_winner_even_if_not_eligible(monkeypatch):
    today = dt.datetime.now(rm.KST).date()
    trades = [[leaders._day(today), str(i), str(i), "대치동", "1", 84.9, 10000 * i, 10, 2010, 0] for i in range(1, 5)]
    monkeypatch.setattr(rm, "is_configured", lambda: False)
    monkeypatch.setattr(rm, "_prefetch", lambda codes: None)
    monkeypatch.setattr(rm, "_district", lambda code: {"sample": trades})
    result = rm.build_map("11", "11680", None, "3m", filters={"limit": 1, "sort": "price_asc", "include_leaders": True, "crown_mode": "price"})
    assert result["ranking"]["eligible_count"] == 0
    assert {r["price_rank"] for r in result["items"]} == {1, 2, 3, 4}
