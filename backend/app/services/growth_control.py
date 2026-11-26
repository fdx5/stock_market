"""방문자 100배 성장 관제실 — a trustworthy daily ledger of real growth, its drivers,
its data quality, and what to do next.

Why this exists next to page_view_store.growth_overview: that function reports what
the beacons recorded. This one reports how much of that is people, and why the number
moved:

* **Verified visits.** Declared crawlers were already excluded (is_bot). Crawlers that
  dress up as an ordinary browser were not — and they show up at the top of the
  rankings exactly the way the 2026-08 incident did: one agent string minting dozens
  of sessions that each open a single deep page with no referrer. Such cohorts are
  classified per day as *suspected automation* and reported beside the growth
  figures, never inside them. Both are shown, nothing is hidden.
* **Corrected channels.** The client's channel guess files Bluesky, Naver blogs and a
  few search engines under "referral", and the platform hostname under external
  links. The rollup re-derives the channel from the stored referrer / UTM fields.
* **Stable goal arithmetic.** The legacy baseline was the visitor count of a partial
  day; the multiplier was today's partial count. Here the multiplier is the trailing
  7-closed-day average over a goal version the operator confirms (append-only).

Storage is additive (services/growth_schema.py): per-day metric payloads are INSERT OR
IGNORE'd once per closed KST day, goal versions and action notes are append-only.
Nothing here updates or deletes a stored row.
"""
from __future__ import annotations

import json
import os
import logging
import math
import re
import statistics
import threading
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from app.services import bot_detector
from app.services import page_view_store as pvs
from app.services import traffic_taxonomy as tax

log = logging.getLogger(__name__)

KST = pvs.KST
# v2 (2026-11-26) adds the per-session inflow type bucket ("traffic", traffic_taxonomy) and
# files AI answers / mail apps correctly. v1 rows stay; the newest version of a day wins.
METRICS_VERSION = 2
BACKFILL_DAYS = 120
# Closed days recomputed under the newest version (older days keep their v1 payload).
# 0 by default: recomputing 20 days per pass held the page_views gate for minutes and
# starved request threads (502s on 2026-11-26 12:06). New days get v2 as they close.
REFRESH_DAYS = int(os.environ.get("GROWTH_REFRESH_DAYS", "0"))
MILESTONES = (2, 5, 10, 25, 50, 100)
CHANNELS = ("search", "social", "referral", "email", "direct")
CHANNEL_LABELS = {"search": "검색", "social": "소셜·커뮤니티", "referral": "외부 링크", "email": "메일·알림", "direct": "직접·미식별"}
ACTION_CATEGORIES = {"seo": "SEO·검색", "sns": "SNS·커뮤니티", "content": "콘텐츠", "feature": "기능 출시",
                     "ads": "광고·제휴", "notify": "알림·재방문", "fix": "오류 수정", "other": "기타"}

# Pages a person rarely opens as their very first page with no referrer, but a
# crawler walking the sitemap opens by the hundred.
_DEEP_LANDING_SQL = (
    "(path GLOB '/stock/*' OR path LIKE '/etf/%' OR path LIKE '/investor/%' OR path LIKE '/index/%' "
    "OR path LIKE '/market-brief/%' OR path LIKE '/realestate%/%')"
)
# A cohort (one agent string, one day) is suspected automation when it is big enough
# to matter and almost all of it looks like a sitemap walk.
COHORT_MIN_SESSIONS = 12
COHORT_WALK_SHARE = 0.8
COHORT_DISTINCT_SHARE = 0.6

_SELF_HOSTS = ("kospimap.com", "onrender.com", "localhost", "127.0.0.1")
_SEARCH_HOSTS = (("google.", "google"), ("googlequicksearchbox", "google"), ("search.naver", "naver"),
                 ("m.search.naver", "naver"), ("search.daum", "daum"), ("bing.", "bing"), ("duckduckgo", "duckduckgo"),
                 ("search.yahoo", "yahoo"), ("yahoo.co", "yahoo"), ("ecosia", "ecosia"), ("zum.com", "zum"),
                 ("search.nate", "nate"), ("baidu.", "baidu"), ("yandex.", "yandex"), ("perplexity.ai", "perplexity"),
                 ("chatgpt.com", "chatgpt"), ("copilot.microsoft", "copilot"))
_SOCIAL_HOSTS = (("bsky.app", "bluesky"), ("threads.", "threads"), ("x.com", "x"), ("t.co", "x"), ("twitter.", "x"),
                 ("facebook.", "facebook"), ("instagram.", "instagram"), ("youtube.", "youtube"), ("reddit.", "reddit"),
                 ("t.me", "telegram"), ("telegram.", "telegram"), ("band.us", "band"), ("kakao", "kakao"),
                 ("blog.naver", "naver_blog"), ("cafe.naver", "naver_cafe"), ("linkedin.", "linkedin"),
                 ("tistory.com", "tistory"), ("dcinside", "dcinside"), ("fmkorea", "fmkorea"), ("clien.net", "clien"),
                 ("ppomppu", "ppomppu"), ("theqoo", "theqoo"), ("ruliweb", "ruliweb"), ("discord", "discord"))
_SOCIAL_UTM = {"x", "twitter", "threads", "bluesky", "facebook", "instagram", "kakaotalk", "kakao", "telegram",
               "band", "naver_blog", "blog", "youtube", "reddit", "discord", "linkedin"}


# ---------------------------------------------------------------------------
# channel correction
# ---------------------------------------------------------------------------

def normalize_channel(channel: str, source: str, utm_source: str, utm_medium: str, host: str) -> tuple[str, str, bool]:
    """(channel, source label, corrected?) re-derived from what was stored."""
    channel = channel or "direct"
    host = (host or "").lower().removeprefix("www.").removeprefix("m.")
    usrc, umed = (utm_source or "").lower(), (utm_medium or "").lower()
    label = utm_source or source or host or "direct"
    out = channel
    kind, platform, _ = tax.classify(utm_source, utm_medium, "", host, channel, source)
    if kind == "email":
        out = "email"
    elif kind == "ai":
        out, label = "search", platform
    elif umed in ("social", "share") or usrc in _SOCIAL_UTM:
        out = "social"
    elif host and any(h in host for h in _SELF_HOSTS):
        out, label = "direct", "direct"
    elif host:
        hit = next((name for token, name in _SEARCH_HOSTS if token in host), None)
        if hit:
            out, label = "search", hit
        else:
            hit = next((name for token, name in _SOCIAL_HOSTS if token in host), None)
            if hit:
                out, label = "social", hit
            elif channel == "direct":
                out = "referral"
    return out, label, out != channel


def _host_sql(col: str = "ref") -> str:
    rest = f"CASE WHEN instr({col}, '//') > 0 THEN substr({col}, instr({col}, '//') + 2) ELSE {col} END"
    return f"lower(substr({rest}, 1, CASE WHEN instr({rest}, '/') > 0 THEN instr({rest}, '/') - 1 ELSE length({rest}) END))"


# ---------------------------------------------------------------------------
# one day of metrics
# ---------------------------------------------------------------------------

def _first_rows_cte(where: str) -> str:
    return (
        "WITH r AS (SELECT session_id, COALESCE(user_agent, '') ua, path, "
        f"{pvs._ROUTE_TEMPLATE_SQL} route, COALESCE(source_channel, 'direct') ch, COALESCE(source_name, '') sname, "
        "COALESCE(utm_source, '') usrc, COALESCE(utm_medium, '') umed, COALESCE(utm_campaign, '') ucamp, "
        "COALESCE(referrer, '') ref, COALESCE(device_type, 'unknown') dev, "
        "ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at, id) rn, "
        "COUNT(*) OVER (PARTITION BY session_id) n "
        f"FROM page_views WHERE {where}), f AS (SELECT * FROM r WHERE rn = 1) "
    )


def _suspected_agents(conn, where: str, params: tuple) -> tuple[list[str], list[dict]]:
    """Agent strings whose sessions this day look like a sitemap walk (see module doc)."""
    rows = conn.execute(
        _first_rows_cte(where) +
        "SELECT ua, COUNT(*), "
        f"SUM(CASE WHEN n = 1 AND ch = 'direct' AND {_DEEP_LANDING_SQL} THEN 1 ELSE 0 END), "
        "COUNT(DISTINCT route || path), SUM(n) FROM f GROUP BY ua",
        params,
    ).fetchall()
    flagged, detail = [], []
    for ua, sessions, walks, distinct_paths, pageviews in rows:
        sessions, walks = int(sessions or 0), int(walks or 0)
        signals = bot_detector.disguise_signals(ua)
        walk_share = walks / sessions if sessions else 0
        cohort = (sessions >= COHORT_MIN_SESSIONS and walk_share >= COHORT_WALK_SHARE
                  and (distinct_paths or 0) / sessions >= COHORT_DISTINCT_SHARE)
        # A disguise signal alone never reclassifies a person; it takes the signal
        # *and* a visit shape that is mostly walks.
        weak = bool(signals) and sessions >= 3 and walk_share >= 0.6
        if cohort or weak:
            flagged.append(ua)
            detail.append({"agent": bot_detector.short_agent(ua), "sessions": sessions, "pageviews": int(pageviews or 0),
                           "walk_share": round(walk_share, 3), "signals": (["sitemap_walk_cohort"] if cohort else []) + signals})
    detail.sort(key=lambda d: -d["sessions"])
    return flagged, detail[:20]


def compute_day(conn, day: str) -> dict:
    """Every metric of one KST day. Bounded to that day's rows."""
    start, end = pvs._kst_day_bounds(day)
    base = "created_at >= ? AND created_at < ?"
    human_pv = f"{base} AND event_type = 'page_view' AND {pvs.HUMAN}"
    params = (start, end)
    flagged, suspected_detail = _suspected_agents(conn, human_pv, params)
    sus_json = json.dumps(flagged)
    sus_sql = "(COALESCE(user_agent, '') IN (SELECT value FROM json_each(?)))"

    land = conn.execute(
        _first_rows_cte(human_pv) +
        "SELECT CASE WHEN ua IN (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END sus, route, ch, sname, usrc, umed, ucamp, "
        f"{_host_sql()} host, dev, COUNT(*), SUM(n), SUM(CASE WHEN n = 1 THEN 1 ELSE 0 END), "
        "SUM(CASE WHEN n >= 3 THEN 1 ELSE 0 END) FROM f GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9",
        (*params, sus_json),
    ).fetchall()
    hourly = conn.execute(
        "SELECT CAST(strftime('%H', created_at, '+9 hours') AS INTEGER), COUNT(*), COUNT(DISTINCT session_id) "
        f"FROM page_views WHERE {human_pv} AND NOT {sus_sql} GROUP BY 1",
        (*params, sus_json),
    ).fetchall()
    engaged = conn.execute(
        "SELECT COUNT(*), SUM(ev) FROM (SELECT session_id, SUM(event_type = 'page_view') pv, "
        "SUM(event_type <> 'page_view') ev FROM page_views "
        f"WHERE {base} AND {pvs.HUMAN} AND NOT {sus_sql} GROUP BY session_id) "
        "WHERE pv > 0 AND (pv >= 2 OR ev > 0)",
        (*params, sus_json),
    ).fetchone()
    bots = conn.execute(
        "SELECT user_agent, COUNT(*), COUNT(DISTINCT session_id) FROM page_views "
        f"WHERE {base} AND event_type = 'page_view' AND is_bot = 1 GROUP BY user_agent",
        params,
    ).fetchall()
    bot_pages = conn.execute(
        f"SELECT {pvs._ROUTE_TEMPLATE_SQL} route, COUNT(*) FROM page_views "
        f"WHERE {base} AND event_type = 'page_view' AND is_bot = 1 GROUP BY route ORDER BY 2 DESC LIMIT 12",
        params,
    ).fetchall()

    m = {"day": day, "version": METRICS_VERSION, "sessions": 0, "pageviews": 0, "bounces": 0, "deep_sessions": 0,
         "engaged_sessions": int((engaged[0] if engaged else 0) or 0), "events": int((engaged[1] if engaged else 0) or 0),
         "corrected_sessions": 0, "channels": {}, "sources": {}, "campaigns": {}, "landings": {}, "referrers": {},
         "traffic": {}, "traffic_landings": {},
         "devices": {}, "hourly": [[h, 0, 0] for h in range(24)],
         "suspected": {"sessions": 0, "pageviews": 0, "agents": suspected_detail, "landings": {}},
         "bots": {"sessions": 0, "pageviews": 0, "families": {}, "agents": {}, "pages": [[r, int(c)] for r, c in bot_pages]}}

    def bump(bucket: dict, key: str, sessions: int, pageviews: int, bounces: int, extra: dict | None = None):
        row = bucket.setdefault(key, {"sessions": 0, "pageviews": 0, "bounces": 0, **(extra or {})})
        row["sessions"] += sessions
        row["pageviews"] += pageviews
        row["bounces"] += bounces

    for sus, route, ch, sname, usrc, umed, ucamp, host, dev, sessions, pvs_, bounces, deep in land:
        sessions, pvs_, bounces, deep = int(sessions or 0), int(pvs_ or 0), int(bounces or 0), int(deep or 0)
        if sus:
            m["suspected"]["sessions"] += sessions
            m["suspected"]["pageviews"] += pvs_
            bump(m["suspected"]["landings"], route, sessions, pvs_, bounces)
            continue
        channel, label, corrected = normalize_channel(ch, sname, usrc, umed, host)
        m["sessions"] += sessions
        m["pageviews"] += pvs_
        m["bounces"] += bounces
        m["deep_sessions"] += deep
        if corrected:
            m["corrected_sessions"] += sessions
        bump(m["channels"], channel, sessions, pvs_, bounces)
        kind, platform, prog = tax.classify(usrc, umed, ucamp, host, ch, sname)
        bump(m["traffic"], f"{kind}|{platform}|{prog}", sessions, pvs_, bounces)
        if kind != "direct":
            bump(m["traffic_landings"], f"{kind}|{route}", sessions, pvs_, bounces)
        bump(m["sources"], f"{channel}|{label}", sessions, pvs_, bounces)
        bump(m["landings"], route, sessions, pvs_, bounces)
        bump(m["devices"], dev, sessions, pvs_, bounces)
        if usrc or ucamp:
            bump(m["campaigns"], f"{usrc or '-'}|{umed or '-'}|{ucamp or '(미지정)'}", sessions, pvs_, bounces)
        if host and channel in ("referral", "social", "search"):
            bump(m["referrers"], f"{channel}|{host}", sessions, pvs_, bounces)
    for hour, views, sessions in hourly:
        if hour is not None and 0 <= int(hour) < 24:
            m["hourly"][int(hour)] = [int(hour), int(views or 0), int(sessions or 0)]
    for ua, views, sessions in bots:
        fam = bot_detector.family(ua)
        bucket = m["bots"]["families"].setdefault(fam, {"sessions": 0, "pageviews": 0})
        bucket["sessions"] += int(sessions or 0)
        bucket["pageviews"] += int(views or 0)
        agent = m["bots"]["agents"].setdefault(bot_detector.short_agent(ua), {"family": fam, "sessions": 0, "pageviews": 0})
        agent["sessions"] += int(sessions or 0)
        agent["pageviews"] += int(views or 0)
        m["bots"]["sessions"] += int(sessions or 0)
        m["bots"]["pageviews"] += int(views or 0)

    def top(bucket: dict, n: int) -> dict:
        return dict(sorted(bucket.items(), key=lambda kv: -kv[1]["sessions"])[:n])

    m["sources"], m["landings"], m["campaigns"] = top(m["sources"], 40), top(m["landings"], 40), top(m["campaigns"], 40)
    m["referrers"] = top(m["referrers"], 30)
    m["traffic"], m["traffic_landings"] = top(m["traffic"], 120), top(m["traffic_landings"], 60)
    m["suspected"]["landings"] = top(m["suspected"]["landings"], 15)
    m["bots"]["agents"] = dict(sorted(m["bots"]["agents"].items(), key=lambda kv: -kv[1]["pageviews"])[:25])
    return m


# ---------------------------------------------------------------------------
# rollup storage (INSERT OR IGNORE only)
# ---------------------------------------------------------------------------

def _stored_days(conn, days: list[str]) -> dict[str, int]:
    """{day: newest stored version}."""
    if not days:
        return {}
    rows = conn.execute("SELECT day, MAX(version) FROM growth_day_metrics WHERE day >= ? AND day <= ? GROUP BY day",
                        (min(days), max(days))).fetchall()
    return {r[0]: int(r[1] or 0) for r in rows}


def ensure_rollups(days: int = BACKFILL_DAYS, max_new: int = 20, pause: float = 1.5) -> int:
    """Store the metrics of closed days not stored yet, newest first, `max_new` per call."""
    now = datetime.now(KST)
    today = now.date()
    candidates = [(today - timedelta(days=i)).isoformat() for i in range(1, days + 1)]
    # Leave the first minutes after midnight for queued beacons of the closed day.
    if now.hour == 0 and now.minute < 20:
        candidates = candidates[1:]
    have = pvs._with_connection(lambda conn: _stored_days(conn, candidates))
    # Recent days are owed the newest version; older ones only need to exist.
    missing = [d for i, d in enumerate(candidates)
               if (have.get(d, 0) < METRICS_VERSION if i < REFRESH_DAYS else d not in have)][:max_new]
    done = 0
    for day in missing:
        def write(conn, day=day):
            payload = compute_day(conn, day)
            conn.execute("INSERT OR IGNORE INTO growth_day_metrics (day, version, payload, computed_at) VALUES (?, ?, ?, ?)",
                         (day, METRICS_VERSION, json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                          datetime.now(timezone.utc).isoformat()))
            conn.commit()
        try:
            pvs._with_connection(write, wait=20.0)
            done += 1
        except Exception as exc:
            log.warning("growth rollup %s failed: %s", day, type(exc).__name__)
            break
        time.sleep(pause)
    return done


_rollup_started = False


def start_rollup_worker() -> None:
    """Backfills BACKFILL_DAYS once (20 days per pass), then keeps yesterday current."""
    global _rollup_started
    if _rollup_started:
        return
    _rollup_started = True

    def loop():
        time.sleep(90)
        while True:
            try:
                n = ensure_rollups()
                time.sleep(120 if n >= 20 else 1800)
            except Exception as exc:
                log.warning("growth rollup loop: %s", type(exc).__name__)
                time.sleep(1800)

    threading.Thread(target=loop, name="growth-rollup", daemon=True).start()


# ---------------------------------------------------------------------------
# reads
# ---------------------------------------------------------------------------

def _load_metrics(conn, start: str, end: str) -> dict[str, dict]:
    rows = conn.execute(
        "SELECT g.day, g.payload, g.computed_at FROM growth_day_metrics g JOIN (SELECT day, MAX(version) v "
        "FROM growth_day_metrics WHERE version <= ? AND day >= ? AND day <= ? GROUP BY day) n "
        "ON n.day = g.day AND n.v = g.version",
        (METRICS_VERSION, start, end)).fetchall()
    out = {}
    for day, payload, computed_at in rows:
        try:
            data = json.loads(payload)
            data["computed_at"] = computed_at
            out[day] = data
        except ValueError:
            continue
    return out


def _base_daily(conn, start: date, end: date, today: date) -> dict[str, dict]:
    rows = pvs._aggregated_daily_rows(conn, start, end + timedelta(days=1), today)
    return {r["date"]: r for r in rows}


def _goal(conn) -> dict:
    legacy = conn.execute(
        "SELECT started_at, baseline_daily_visitors, target_multiplier FROM traffic_growth_goal WHERE id = 1").fetchone()
    version = conn.execute(
        "SELECT id, created_at, baseline_daily, baseline_method, baseline_from, baseline_to, target_multiplier, target_date, note "
        "FROM growth_goal_versions ORDER BY id DESC LIMIT 1").fetchone()
    history = conn.execute(
        "SELECT id, created_at, baseline_daily, baseline_method, target_multiplier, target_date FROM growth_goal_versions "
        "ORDER BY id DESC LIMIT 10").fetchall()
    goal = {"legacy": {"started_at": legacy[0], "baseline": float(legacy[1]), "target_multiplier": int(legacy[2])} if legacy else None,
            "history": [dict(zip(("id", "created_at", "baseline", "method", "target_multiplier", "target_date"), r)) for r in history]}
    if version:
        goal.update(dict(zip(("id", "created_at", "baseline", "method", "baseline_from", "baseline_to",
                              "target_multiplier", "target_date", "note"), version)))
        goal["confirmed"] = True
    elif legacy:
        goal.update({"id": None, "created_at": legacy[0], "baseline": float(legacy[1]), "method": "legacy_partial_day",
                     "baseline_from": legacy[0][:10], "baseline_to": legacy[0][:10], "target_multiplier": int(legacy[2]),
                     "target_date": None, "note": None, "confirmed": False})
    else:
        goal.update({"id": None, "created_at": None, "baseline": None, "method": "none", "target_multiplier": 100,
                     "target_date": None, "confirmed": False})
    return goal


def add_goal_version(baseline: float, method: str, baseline_from: str | None, baseline_to: str | None,
                     target_multiplier: int, target_date: str | None, note: str | None) -> dict:
    def run(conn):
        conn.execute(
            "INSERT INTO growth_goal_versions (created_at, baseline_daily, baseline_method, baseline_from, baseline_to, "
            "target_multiplier, target_date, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (datetime.now(timezone.utc).isoformat(), float(baseline), method, baseline_from, baseline_to,
             int(target_multiplier), target_date, note))
        conn.commit()
        return _goal(conn)
    return pvs._with_connection(run)


def add_action(day: str, category: str, title: str, detail: str | None, focus_channel: str | None,
               focus_path: str | None) -> None:
    def run(conn):
        conn.execute(
            "INSERT INTO growth_actions (created_at, day, category, title, detail, focus_channel, focus_path) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (datetime.now(timezone.utc).isoformat(), day, category, title, detail, focus_channel, focus_path))
        conn.commit()
    pvs._with_connection(run)


def _actions(conn) -> list[dict]:
    rows = conn.execute("SELECT id, created_at, day, category, title, detail, focus_channel, focus_path "
                        "FROM growth_actions ORDER BY day DESC, id DESC LIMIT 200").fetchall()
    return [dict(zip(("id", "created_at", "day", "category", "title", "detail", "focus_channel", "focus_path"), r)) for r in rows]


def _audience_daily(start: str, end: str) -> dict[str, dict]:
    """Unique browsers / first-seen browsers per day from the pseudonymous audience store."""
    from app.services import audience_analytics as aa
    if not aa.ready():
        return {}
    try:
        with aa._gate.hold():
            rows = aa._connection().execute(
                "SELECT o.day, COUNT(DISTINCT o.browser), COUNT(DISTINCT CASE WHEN f.first_day = o.day THEN o.browser END) "
                "FROM audience_observations o JOIN (SELECT browser, MIN(day) first_day FROM audience_observations "
                "WHERE browser <> '' GROUP BY browser) f ON f.browser = o.browser "
                "WHERE o.browser <> '' AND o.day BETWEEN ? AND ? GROUP BY o.day", (start, end)).fetchall()
        return {d: {"browsers": int(b or 0), "new_browsers": int(n or 0)} for d, b, n in rows}
    except Exception as exc:
        log.warning("audience daily unavailable: %s", type(exc).__name__)
        return {}


def _today_metrics() -> dict:
    today = datetime.now(KST).date().isoformat()
    return pvs._with_connection(lambda conn: compute_day(conn, today))


def _last_event() -> str | None:
    since = (datetime.now(timezone.utc) - timedelta(hours=6)).isoformat()
    row = pvs._with_connection(lambda conn: conn.execute(
        f"SELECT MAX(created_at) FROM page_views WHERE created_at >= ? AND event_type = 'page_view' AND {pvs.HUMAN}",
        (since,)).fetchone())
    return row[0] if row else None


# ---------------------------------------------------------------------------
# analysis helpers
# ---------------------------------------------------------------------------

def _pct(a: float, b: float) -> float | None:
    return round((a - b) / b * 100, 1) if b else None


def _rate(part: float, whole: float) -> float | None:
    return round(part / whole * 100, 1) if whole else None


def _log_slope(values: list[float]) -> float | None:
    """Daily compound growth rate fitted to ln(values) (zero days skipped)."""
    points = [(i, math.log(v)) for i, v in enumerate(values) if v > 0]
    if len(points) < 7:
        return None
    n = len(points)
    mx = sum(p[0] for p in points) / n
    my = sum(p[1] for p in points) / n
    den = sum((p[0] - mx) ** 2 for p in points)
    if not den:
        return None
    slope = sum((p[0] - mx) * (p[1] - my) for p in points) / den
    return math.exp(slope) - 1


def _robust(values: list[float]) -> tuple[float, float]:
    med = statistics.median(values)
    mad = statistics.median([abs(v - med) for v in values]) or max(1.0, med * 0.05)
    return med, mad * 1.4826


def _merge(bucket_list: list[dict]) -> dict:
    out: dict[str, dict] = {}
    for bucket in bucket_list:
        for key, row in (bucket or {}).items():
            agg = out.setdefault(key, {k: 0 for k in row if isinstance(row[k], (int, float))} | {
                k: v for k, v in row.items() if not isinstance(v, (int, float))})
            for k, v in row.items():
                if isinstance(v, (int, float)):
                    agg[k] = agg.get(k, 0) + v
    return out


def _avg(rows: list[dict], key: str) -> float:
    vals = [r[key] for r in rows if r.get(key) is not None]
    return sum(vals) / len(vals) if vals else 0.0


# ---------------------------------------------------------------------------
# the control-room payload
# ---------------------------------------------------------------------------

def overview(start_day: str, end_day: str) -> dict:
    now = datetime.now(KST)
    today = now.date()
    start = date.fromisoformat(start_day)
    end = min(date.fromisoformat(end_day), today)
    lead = start - timedelta(days=35)  # history for moving averages / anomaly bands

    def read(conn):
        return (_base_daily(conn, lead, end, today), _load_metrics(conn, lead.isoformat(), end.isoformat()),
                _goal(conn), _actions(conn))
    base, metrics, goal, actions = pvs._with_connection(read)
    if end == today:
        try:
            metrics[today.isoformat()] = {**_today_metrics(), "computed_at": datetime.now(timezone.utc).isoformat(), "live": True}
        except Exception as exc:
            log.warning("growth today metrics: %s", type(exc).__name__)
    audience = _audience_daily(lead.isoformat(), end.isoformat())

    # ---- the ledger (lead days included for windows, trimmed at the end) ----
    days, d = [], lead
    while d <= end:
        days.append(d.isoformat())
        d += timedelta(days=1)
    ledger = []
    for day in days:
        b = base.get(day, {})
        m = metrics.get(day)
        verified = m is not None
        sessions = m["sessions"] if verified else int(b.get("visitors", 0) or 0)
        pageviews = m["pageviews"] if verified else int(b.get("pageviews", 0) or 0)
        if verified:
            ch = {c: m["channels"].get(c, {}).get("sessions", 0) for c in CHANNELS}
        else:
            ch = {c: int(b.get(c, 0) or 0) for c in CHANNELS}  # pageview-weighted legacy split
        a = audience.get(day, {})
        ledger.append({
            "date": day, "weekday": date.fromisoformat(day).weekday(), "live": day == today.isoformat(),
            "verified": verified, "sessions": sessions, "pageviews": pageviews,
            "raw_sessions": int(b.get("visitors", 0) or 0), "raw_pageviews": int(b.get("pageviews", 0) or 0),
            "suspected_sessions": m["suspected"]["sessions"] if verified else None,
            "bot_sessions": m["bots"]["sessions"] if verified else None,
            "bot_pageviews": m["bots"]["pageviews"] if verified else None,
            "browsers": a.get("browsers"), "new_browsers": a.get("new_browsers"),
            "channels": ch,
            "bounce_rate": _rate(m["bounces"], m["sessions"]) if verified else None,
            "engaged_rate": _rate(m["engaged_sessions"], m["sessions"]) if verified else None,
            "pages_per_session": round(pageviews / sessions, 2) if sessions else None,
            "corrected_sessions": m.get("corrected_sessions") if verified else None,
        })
    closed = [r for r in ledger if not r["live"]]
    by_date = {r["date"]: i for i, r in enumerate(ledger)}

    for i, r in enumerate(ledger):
        window = [x["sessions"] for x in ledger[max(0, i - 6): i + 1] if not x["live"]]
        r["ma7"] = round(sum(window) / len(window), 1) if len(window) >= 4 else None
        prev = ledger[i - 1]["sessions"] if i >= 1 else None
        r["dod"] = _pct(r["sessions"], prev) if prev and not r["live"] else None
        week = ledger[i - 7]["sessions"] if i >= 7 else None
        r["wow"] = _pct(r["sessions"], week) if week and not r["live"] else None
        # anomaly band: trailing 28 closed days
        hist = [x["sessions"] for x in ledger[max(0, i - 28): i] if not x["live"] and x["sessions"] > 0]
        flags = []
        if r["live"]:
            flags.append("live")
        if not r["verified"] and not r["live"]:
            flags.append("unverified")
        if r["sessions"] == 0 and not r["live"]:
            flags.append("zero")
        if len(hist) >= 10 and not r["live"]:
            med, sd = _robust(hist)
            z = (r["sessions"] - med) / sd if sd else 0
            r["z"] = round(z, 2)
            if z >= 3.5:
                flags.append("spike")
            elif z <= -3.5:
                flags.append("drop")
        if r["verified"] and r["sessions"] and (r["suspected_sessions"] or 0) / max(1, r["sessions"]) > 0.25:
            flags.append("automation_heavy")
        r["flags"] = flags

    baseline = goal.get("baseline") or None
    target_mult = int(goal.get("target_multiplier") or 100)
    for r in ledger:
        r["multiplier"] = round(r["ma7"] / baseline, 2) if baseline and r["ma7"] is not None else None

    # ---- headline KPIs ----
    last7 = closed[-7:]
    prev7 = closed[-14:-7]
    cur7 = _avg(last7, "sessions")
    pre7 = _avg(prev7, "sessions")
    tail28 = [r["sessions"] for r in closed[-28:]]
    cdgr = _log_slope(tail28)
    multiplier = cur7 / baseline if baseline else None
    target_daily = baseline * target_mult if baseline else None
    log_progress = (max(0.0, math.log(multiplier)) / math.log(target_mult) * 100) if multiplier and multiplier > 0 else None
    target_date = goal.get("target_date")
    days_left = (date.fromisoformat(target_date) - today).days if target_date else None
    required = ((target_daily / cur7) ** (1 / days_left) - 1) if target_daily and cur7 and days_left and days_left > 0 else None
    milestones = []
    for mult in MILESTONES:
        target = baseline * mult if baseline else None
        reached = next((r["date"] for r in closed if target and r["ma7"] and r["ma7"] >= target), None)
        eta = None
        if target and not reached and cur7 and cdgr and cdgr > 0:
            eta_days = math.ceil(math.log(target / cur7) / math.log(1 + cdgr))
            eta = (today + timedelta(days=eta_days)).isoformat() if eta_days < 3650 else None
        milestones.append({"multiplier": mult, "target": round(target, 1) if target else None, "reached": reached, "eta": eta})

    # today pace: share of a day's sessions usually done by this hour (last 14 verified closed days)
    today_row = ledger[-1] if ledger and ledger[-1]["live"] else None
    projection = None
    if today_row:
        shares = []
        for r in closed[-14:]:
            m = metrics.get(r["date"])
            if not m or not m["sessions"]:
                continue
            done = sum(h[1] for h in m["hourly"][: now.hour]) + m["hourly"][now.hour][1] * now.minute / 60
            total = sum(h[1] for h in m["hourly"]) or 1
            shares.append(done / total)
        if shares:
            share = statistics.median(shares)
            if share > 0.05:
                projection = {"share_done": round(share, 3), "projected_sessions": round(today_row["sessions"] / share),
                              "vs_ma7": _pct(today_row["sessions"] / share, cur7) if cur7 else None}

    # ---- range breakdowns (verified days in the selected range) ----
    in_range = [r for r in ledger if r["date"] >= start.isoformat()]
    mrows = [metrics[r["date"]] for r in in_range if r["date"] in metrics]
    channels = _merge([m["channels"] for m in mrows])
    sources = _merge([m["sources"] for m in mrows])
    landings = _merge([m["landings"] for m in mrows])
    campaigns = _merge([m["campaigns"] for m in mrows])
    referrers = _merge([m["referrers"] for m in mrows])
    devices = _merge([m["devices"] for m in mrows])
    sus_landings = _merge([m["suspected"]["landings"] for m in mrows])
    bot_fams = _merge([m["bots"]["families"] for m in mrows])
    bot_agents = _merge([m["bots"]["agents"] for m in mrows])
    bot_pages: dict[str, int] = defaultdict(int)
    sus_agents: dict[str, dict] = {}
    for m in mrows:
        for route, count in m["bots"]["pages"]:
            bot_pages[route] += count
        for a in m["suspected"]["agents"]:
            agg = sus_agents.setdefault(a["agent"], {"agent": a["agent"], "sessions": 0, "pageviews": 0, "days": 0, "signals": set()})
            agg["sessions"] += a["sessions"]
            agg["pageviews"] += a["pageviews"]
            agg["days"] += 1
            agg["signals"].update(a["signals"])
    heat = [[0.0] * 24 for _ in range(7)]
    heat_n = [0] * 7
    for r in in_range:
        m = metrics.get(r["date"])
        if not m or r["live"]:
            continue
        wd = r["weekday"]
        heat_n[wd] += 1
        for h, _views, sess in m["hourly"]:
            heat[wd][h] += sess
    heat = [[round(v / heat_n[wd], 1) if heat_n[wd] else 0 for v in row] for wd, row in enumerate(heat)]

    def ranked(bucket: dict, key_name: str, n: int, split: str | None = None):
        out = []
        for key, row in sorted(bucket.items(), key=lambda kv: -kv[1]["sessions"])[:n]:
            item = {key_name: key, "sessions": row["sessions"], "pageviews": row["pageviews"],
                    "bounce_rate": _rate(row["bounces"], row["sessions"]),
                    "pages_per_session": round(row["pageviews"] / row["sessions"], 2) if row["sessions"] else None}
            if split:
                parts = key.split("|")
                item.update(dict(zip(split.split(","), parts)))
            out.append(item)
        return out

    range_sessions = sum(r["sessions"] for r in in_range)
    verified_sessions = sum(m["sessions"] for m in mrows)

    # channel driver decomposition: last 7 closed vs previous 7 (verified only)
    def chan_avg(rows):
        vs = [r for r in rows if r["verified"]]
        return {c: (sum(r["channels"][c] for r in vs) / len(vs)) if vs else 0 for c in CHANNELS}, len(vs)
    cur_ch, ncur = chan_avg(last7)
    pre_ch, npre = chan_avg(prev7)
    drivers = [{"channel": c, "label": CHANNEL_LABELS[c], "current": round(cur_ch[c], 1), "previous": round(pre_ch[c], 1),
                "delta": round(cur_ch[c] - pre_ch[c], 1)} for c in CHANNELS] if ncur >= 4 and npre >= 4 else []

    # landing movers (last 7 vs prev 7)
    def land_sum(rows):
        return _merge([metrics[r["date"]]["landings"] for r in rows if r["date"] in metrics])
    lc, lp = land_sum(last7), land_sum(prev7)
    movers = sorted(({"route": k, "current": lc.get(k, {}).get("sessions", 0), "previous": lp.get(k, {}).get("sessions", 0)}
                     for k in set(lc) | set(lp)), key=lambda x: -abs(x["current"] - x["previous"]))[:12]
    for x in movers:
        x["delta"] = x["current"] - x["previous"]

    # ---- data trust ----
    closed_in_range = [r for r in in_range if not r["live"]]
    unverified = [r["date"] for r in closed_in_range if not r["verified"]]
    mismatch = []
    for r in closed_in_range:
        m = metrics.get(r["date"])
        if m:
            recorded = r["raw_sessions"]
            counted = m["sessions"] + m["suspected"]["sessions"]
            if recorded and abs(recorded - counted) / recorded > 0.02:
                mismatch.append({"date": r["date"], "daily_table": recorded, "rollup": counted})
    last_event = None
    try:
        last_event = _last_event()
    except Exception:
        pass
    lag_min = None
    if last_event:
        lag_min = round((datetime.now(timezone.utc) - datetime.fromisoformat(last_event)).total_seconds() / 60, 1)
    try:
        from app.services import activity_log
        drops = int(activity_log._drop_counts.get("page_view", 0))
        pending = activity_log._write_queues["page_view"].qsize()
    except Exception:
        drops, pending = None, None
    sus_total = sum(m["suspected"]["sessions"] for m in mrows)
    bot_total = sum(m["bots"]["sessions"] for m in mrows)
    corrected_total = sum(m.get("corrected_sessions", 0) for m in mrows)
    raw_total = sum(r["raw_sessions"] for r in in_range)
    checks = []

    def check(key, status, title, detail, penalty=0):
        checks.append({"key": key, "status": status, "title": title, "detail": detail, "penalty": penalty})
    cov = (len(closed_in_range) - len(unverified)) / len(closed_in_range) if closed_in_range else 1
    check("coverage", "good" if cov >= 0.98 else "warning" if cov >= 0.7 else "critical", "검증 집계 커버리지",
          f"마감일 {len(closed_in_range)}일 중 {len(closed_in_range) - len(unverified)}일이 검증 지표로 집계됨"
          + (f" · 미집계 {len(unverified)}일은 원시 일계(봇 의심 미분리)로 대체" if unverified else ""),
          round((1 - cov) * 25))
    if lag_min is None:
        check("tracking", "warning", "수집 신호", "최근 6시간 사람 방문 이벤트 없음 — 트래킹 비콘 확인 필요", 15)
    else:
        night = now.hour < 7
        status = "good" if lag_min <= 20 or (night and lag_min <= 120) else "warning" if lag_min <= 90 else "critical"
        check("tracking", status, "수집 신호", f"마지막 사람 방문 기록 {lag_min}분 전", 0 if status == "good" else 10)
    if drops is not None:
        check("queue", "good" if drops == 0 else "critical", "이벤트 유실",
              f"이번 서버 실행 이후 큐 초과로 버려진 방문 이벤트 {drops}건 · 대기 {pending}건", 0 if drops == 0 else 15)
    check("automation", "good" if sus_total <= verified_sessions * 0.05 else "warning", "위장 자동화 분리",
          f"기간 중 자동화 의심 세션 {sus_total:,}건을 성장 지표에서 제외 (검증 세션 {verified_sessions:,}건)", 0)
    check("bots", "info", "선언된 봇 분리", f"검색엔진·AI·미리보기 등 봇 세션 {bot_total:,}건 — 성장 지표에 포함되지 않음", 0)
    check("channels", "info", "채널 보정",
          f"리퍼러·UTM 재판정으로 {corrected_total:,}개 세션의 채널을 바로잡음 (Bluesky·네이버 블로그·자기 도메인 등)", 0)
    if mismatch:
        check("late", "warning", "집계 후 늦게 도착한 기록", f"{len(mismatch)}일에서 일계표와 롤업 세션 수가 2% 이상 다름", 5)
    if not goal.get("confirmed"):
        check("goal", "warning", "목표 기준선 미확정",
              "기존 기준선은 미션 시작 시점의 '진행 중이던 하루' 방문자 수라 낮게 잡혔을 수 있습니다. 기준선을 확정하세요.", 10)
    if not audience:
        check("browsers", "info", "고유 브라우저 지표", "가명 브라우저 집계가 비활성이라 세션(탭) 기준으로만 측정합니다", 0)
    else:
        ratio = (sum(r["sessions"] for r in last7) / max(1, sum((r["browsers"] or 0) for r in last7))) if last7 else None
        check("browsers", "info", "세션/브라우저 비율",
              f"최근 7일 세션 ÷ 고유 브라우저 = {ratio:.2f} — 탭마다 세션이 새로 생기므로 '사람 수'는 브라우저 지표가 더 가깝습니다" if ratio else "데이터 수집 중", 0)
    trust = max(0, 100 - sum(c["penalty"] for c in checks))

    # ---- actions with impact ----
    by_day = {r["date"]: r for r in ledger}
    action_rows = []
    for a in actions:
        d0 = date.fromisoformat(a["day"])
        before = [by_day[x.isoformat()] for x in (d0 - timedelta(days=k) for k in range(1, 8)) if x.isoformat() in by_day]
        after = [by_day[x.isoformat()] for x in (d0 + timedelta(days=k) for k in range(0, 7))
                 if x.isoformat() in by_day and not by_day[x.isoformat()]["live"]]
        row = {**a, "category_label": ACTION_CATEGORIES.get(a["category"], a["category"]),
               "days_measured": len(after), "before": round(_avg(before, "sessions"), 1) if before else None,
               "after": round(_avg(after, "sessions"), 1) if after else None}
        row["change_pct"] = _pct(row["after"], row["before"]) if row["before"] and row["after"] is not None else None
        fc = a.get("focus_channel")
        if fc in CHANNELS and before and after:
            row["focus_before"] = round(sum(r["channels"][fc] for r in before) / len(before), 1)
            row["focus_after"] = round(sum(r["channels"][fc] for r in after) / len(after), 1)
        action_rows.append(row)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(), "start": start.isoformat(), "end": end.isoformat(),
        "goal": goal,
        "kpis": {"ma7": round(cur7, 1), "ma7_prev": round(pre7, 1), "ma7_change_pct": _pct(cur7, pre7),
                 "multiplier": round(multiplier, 3) if multiplier else None, "target_daily": target_daily,
                 "linear_progress": round(min(100, cur7 / target_daily * 100), 2) if target_daily else None,
                 "log_progress": round(min(100, log_progress), 1) if log_progress is not None else None,
                 "cdgr": round(cdgr * 100, 2) if cdgr is not None else None,
                 "required_cdgr": round(required * 100, 2) if required is not None else None,
                 "days_left": days_left, "today": today_row, "projection": projection,
                 "range_sessions": range_sessions, "range_raw_sessions": raw_total,
                 "range_suspected": sus_total, "range_bot_sessions": bot_total,
                 "best_day": max(closed_in_range, key=lambda r: r["sessions"], default=None)},
        "milestones": milestones,
        "ledger": [r for r in ledger if r["date"] >= start.isoformat()],
        "history": [{"date": r["date"], "sessions": r["sessions"], "ma7": r["ma7"]} for r in ledger],
        "channels": [{"channel": c, "label": CHANNEL_LABELS[c], **ranked({c: channels[c]}, "channel", 1)[0]}
                     for c in CHANNELS if c in channels],
        "sources": ranked(sources, "key", 30, "channel,source"),
        "landings": ranked(landings, "route", 30),
        "campaigns": ranked(campaigns, "key", 30, "utm_source,utm_medium,utm_campaign"),
        "referrers": ranked(referrers, "key", 25, "channel,host"),
        "devices": ranked(devices, "device", 6),
        "heatmap": heat, "drivers": drivers, "landing_movers": movers,
        "automation": {
            "suspected_sessions": sus_total, "bot_sessions": bot_total,
            "bot_pageviews": sum(m["bots"]["pageviews"] for m in mrows),
            "families": sorted(({"family": k, "label": bot_detector.FAMILY_LABELS.get(k, k), **v} for k, v in bot_fams.items()),
                               key=lambda x: -x["pageviews"]),
            "agents": sorted(({"agent": k, "label": bot_detector.FAMILY_LABELS.get(v.get("family"), ""), **v}
                              for k, v in bot_agents.items()), key=lambda x: -x["pageviews"])[:20],
            "pages": [{"route": k, "pageviews": v} for k, v in sorted(bot_pages.items(), key=lambda kv: -kv[1])[:12]],
            "suspected_agents": sorted(({**v, "signals": sorted(v["signals"])} for v in sus_agents.values()),
                                       key=lambda x: -x["sessions"])[:15],
            "suspected_landings": ranked(sus_landings, "route", 12),
        },
        "trust": {"score": trust, "checks": checks, "unverified_days": unverified, "mismatch": mismatch[:20],
                  "last_event_at": last_event, "rollup_version": METRICS_VERSION, "backfill_days": BACKFILL_DAYS},
        "actions": action_rows,
        "action_categories": ACTION_CATEGORIES,
        "baseline_options": _baseline_options(ledger, goal),
    }
    payload["traffic"] = traffic_breakdown(in_range, metrics, last7, prev7)
    payload["insights"] = _insights(payload, last7, prev7) + _traffic_insights(payload["traffic"])
    order = {"critical": 0, "warning": 1, "good": 2, "info": 3}
    payload["insights"].sort(key=lambda x: order.get(x["severity"], 9))
    return payload


# ---------------------------------------------------------------------------
# inflow types (UTM + referrer taxonomy)
# ---------------------------------------------------------------------------

def _sum_into(bucket: dict, key: str, v: dict) -> None:
    agg = bucket.setdefault(key, {"sessions": 0, "pageviews": 0, "bounces": 0})
    for f in agg:
        agg[f] += v.get(f, 0)


def traffic_breakdown(in_range: list[dict], metrics: dict, last7: list[dict], prev7: list[dict]) -> dict:
    """Where sessions came from, by traffic_taxonomy type, over the selected range.

    Only days whose rollup carries the "traffic" bucket (v2+) are used; `coverage` says
    how many that is, so a share is never computed over a mix of old and new rules."""
    days = [r for r in in_range if "traffic" in metrics.get(r["date"], {})]

    def merged(rows_, key="traffic"):
        return _merge([metrics[r["date"]].get(key, {}) for r in rows_])

    rows = merged(days)
    types: dict[str, dict] = {}
    platforms: dict[str, dict] = {}
    programs: dict[str, dict] = {}
    for key, v in rows.items():
        kind, platform, prog = (key.split("|") + ["", ""])[:3]
        _sum_into(types, kind, v)
        _sum_into(platforms, f"{kind}|{platform}", v)
        if kind in tax.OWNED:
            _sum_into(programs, f"{kind}|{prog or '(태그 없음)'}", v)
    total = sum(v["sessions"] for v in types.values())
    direct = types.get("direct", {}).get("sessions", 0)
    known = total - direct

    def per_day(rows_):
        rows_ = [r for r in rows_ if "traffic" in metrics.get(r["date"], {})]
        out: dict[str, float] = defaultdict(float)
        for k, v in merged(rows_).items():
            out[k.split("|", 1)[0]] += v["sessions"]
        return {k: v / len(rows_) for k, v in out.items()} if rows_ else {}
    cur, pre = per_day(last7), per_day(prev7)

    def row(kind, v):
        return {"type": kind, "label": tax.TYPE_LABELS.get(kind, kind), "group": tax.group_of(kind),
                "sessions": v["sessions"], "pageviews": v["pageviews"], "share": _rate(v["sessions"], total),
                "share_known": _rate(v["sessions"], known) if kind != "direct" else None,
                "bounce_rate": _rate(v["bounces"], v["sessions"]),
                "pages_per_session": round(v["pageviews"] / v["sessions"], 2) if v["sessions"] else None,
                "per_day_7d": round(cur.get(kind, 0), 1), "per_day_prev_7d": round(pre.get(kind, 0), 1),
                "change_pct": _pct(cur.get(kind, 0), pre.get(kind, 0))}

    groups = []
    for g, kinds in tax.GROUPS.items():
        s = sum(types.get(k, {}).get("sessions", 0) for k in kinds)
        s_known = s - (direct if g == "other" else 0)
        groups.append({"group": g, "label": tax.GROUP_LABELS[g], "sessions": s, "share": _rate(s, total),
                       "share_known": _rate(s_known, known),
                       "per_day_7d": round(sum(cur.get(k, 0) for k in kinds if k != "direct"), 1),
                       "per_day_prev_7d": round(sum(pre.get(k, 0) for k in kinds if k != "direct"), 1)})

    def ranked_rows(bucket, fields, n, where=None):
        out = []
        for key, v in sorted(bucket.items(), key=lambda kv: -kv[1]["sessions"]):
            parts = dict(zip(fields, key.split("|")))
            if where and not where(parts):
                continue
            out.append({"key": key, **parts, "label": tax.TYPE_LABELS.get(parts.get("type"), parts.get("type")),
                        "sessions": v["sessions"], "pageviews": v["pageviews"],
                        "bounce_rate": _rate(v["bounces"], v["sessions"]),
                        "pages_per_session": round(v["pageviews"] / v["sessions"], 2) if v["sessions"] else None})
            if len(out) >= n:
                break
        return out

    # SNS links that reached us with a tag vs without one (in-app browsers drop the
    # referrer, so an untagged SNS visit often lands in 'direct' and is lost entirely).
    tagged = sum(types.get(k, {}).get("sessions", 0) for k in tax.OWNED)
    untagged = types.get("community", {}).get("sessions", 0)
    series = []
    for r in days:
        b: dict[str, int] = defaultdict(int)
        for k, v in metrics[r["date"]]["traffic"].items():
            b[k.split("|", 1)[0]] += v["sessions"]
        series.append({"date": r["date"], "live": r["live"], **{k: b.get(k, 0) for k in tax.TYPES}})
    return {
        "coverage": {"days": len(days), "range_days": len(in_range), "from": days[0]["date"] if days else None},
        "total": total, "known": known,
        "types": [row(k, types[k]) for k in tax.TYPES if k in types],
        "groups": groups,
        "platforms": ranked_rows(platforms, ("type", "platform"), 40),
        "programs": ranked_rows(programs, ("type", "program"), 40),
        "posts": ranked_rows(rows, ("type", "platform", "program"), 40, lambda p: p.get("type") in tax.OWNED),
        "search_engines": ranked_rows(platforms, ("type", "platform"), 12, lambda p: p.get("type") in ("search", "ai")),
        "landings": ranked_rows(merged(days, "traffic_landings"), ("type", "route"), 40),
        "tagging": {"tagged_sns": tagged, "untagged_sns": untagged, "tagged_share": _rate(tagged, tagged + untagged)},
        "series": series,
        "type_labels": tax.TYPE_LABELS, "group_labels": tax.GROUP_LABELS,
    }


def _traffic_insights(t: dict) -> list[dict]:
    out: list[dict] = []
    if not t["total"]:
        return out

    def add(severity, title, evidence, action):
        out.append({"severity": severity, "area": "유입 출처", "title": title, "evidence": evidence, "action": action})
    g = {x["group"]: x for x in t["groups"]}
    ty = {x["type"]: x for x in t["types"]}
    sns, search, ai = g["sns"], g["search"], g["ai"]
    add("info", f"출처를 아는 유입 중 SNS {sns['share_known'] or 0:.0f}% · 검색 {search['share_known'] or 0:.0f}%",
        f"SNS·블로그·커뮤니티 {sns['sessions']:,} · 검색 {search['sessions']:,} · AI {ai['sessions']:,} 세션 "
        f"(최근 7일 일평균 SNS {sns['per_day_7d']} / 검색 {search['per_day_7d']})",
        "7일 평균이 빠르게 오르는 쪽에 발행을 더 배치하세요. 직접·미식별은 비중 계산에서 뺐습니다.")
    tag = t["tagging"]
    if tag["tagged_sns"] + tag["untagged_sns"] >= 20 and (tag["tagged_share"] or 0) < 50:
        add("warning", f"SNS 유입의 {100 - (tag['tagged_share'] or 0):.0f}%가 UTM 없이 들어옴",
            f"태그 있음 {tag['tagged_sns']:,} · 태그 없음(리퍼러로만 식별) {tag['untagged_sns']:,} 세션",
            "직접 올리는 글·댓글·프로필 링크에도 utm_source=<플랫폼>&utm_medium=social&utm_campaign=<주제>-<YYYYMMDD>를 붙이세요. "
            "인앱 브라우저는 리퍼러를 지우므로 태그 없는 방문은 대부분 '직접'으로 사라집니다.")
    d = ty.get("direct")
    if d and (d["share"] or 0) > 80:
        add("warning", f"전체의 {d['share']:.0f}%가 출처 미식별(직접)", f"직접·미식별 {d['sessions']:,} 세션",
            "북마크·홈화면 재방문이면 정상입니다. 새 유입의 성과는 태그된 링크로만 측정되니 모든 외부 게시 링크에 UTM을 붙이세요.")
    posts = [p for p in t["posts"] if p.get("program") not in ("", "(태그 없음)")]
    if posts:
        best = posts[0]
        add("good", f"가장 많이 데려온 게시: {best['platform']} · {best['program']}",
            " · ".join(f"{p['platform']}/{p['program']} {p['sessions']:,}" for p in posts[:5]),
            "같은 형식(시간대·이미지·제목 틀)을 다른 플랫폼에도 적용해 비교하세요.")
    nb = ty.get("naver_blog")
    if nb:
        add("info", f"네이버 블로그 경유 최근 7일 일평균 {nb['per_day_7d']} 세션 (목표 37)",
            f"이전 7일 {nb['per_day_prev_7d']} → 최근 7일 {nb['per_day_7d']}",
            "운영·배치의 '네이버 블로그 성과' 패널에서 글·변형별로 확인하세요.")
    if ty.get("ai", {}).get("sessions", 0) >= 10:
        add("info", f"AI 답변 경유 {ty['ai']['sessions']:,} 세션", "ChatGPT·Perplexity 등이 인용한 링크로 들어온 방문",
            "AI가 인용하는 착지 페이지의 요약·표를 최신으로 유지하세요.")
    return out


def _baseline_options(ledger: list[dict], goal: dict) -> list[dict]:
    """Candidate baselines the operator can confirm as a goal version."""
    closed = [r for r in ledger if not r["live"] and r["sessions"] > 0]
    out = []
    started = (goal.get("legacy") or {}).get("started_at")
    if started:
        s = started[:10]
        before = [r for r in closed if r["date"] < s][-7:]
        after = [r for r in closed if r["date"] >= s][:7]
        if len(before) >= 5:
            out.append({"method": "pre_mission_7d", "label": "미션 시작 직전 7일 평균", "from": before[0]["date"],
                        "to": before[-1]["date"], "value": round(_avg(before, "sessions"), 1)})
        if len(after) >= 5:
            out.append({"method": "first_week_7d", "label": "미션 첫 7일 평균", "from": after[0]["date"],
                        "to": after[-1]["date"], "value": round(_avg(after, "sessions"), 1)})
    if len(closed) >= 7:
        last = closed[-7:]
        out.append({"method": "recent_7d", "label": "최근 7일 평균(지금부터 재출발)", "from": last[0]["date"],
                    "to": last[-1]["date"], "value": round(_avg(last, "sessions"), 1)})
    return out


def _insights(p: dict, last7: list[dict], prev7: list[dict]) -> list[dict]:
    """Rule-based findings, each with the evidence and the next action."""
    out = []

    def add(severity, area, title, evidence, action):
        out.append({"severity": severity, "area": area, "title": title, "evidence": evidence, "action": action})

    k = p["kpis"]
    if k["cdgr"] is not None:
        if k["required_cdgr"] is not None:
            if k["cdgr"] < k["required_cdgr"]:
                add("critical", "목표", "목표일까지 100배 도달 속도 부족",
                    f"필요 일 성장률 {k['required_cdgr']:.2f}% vs 최근 28일 실제 {k['cdgr']:.2f}%",
                    "가장 큰 성장 레버(아래 채널 기여도 1위)에 실행을 집중하고, 매 조치를 '조치·실험'에 기록해 효과를 검증하세요.")
            else:
                add("good", "목표", "목표 속도 이상으로 성장 중",
                    f"실제 {k['cdgr']:.2f}%/일 ≥ 필요 {k['required_cdgr']:.2f}%/일", "현재 실행 중인 조치를 유지·확대하세요.")
        elif k["cdgr"] <= 0:
            add("critical", "목표", "최근 28일 추세가 성장하지 않음", f"일 복리 성장률 {k['cdgr']:.2f}%",
                "목표일을 정해 필요 속도를 계산하고, 신규 유입 채널(검색·SNS) 실험을 우선 배치하세요.")
        else:
            add("info", "목표", "목표일 미설정", f"최근 28일 일 복리 성장률 {k['cdgr']:.2f}%",
                "목표 설정에서 100배 달성 목표일을 지정하면 필요 성장률과 격차를 매일 추적합니다.")
    ch = {c["channel"]: c for c in p["channels"]}
    total = sum(c["sessions"] for c in p["channels"]) or 0
    if total:
        direct = ch.get("direct", {}).get("sessions", 0) / total
        if direct > 0.6:
            add("warning", "측정", "출처를 알 수 없는 유입 비중이 큼", f"직접·미식별 {direct * 100:.0f}%",
                "SNS·블로그·카카오 공유·메일 링크 전부에 utm_source/utm_medium/utm_campaign을 붙이세요. 인앱 브라우저는 리퍼러를 지우므로 UTM만 남습니다.")
        search = ch.get("search", {}).get("sessions", 0) / total
        if search < 0.15:
            add("warning", "검색", "검색 유입 비중이 낮음", f"검색 {search * 100:.1f}%",
                "종목·지수 랜딩의 제목/설명 개선, 네이버 서치어드바이저·구글 서치콘솔 사이트맵 제출 상태를 점검하세요.")
        engines = {s["source"]: s["sessions"] for s in p["sources"] if s.get("channel") == "search"}
        if engines:
            g, n = engines.get("google", 0), engines.get("naver", 0)
            if g > 3 * max(1, n):
                add("info", "검색", "네이버 검색 유입이 구글 대비 매우 적음", f"google {g:,} vs naver {n:,} 세션",
                    "국내 투자자 비중을 고려하면 네이버 웹문서·블로그 노출 강화가 가장 큰 미개척 채널입니다.")
    for land in p["landings"][:8]:
        if land["sessions"] >= max(30, total * 0.05) and (land["bounce_rate"] or 0) >= 75:
            add("warning", "콘텐츠", f"{land['route']} 첫 페이지 이탈률 {land['bounce_rate']:.0f}%",
                f"이 페이지로 들어온 {land['sessions']:,}세션 중 대부분이 한 페이지만 보고 떠남",
                "첫 화면에 관련 종목·지수·핫이슈로 이어지는 링크와 다음 행동(검색, 관심 등록)을 배치하세요.")
            break
    if p["drivers"]:
        top = max(p["drivers"], key=lambda d: abs(d["delta"]))
        total_delta = sum(d["delta"] for d in p["drivers"])
        add("good" if total_delta >= 0 else "warning", "추세",
            f"지난주 대비 일평균 {total_delta:+.0f}세션 — 가장 큰 변화는 {top['label']}",
            " · ".join(f"{d['label']} {d['delta']:+.0f}" for d in p["drivers"]),
            "증가 채널은 같은 형식의 실행을 반복하고, 감소 채널은 해당 날짜의 조치·장애를 확인하세요.")
    social = [s for s in p["sources"] if s.get("channel") == "social"]
    if social:
        best = social[0]
        add("info", "SNS", f"소셜 유입 1위: {best['source']}",
            " · ".join(f"{s['source']} {s['sessions']:,}" for s in social[:5]),
            "성과 1위 네트워크의 게시 형식(이미지 카드·시간대)을 다른 네트워크에도 적용해 비교하세요.")
    devices = {d["device"]: d for d in p["devices"]}
    mob, desk = devices.get("mobile"), devices.get("desktop")
    if mob and desk and mob["bounce_rate"] is not None and desk["bounce_rate"] is not None \
            and mob["bounce_rate"] - desk["bounce_rate"] >= 12 and mob["sessions"] >= 50:
        add("warning", "UX", "모바일 이탈률이 데스크톱보다 높음",
            f"모바일 {mob['bounce_rate']:.0f}% vs 데스크톱 {desk['bounce_rate']:.0f}%",
            "모바일 첫 화면 로딩 속도와 가려지는 요소를 점검하세요(3D·대형 차트 지연 로딩).")
    returning = [r for r in last7 if r.get("browsers")]
    if returning:
        b = sum(r["browsers"] for r in returning)
        nb = sum(r["new_browsers"] or 0 for r in returning)
        if b:
            ret = (b - nb) / b
            add("warning" if ret < 0.25 else "info", "재방문", f"재방문 브라우저 비중 {ret * 100:.0f}%",
                f"최근 7일 고유 브라우저 {b:,} 중 신규 {nb:,}",
                "100배 성장은 재방문이 쌓여야 가능합니다 — 장전·장마감 알림, 관심종목, 정기 콘텐츠(07시 핫이슈) 동선을 강화하세요.")
    heat = p["heatmap"]
    if any(any(row) for row in heat):
        hourly = [sum(heat[wd][h] for wd in range(7)) for h in range(24)]
        peaks = sorted(range(24), key=lambda h: -hourly[h])[:3]
        add("info", "타이밍", "방문 피크 시간대", " · ".join(f"{h:02d}시" for h in sorted(peaks)),
            "SNS·블로그 발행을 피크 30~60분 전에 맞추면 노출 대비 유입이 커집니다.")
    auto = p["automation"]
    if auto["suspected_sessions"]:
        add("info", "신뢰도", "위장 자동화 트래픽을 성장 지표에서 제외",
            f"자동화 의심 {auto['suspected_sessions']:,}세션 · 선언된 봇 {auto['bot_sessions']:,}세션",
            "'봇·자동화' 탭에서 에이전트와 착지 페이지를 확인하세요. 성장 수치에는 포함되지 않습니다.")
    anomalies = [r for r in p["ledger"] if "spike" in r["flags"] or "drop" in r["flags"]]
    if anomalies:
        r = anomalies[-1]
        add("warning", "이상치", f"{r['date']} 방문 {'급증' if 'spike' in r['flags'] else '급감'}",
            f"{r['sessions']:,}세션 (최근 28일 중앙값 대비 z={r.get('z')})",
            "해당 날짜의 채널·착지 페이지를 일별 원장에서 확인하고, 원인이 된 조치나 장애를 기록하세요.")
    order = {"critical": 0, "warning": 1, "good": 2, "info": 3}
    out.sort(key=lambda x: order.get(x["severity"], 9))
    return out


# ---------------------------------------------------------------------------
# in-process response cache (cleared when the operator writes a goal/action)
# ---------------------------------------------------------------------------

_CACHE_SECONDS = 120.0
_cache: dict[tuple[str, str], tuple[float, dict]] = {}
_cache_lock = threading.Lock()


def cached_overview(start: str, end: str) -> dict:
    key = (start, end)
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
    value = overview(start, end)
    with _cache_lock:
        if len(_cache) > 32:
            _cache.clear()
        _cache[key] = (now + _CACHE_SECONDS, value)
    return value


def invalidate() -> None:
    with _cache_lock:
        _cache.clear()
