"""Per-stock 급등·급락 history and the archive sitemap, on a fresh temporary DB only."""
import datetime as dt
import json

import pytest

from app.services import movers, movers_store


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("MOVERS_LOCAL_DB", str(tmp_path / "movers-test.db"))
    monkeypatch.setattr(movers_store, "LOCAL_DB_PATH", tmp_path / "movers-test.db")
    monkeypatch.setattr(movers_store, "_conn", None)
    monkeypatch.setattr(movers, "_history_rows", {})
    monkeypatch.setattr(movers, "_history_index", {})
    monkeypatch.setattr(movers, "_history_slots", [])
    monkeypatch.setattr(movers, "_history_due", 0.0)

    def put(k, payload):
        body = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)

        def run(conn):
            conn.execute("INSERT INTO movers_editions (slot, payload, model, created_at) VALUES (?, ?, ?, ?)",
                         (k, body, "test", "2026-11-28T00:00:00+09:00"))
            conn.commit()
        movers_store._with_connection(run)
    yield put
    if movers_store._conn is not None:
        movers_store._conn.close()
    movers_store._conn = None


def edition(day, label, stocks, slot_name="장 마감"):
    return {"edition": day, "slot_label": label, "slot_name": slot_name, "slot": f"{day}T{label}+09:00",
            "headline": "h", "dek": "d", "stocks": stocks}


def stock(code, pct, reason, direction="up", limit=""):
    return {"code": code, "name": "삼성전자", "change_pct": pct, "reason": reason, "theme": "반도체",
            "limit": limit, "direction": direction}


def test_history_lists_each_edition_newest_first_and_prefers_the_revision(store):
    store("2026-11-26T16:00+09:00", edition("2026-11-26", "16:00", [stock("005930", -3.1, "차익 실현", "down")]))
    store("2026-11-27T16:00+09:00", edition("2026-11-27", "16:00", [stock("005930", 4.7, "초안 이유")]))
    store("2026-11-27T16:00+09:00~r1", edition("2026-11-27", "16:00", [stock("005930", 4.7, "개정된 이유", limit="")]))

    entries = movers.history_for_stock("005930", limit=None, wait=True)

    assert [(e["edition"], e["reason"]) for e in entries] == [("2026-11-27", "개정된 이유"), ("2026-11-26", "차익 실현")]
    assert entries[0]["path"] == "/movers/2026-11-27/1600"
    assert movers.history_for_stock("000660", wait=True) == []


def test_sitemap_skips_unreadable_editions_and_keeps_kr_beside_many_us_rows(store, monkeypatch):
    store("2026-11-26T09:20+09:00", edition("2026-11-26", "09:20", [stock("005930", 2.0, "a")]))
    store("2026-11-26T12:30+09:00", "{not json")
    store("us:2026-11-25T06:40+09:00", {**edition("2026-11-25", "06:40", [stock("NVDA", 5.0, "b")]), "market": "us"})
    store("us:2026-11-25T21:00+09:00", {**edition("2026-11-25", "21:00", [stock("NVDA", 1.0, "c")]), "market": "us"})
    monkeypatch.setattr(movers, "HISTORY_SLOTS", 2)  # the two US rows alone would fill a shared limit

    paths = [path for path, _ in movers.sitemap_editions(dt.datetime(2026, 11, 28, 12, tzinfo=movers.KST))]

    assert "/movers/2026-11-26/0920" in paths
    assert "/movers/2026-11-26/1230" not in paths
    assert "/movers/us/2026-11-25/0640" in paths
    assert [e["path"] for e in movers.history_for_stock("NVDA")] == ["/movers/us/2026-11-25/2100", "/movers/us/2026-11-25/0640"]


def test_page_render_does_not_wait_for_the_index(monkeypatch):
    monkeypatch.setattr(movers, "_history_due", 0.0)
    monkeypatch.setattr(movers, "_history_index", {})
    started = []
    monkeypatch.setattr(movers.threading, "Thread", lambda **kw: type("T", (), {"start": lambda self: started.append(kw["name"])})())

    assert movers.history_for_stock("005930") == []
    assert started == ["movers-history"]
