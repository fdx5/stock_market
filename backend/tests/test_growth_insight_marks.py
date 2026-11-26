"""'지금 할 일' completion marks (fresh temp DB only)."""
from app.services import growth_control as gc
from app.services import page_view_store as pvs


def test_key_ignores_changing_numbers():
    assert gc.insight_key("측정", "직접·미식별 84%") == gc.insight_key("측정", "직접·미식별 79.5%")
    assert gc.insight_key("콘텐츠", "/map 첫 페이지 이탈률 80%") != gc.insight_key("콘텐츠", "/drone 첫 페이지 이탈률 80%")


def test_marks_are_append_only_and_newest_wins(monkeypatch, tmp_path):
    monkeypatch.setattr(pvs, "TURSO_DATABASE_URL", "", raising=False)
    monkeypatch.setattr(pvs, "LOCAL_DB_PATH", tmp_path / "pv.db")
    monkeypatch.setattr(pvs, "_conn", None)
    k1, k2, k3 = "측정|A", "검색|B", "신뢰도|C"
    gc.mark_insight(k1, "done", "A", "tagged every link")
    gc.mark_insight(k2, "done", "B")
    gc.mark_insight(k2, "open", "B")           # reopened
    gc.mark_insight(k3, "done", "C")           # no longer firing below
    marks = pvs._with_connection(gc._insight_marks)
    assert marks[k1]["status"] == "done" and marks[k2]["status"] == "open"
    rows = pvs._with_connection(lambda c: c.execute("SELECT COUNT(*) FROM growth_insight_marks").fetchone()[0])
    assert rows == 4
    insights = [{"key": k1, "severity": "critical"}, {"key": k2, "severity": "info"}]
    ordered, resolved = gc._apply_marks(insights, marks)
    assert [i["key"] for i in ordered] == [k2, k1]          # done item sorts last
    assert ordered[1]["mark"]["note"] == "tagged every link" and ordered[0]["mark"] is None
    assert [r["key"] for r in resolved] == [k3]
