import sqlite3

from app.services import realestate_store as st


def _db(path, rows):
    c = sqlite3.connect(path)
    c.execute(st._SCHEMA)
    c.execute(st._FACTS_SCHEMA)
    c.execute(st._MAP_SCHEMA)
    c.executemany("INSERT INTO re_trade_months VALUES (?, ?, ?, ?, ?)", rows)
    c.commit()
    c.close()


def test_copies_the_shared_rows_keeps_newer_ones_and_marks_itself_done(tmp_path, monkeypatch):
    shared, own = str(tmp_path / "shared.db"), str(tmp_path / "own.db")
    _db(shared, [("11680", f"2026{m:02d}", "old", 1, f"p{m}") for m in range(1, 91)])
    _db(own, [("11680", "202605", "new", 2, "fresh")])  # collected after the switch
    c = sqlite3.connect(own)
    c.execute("INSERT INTO re_map_cache VALUES ('sido:11:3m:200', 'x', 'built from an empty database')")
    c.commit()
    c.close()
    monkeypatch.setattr(st, "SHARED_DATABASE_URL", shared)
    monkeypatch.setattr(st, "TURSO_DATABASE_URL", own)
    monkeypatch.setattr(st, "migrated", st._threading.Event())
    monkeypatch.setattr(st, "_moved_upto", {})
    monkeypatch.setattr(st, "migration_state", {"rows": 0})
    st._migrate_once()
    assert st.migrated.is_set()
    c = sqlite3.connect(own)
    assert c.execute("SELECT COUNT(*) FROM re_trade_months").fetchone()[0] == 90
    assert c.execute("SELECT payload FROM re_trade_months WHERE deal_ym = '202605'").fetchone()[0] == "fresh"
    assert c.execute("SELECT COUNT(*) FROM re_map_cache").fetchone()[0] == 0
    assert c.execute("SELECT value FROM re_meta WHERE key = 'migrated_from_shared'").fetchone()
    # A second start sees it done and copies nothing.
    monkeypatch.setattr(st, "migrated", st._threading.Event())
    st._migrate_once()
    assert st.migrated.is_set()
