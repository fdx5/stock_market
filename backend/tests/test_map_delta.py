"""Changed-rows-only refreshes of the US map lists (services/map_delta.py)."""
import copy

from app.services import map_delta


def _payload(rows):
    return {"generated_at": "t", "session": "pre", "count": len(rows), "items": copy.deepcopy(rows)}


def _rebuild(held, res):
    changed = {item["code"]: item for item in res["items"]}
    return [changed.get(code) or held[code] for code in res["codes"]]


def test_delta_sends_only_changed_rows_and_rebuilds_the_full_list():
    rows = [{"code": f"C{i}", "close": 100.0 + i, "volume": i} for i in range(50)]
    first = map_delta.apply("test-a", _payload(rows), None, None)
    assert "delta" not in first and len(first["items"]) == 50
    held = {item["code"]: item for item in first["items"]}

    rows[3]["close"] = 1.5
    rows[40]["volume"] = 999
    res = map_delta.apply("test-a", _payload(rows), first["delta_seq"], first["delta_token"])
    assert res["delta"] is True
    assert [item["code"] for item in res["items"]] == ["C3", "C40"]
    assert _rebuild(held, res) == rows
    assert res["count"] == 50 and res["close_sum"] == map_delta.close_sum(rows)

    # nothing changed since the previous response: no rows at all
    again = map_delta.apply("test-a", _payload(rows), res["delta_seq"], res["delta_token"])
    assert again["items"] == [] and len(again["codes"]) == 50


def test_a_new_or_reordered_row_and_a_foreign_token():
    rows = [{"code": "A", "close": 1.0}, {"code": "B", "close": 2.0}]
    first = map_delta.apply("test-b", _payload(rows), None, None)
    rows = [{"code": "C", "close": 3.0}, rows[1], rows[0]]
    res = map_delta.apply("test-b", _payload(rows), first["delta_seq"], first["delta_token"])
    assert [item["code"] for item in res["items"]] == ["C"] and res["codes"] == ["C", "B", "A"]
    held = {item["code"]: item for item in first["items"]}
    assert _rebuild(held, res) == rows
    # another process's token, or a sequence from the future, gets the full list
    assert "delta" not in map_delta.apply("test-b", _payload(rows), first["delta_seq"], "other")
    assert "delta" not in map_delta.apply("test-b", _payload(rows), 10**9, map_delta.TOKEN)
