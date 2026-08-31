"""Crawler traffic must not reach the visitor numbers, and must still be countable.

These cover the seam that let it through in the first place: analytics reported from
the browser, where a JS-rendering crawler is indistinguishable from a person unless
something reads the User-Agent.
"""

from __future__ import annotations

import importlib
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import bot_detector  # noqa: E402

GOOGLEBOT = (
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 "
    "(compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
)
CHROME = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)
IPHONE_SAFARI = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
)


class TestBotDetector:
    @pytest.mark.parametrize(
        "agent",
        [
            GOOGLEBOT,
            "Mozilla/5.0 (compatible; Yeti/1.1; +http://naver.me/spd)",
            "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
            "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1",
            "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
            "facebookexternalhit/1.1",
            "curl/8.4.0",
            "python-requests/2.31.0",
            "",
            None,
        ],
    )
    def test_flags_non_humans(self, agent):
        assert bot_detector.is_bot(agent) is True

    @pytest.mark.parametrize("agent", [CHROME, IPHONE_SAFARI])
    def test_leaves_real_browsers_alone(self, agent):
        assert bot_detector.is_bot(agent) is False

    def test_daum_app_browser_is_not_the_daum_crawler(self):
        """A bare "daum" token would file the Daum in-app browser's readers as bots."""
        assert bot_detector.is_bot("Mozilla/5.0 (Linux; Android 14) daumapps/9.0") is False
        assert bot_detector.is_bot("Mozilla/5.0 (compatible; Daumoa/4.0)") is True

    def test_user_agent_is_truncated_not_rejected(self):
        stored = bot_detector.normalize_user_agent("x" * 500)
        assert len(stored) == bot_detector.MAX_USER_AGENT_LEN
        assert bot_detector.normalize_user_agent("  ") is None


@pytest.fixture()
def store(tmp_path, monkeypatch):
    """page_view_store bound to a throwaway SQLite file rather than Turso."""
    monkeypatch.delenv("TURSO_DATABASE_URL", raising=False)
    monkeypatch.delenv("TURSO_AUTH_TOKEN", raising=False)
    module = importlib.import_module("app.services.page_view_store")
    module = importlib.reload(module)
    monkeypatch.setattr(module, "TURSO_DATABASE_URL", None)
    monkeypatch.setattr(module, "LOCAL_DB_PATH", tmp_path / "page_views.db")
    monkeypatch.setattr(module, "_conn", None)
    yield module
    if module._conn is not None:
        module._conn.close()


def _record(store, session_id, path, created_at, *, is_bot=False, user_agent=None, event_type="page_view"):
    store.record_page_view(
        session_id, path, created_at, event_type, None, "direct", "direct",
        None, None, None, None, None, None, None, user_agent, is_bot,
    )


class TestAdminReadsExcludeBots:
    def test_counts_and_trends_report_people_only(self, store):
        _record(store, "human-1", "/stock/005930", "2026-08-22T12:00:00+00:00", user_agent=CHROME)
        for i in range(5):
            _record(store, f"crawl-{i}", f"/stock/00000{i}", "2026-08-22T12:0%d:00+00:00" % i,
                    is_bot=True, user_agent=GOOGLEBOT)

        since = "2026-08-22T00:00:00+00:00"
        assert store.count_today(since) == 1
        assert store.counts_by_page(since) == [{"path": "/stock/005930", "count": 1}]
        assert [p["count"] for p in store.unique_visitors_by_bucket(since, "day")] == [1]
        assert sum(p["count"] for p in store.counts_by_bucket(since, "day")) == 1

    def test_growth_overview_visitors_exclude_the_crawl(self, store):
        _record(store, "human-1", "/desk", "2026-08-22T01:00:00+00:00", user_agent=CHROME)
        _record(store, "human-2", "/desk", "2026-08-22T02:00:00+00:00", user_agent=CHROME)
        for i in range(40):
            _record(store, f"crawl-{i}", f"/investor/00000{i % 10}", "2026-08-22T03:00:00+00:00",
                    is_bot=True, user_agent=GOOGLEBOT)

        # Closed days are materialized by maintenance; dashboard reads never scan raw
        # historical page_views themselves.
        store.aggregate_closed_days()
        data = store.growth_overview("2026-08-22T00:00:00+00:00")
        day = next(row for row in data["daily"] if row["date"] == "2026-08-22")
        assert day["visitors"] == 2
        assert day["pageviews"] == 2
        assert sum(channel["pageviews"] for channel in data["channels"]) == 2

    def test_migrating_an_existing_table_keeps_its_rows_and_drops_the_daily_cache(
        self, tmp_path, monkeypatch
    ):
        """The production table already holds ~95k rows and a cache of closed-day totals.

        Both matter on upgrade: the rows must survive and keep counting as people (no
        User-Agent was ever recorded for them, so nothing justifies discarding them),
        while the cache must not, because it was computed when bots still counted and
        is never otherwise recomputed.
        """
        db = tmp_path / "legacy.db"
        legacy = sqlite3.connect(db)
        legacy.execute(
            "CREATE TABLE page_views (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, "
            "path TEXT NOT NULL, created_at TEXT NOT NULL, event_type TEXT NOT NULL DEFAULT 'page_view')"
        )
        legacy.execute(
            "INSERT INTO page_views (session_id, path, created_at) VALUES ('old', '/desk', '2026-08-22T01:00:00+00:00')"
        )
        legacy.execute(
            "CREATE TABLE page_views_daily (day TEXT PRIMARY KEY, pageviews INTEGER NOT NULL, "
            "visitors INTEGER NOT NULL, search INTEGER NOT NULL, email INTEGER NOT NULL, "
            "social INTEGER NOT NULL, referral INTEGER NOT NULL, direct INTEGER NOT NULL, computed_at TEXT NOT NULL)"
        )
        legacy.execute(
            "INSERT INTO page_views_daily VALUES ('2026-08-22', 9999, 9999, 0, 0, 0, 0, 9999, 'x')"
        )
        legacy.commit()
        legacy.close()

        module = importlib.reload(importlib.import_module("app.services.page_view_store"))
        monkeypatch.setattr(module, "TURSO_DATABASE_URL", None)
        monkeypatch.setattr(module, "LOCAL_DB_PATH", db)
        monkeypatch.setattr(module, "_conn", None)

        assert module.count_today("2026-08-22T00:00:00+00:00") == 1
        assert module._with_connection(
            lambda conn: conn.execute("SELECT COUNT(*) FROM page_views_daily").fetchone()[0]
        ) == 0
        module._conn.close()

    def test_bot_overview_reports_what_was_excluded(self, store):
        _record(store, "human-1", "/desk", "2026-08-22T01:00:00+00:00", user_agent=CHROME)
        for i in range(3):
            _record(store, f"crawl-{i}", "/stock/005930", "2026-08-22T02:00:00+00:00",
                    is_bot=True, user_agent=GOOGLEBOT)

        overview = store.bot_overview("2026-08-22T00:00:00+00:00")
        assert overview["pageviews"] == 3
        assert overview["sessions"] == 3
        assert overview["agents"][0]["user_agent"] == GOOGLEBOT
        assert overview["agents"][0]["pageviews"] == 3


class TestVisitorTracker:
    def test_a_crawler_heartbeat_registers_no_session(self, monkeypatch):
        from app.services import visitor_tracker

        recorded: list[str] = []
        monkeypatch.setattr(visitor_tracker.visitor_store, "heartbeat_and_counts",
                            lambda session_id, seen_at, active_since, register_session=True:
                            (1, recorded.append(session_id) or len(recorded)))
        monkeypatch.setattr(visitor_tracker.visitor_store, "active_count", lambda active_since: 1)
        monkeypatch.setattr(visitor_tracker.visitor_store, "total_count", lambda: len(recorded))
        tracker = visitor_tracker.VisitorTracker()

        current, total = tracker.heartbeat("11111111-1111-1111-1111-111111111111", "1.2.3.4")
        assert (current, total) == (1, 1)
        assert recorded == ["11111111-1111-1111-1111-111111111111"]

        # A crawl of 50 URLs = 50 fresh session ids, which is exactly what the per-IP
        # throttle was never able to catch.
        for i in range(50):
            current, total = tracker.heartbeat(f"22222222-2222-2222-2222-{i:012d}", f"66.249.66.{i}", is_bot=True)
        assert total == 1
        assert current == 1
        assert len(recorded) == 1


class TestActivityLog:
    def test_a_crawler_never_enters_the_live_panel(self, monkeypatch):
        from app.services import activity_log

        persisted: list[tuple] = []
        monkeypatch.setattr(activity_log.threading, "Thread",
                            lambda target, args, daemon: type("T", (), {"start": lambda self: persisted.append(args)})())
        activity_log._tail.clear()
        activity_log._sessions.clear()

        activity_log.record_event("human", "page_view", "/desk", user_agent=CHROME, is_bot=False)
        activity_log.record_event("crawler", "page_view", "/stock/005930", user_agent=GOOGLEBOT, is_bot=True)

        assert [event["session_id"] for event in activity_log.recent_events()] == ["human"]
        assert [session["session_id"] for session in activity_log.active_sessions()] == ["human"]
        # Both are still persisted - the crawler row carrying its agent and flag.
        assert len(persisted) == 2
        assert persisted[1][-2:] == (GOOGLEBOT, True)

    def test_crawler_hub_and_search_events_are_dropped_entirely(self, monkeypatch):
        from app.services import activity_log

        persisted: list[tuple] = []
        monkeypatch.setattr(activity_log.threading, "Thread",
                            lambda target, args, daemon: type("T", (), {"start": lambda self: persisted.append(args)})())
        activity_log._tail.clear()
        activity_log._sessions.clear()

        activity_log.record_event("crawler", "hub", "/", action="dwell", value=12.0, is_bot=True)
        activity_log.record_event("crawler", "stock_view", "/desk", stock_code="005930",
                                  stock_name="삼성전자", is_bot=True)
        assert persisted == []


class TestSitemapCodes:
    def test_preferred_share_codes_are_dropped_not_mangled(self):
        from app.services import seo

        xml = seo.build_sitemap([
            {"code": "005930", "name": "삼성전자"},
            # KRX 신형우선주. Stripping the letter produced "/stock/00680", which is
            # neither this stock nor any routable page - 200 with the generic shell.
            {"code": "00680K", "name": "LS 3우B"},
        ])
        assert "/stock/005930<" in xml
        assert "/investor/005930<" in xml
        assert "00680" not in xml

    def test_rss_applies_the_same_rule(self):
        from app.services import seo

        xml = seo.build_rss([
            {"code": "005930", "name": "삼성전자"},
            {"code": "00680K", "name": "LS 3우B"},
        ])
        assert "005930" in xml
        assert "00680" not in xml
