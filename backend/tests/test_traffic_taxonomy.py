"""UTM + referrer inflow types, and the growth rollup's traffic bucket (fresh temp DB only)."""
from datetime import datetime, timedelta, timezone

from app.services import growth_control as gc
from app.services import naver_social_content as content
from app.services import page_view_store as pvs
from app.services import traffic_taxonomy as tax


def test_every_automated_edition_counts_as_automated():
    assert set(content.EDITIONS) <= tax.AUTO_PROGRAMS


def test_classify_tagged_links():
    c = tax.classify
    assert c("threads", "social", "movers_close-20261125") == ("sns_auto", "threads", "movers_close")
    assert c("twitter", "social", "close-20261126") == ("sns_auto", "x", "close")
    assert c("threads", "social", "flow_20261113") == ("sns_tagged", "threads", "flow")
    assert c("naver_blog", "blog", "nb_close-20261126") == ("naver_blog", "naver_blog", "close")
    assert c("naver_blog", "referral", "nb_brief_kospi-20261126") == ("naver_blog", "naver_blog", "brief_kospi")
    assert c("kakaotalk", "social", "realestate_3d")[0] == "share"
    assert c("link_copy", "share", "free_distribution")[0] == "share"
    assert c("chatgpt.com") == ("ai", "chatgpt", "")
    assert c("market_widget", "referral", "free_distribution")[0] == "referral"
    assert c("calendar", "reminder", "weekday_check")[0] == "email"


def test_classify_untagged_referrers():
    c = tax.classify
    assert c(host="m.search.naver.com") == ("search", "naver", "")
    assert c(host="www.bing.com")[:2] == ("search", "bing")
    assert c(host="com.google.android.googlequicksearchbox")[:2] == ("search", "google")
    assert c(host="com.google.android.gm")[:2] == ("email", "gmail")
    assert c(host="l.threads.com")[:2] == ("community", "threads")
    assert c(host="s.ppomppu.co.kr")[:2] == ("community", "ppomppu")
    assert c(host="blog.naver.com")[0] == "naver_blog"
    assert c(host="kospimap.com")[0] == "direct"
    assert c()[0] == "direct"
    assert tax.group_of("naver_blog") == "sns" and tax.group_of("search") == "search"


def _add(conn, session, path, when, referrer=None, utm=(None, None, None)):
    conn.execute(
        "INSERT INTO page_views (session_id, path, created_at, event_type, referrer, utm_source, utm_medium, utm_campaign, "
        "user_agent, is_bot, device_type) VALUES (?, ?, ?, 'page_view', ?, ?, ?, ?, ?, 0, 'mobile')",
        (session, path, when.astimezone(timezone.utc).isoformat(), referrer, *utm,
         "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"))


def test_rollup_traffic_bucket_and_breakdown(monkeypatch, tmp_path):
    monkeypatch.setattr(pvs, "TURSO_DATABASE_URL", "", raising=False)
    monkeypatch.setattr(pvs, "LOCAL_DB_PATH", tmp_path / "pv.db")
    monkeypatch.setattr(pvs, "_conn", None)
    gc.invalidate()
    day = (datetime.now(pvs.KST) - timedelta(days=1)).date()
    noon = datetime.combine(day, datetime.min.time(), pvs.KST) + timedelta(hours=12)

    def seed(conn):
        _add(conn, "a", "/movers", noon, utm=("threads", "social", f"movers_close-{day:%Y%m%d}"))
        _add(conn, "a", "/map", noon + timedelta(seconds=20))
        _add(conn, "b", "/map", noon, utm=("naver_blog", "blog", f"nb_close-{day:%Y%m%d}"))
        _add(conn, "c", "/", noon, referrer="https://m.search.naver.com/search.naver?q=x")
        _add(conn, "d", "/", noon, referrer="https://www.google.com/")
        _add(conn, "e", "/kospi", noon, utm=("chatgpt.com", None, None))
        _add(conn, "f", "/", noon)
        conn.commit()
    pvs._with_connection(seed)
    m = pvs._with_connection(lambda conn: gc.compute_day(conn, day.isoformat()))
    assert m["traffic"]["sns_auto|threads|movers_close"]["sessions"] == 1
    assert m["traffic"]["naver_blog|naver_blog|close"]["sessions"] == 1
    assert m["traffic"]["search|naver|"]["sessions"] == 1
    assert m["traffic"]["ai|chatgpt|"]["sessions"] == 1
    assert m["channels"]["search"]["sessions"] == 3          # naver + google + chatgpt (AI filed under search)
    assert m["traffic_landings"]["sns_auto|/movers"]["sessions"] == 1

    assert gc.ensure_rollups(days=3, max_new=5, pause=0) >= 1
    data = gc.overview((day - timedelta(days=6)).isoformat(), day.isoformat())
    t = data["traffic"]
    assert t["coverage"]["days"] >= 1 and t["known"] == 5 and t["total"] == 6
    groups = {g["group"]: g for g in t["groups"]}
    assert groups["sns"]["sessions"] == 2 and groups["search"]["sessions"] == 2 and groups["ai"]["sessions"] == 1
    assert groups["sns"]["share_known"] == 40.0
    assert {p["program"] for p in t["posts"]} == {"movers_close", "close"}
    assert any(i["area"] == "유입 출처" for i in data["insights"])
    # The rollup row is a new version row; nothing older is touched.
    versions = pvs._with_connection(lambda conn: conn.execute(
        "SELECT DISTINCT version FROM growth_day_metrics").fetchall())
    assert {v[0] for v in versions} == {gc.METRICS_VERSION}
