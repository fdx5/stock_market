"""Growth control room on a fresh temporary database (never an existing store)."""
from datetime import datetime, timedelta, timezone

from app.services import growth_control as gc
from app.services import page_view_store as pvs

BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"
DISGUISED = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.0 Safari/537.36"
GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"


def _use_temp_db(monkeypatch, tmp_path):
    monkeypatch.setattr(pvs, "TURSO_DATABASE_URL", "", raising=False)
    monkeypatch.setattr(pvs, "LOCAL_DB_PATH", tmp_path / "pv.db")
    monkeypatch.setattr(pvs, "_conn", None)
    gc.invalidate()


def _add(conn, session, path, when, ua=BROWSER, is_bot=0, channel=None, source=None, referrer=None,
         utm_source=None, utm_medium=None, event="page_view", device="mobile"):
    conn.execute(
        "INSERT INTO page_views (session_id, path, created_at, event_type, referrer, source_channel, source_name, "
        "utm_source, utm_medium, user_agent, is_bot, device_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (session, path, when.astimezone(timezone.utc).isoformat(), event, referrer, channel, source,
         utm_source, utm_medium, ua, is_bot, device))


def _seed_day(conn, day, people=10):
    noon = datetime.combine(day, datetime.min.time(), pvs.KST) + timedelta(hours=12)
    for i in range(people):
        s = f"p{day}{i}"
        _add(conn, s, "/", noon + timedelta(minutes=i))
        if i % 2:
            _add(conn, s, "/kospi", noon + timedelta(minutes=i, seconds=30))
    # Bluesky filed as referral by the client; the rollup reclassifies it.
    _add(conn, f"bsky{day}", "/movers", noon, channel="referral", source="bsky.app", referrer="https://bsky.app/profile/x")
    # Search visit.
    _add(conn, f"g{day}", "/stock/005930", noon, channel="search", source="google", referrer="https://www.google.com/")
    # A disguised crawler cohort: 15 sessions, each one deep page, no referrer.
    for i in range(15):
        _add(conn, f"c{day}{i}", f"/stock/{100000 + i:06d}", noon + timedelta(seconds=i), ua=DISGUISED, device="desktop")
    # A declared crawler.
    for i in range(5):
        _add(conn, f"b{day}{i}", f"/stock/{200000 + i:06d}", noon, ua=GOOGLEBOT, is_bot=1)


def test_compute_day_separates_people_automation_and_bots(monkeypatch, tmp_path):
    _use_temp_db(monkeypatch, tmp_path)
    day = (datetime.now(pvs.KST) - timedelta(days=1)).date()
    pvs._with_connection(lambda conn: (_seed_day(conn, day), conn.commit()))
    m = pvs._with_connection(lambda conn: gc.compute_day(conn, day.isoformat()))
    assert m["sessions"] == 12                      # 10 people + bluesky + google
    assert m["suspected"]["sessions"] == 15          # the cohort is out of the growth figures
    assert m["bots"]["sessions"] == 5
    assert m["bots"]["families"]["search"]["sessions"] == 5
    assert m["channels"]["social"]["sessions"] == 1  # bsky corrected from referral
    assert m["channels"]["search"]["sessions"] == 1
    assert m["corrected_sessions"] == 1
    assert m["bounces"] == 7                         # 5 single-page people + bsky + google


def test_rollup_is_insert_only_and_overview_reads_it(monkeypatch, tmp_path):
    _use_temp_db(monkeypatch, tmp_path)
    today = datetime.now(pvs.KST).date()

    def seed(conn):
        for k in range(1, 22):
            _seed_day(conn, today - timedelta(days=k), people=10 + k % 3)
        conn.commit()
    pvs._with_connection(seed)
    assert gc.ensure_rollups(days=21, max_new=50, pause=0) == 21
    assert gc.ensure_rollups(days=21, max_new=50, pause=0) == 0
    gc.add_goal_version(10, "recent_7d", None, None, 100, (today + timedelta(days=365)).isoformat(), None)
    gc.add_action((today - timedelta(days=8)).isoformat(), "sns", "Bluesky 카드 게시 시작", None, "social", None)
    data = gc.overview((today - timedelta(days=13)).isoformat(), today.isoformat())
    closed = [r for r in data["ledger"] if not r["live"]]
    assert all(r["verified"] for r in closed)
    assert all(r["suspected_sessions"] == 15 and r["bot_sessions"] == 5 for r in closed)
    assert data["goal"]["confirmed"] and data["kpis"]["multiplier"] > 1
    assert data["automation"]["families"][0]["family"] == "search"
    assert data["automation"]["suspected_agents"][0]["sessions"] >= 15
    assert data["trust"]["score"] >= 80
    assert data["actions"][0]["days_measured"] == 7
    assert data["insights"]
    rows = pvs._with_connection(lambda conn: conn.execute("SELECT COUNT(*) FROM growth_day_metrics").fetchone()[0])
    assert rows == 21


def test_channel_normalization():
    assert gc.normalize_channel("referral", "bsky.app", "", "", "bsky.app")[0] == "social"
    assert gc.normalize_channel("referral", "kospi-predictor.onrender.com", "", "", "kospi-predictor.onrender.com")[0] == "direct"
    assert gc.normalize_channel("referral", "", "", "", "m.search.naver.com") == ("search", "naver", True)
    assert gc.normalize_channel("direct", "", "naver_blog", "referral", "")[0] == "social"
    assert gc.normalize_channel("direct", "", "kakaotalk", "reminder", "")[0] == "email"
