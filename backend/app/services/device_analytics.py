"""Device analytics: closed KST days are materialized off the request path.

Units are human page views, not unique people or clicks. UA/hints describe what
the browser discloses; never infer a physical PC manufacturer or an iPhone model.
"""
from __future__ import annotations

import logging
import re
import threading
from collections import Counter
from datetime import datetime, timedelta, timezone
from functools import lru_cache

KST = timezone(timedelta(hours=9))
TYPES = ("desktop", "tablet", "mobile", "unknown")
SCHEMAS = (
    """CREATE TABLE IF NOT EXISTS device_traffic_daily (
        day TEXT NOT NULL, device_type TEXT NOT NULL, device_name TEXT NOT NULL,
        os TEXT NOT NULL, browser TEXT NOT NULL, pageviews INTEGER NOT NULL,
        computed_at TEXT NOT NULL,
        PRIMARY KEY(day, device_type, device_name, os, browser))""",
    """CREATE TABLE IF NOT EXISTS device_traffic_state (
        id INTEGER PRIMARY KEY CHECK(id=1), first_day TEXT, updated_at TEXT)""",
    """CREATE INDEX IF NOT EXISTS idx_page_views_device_day ON page_views(created_at)
        WHERE event_type='page_view' AND is_bot IS NOT 1""",
)
_started = False
_job_lock = threading.Lock()
log = logging.getLogger(__name__)


def _clean_model(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9 ._+()\-]", "", value).strip()[:80]
    return "" if value.lower() in {"", "k", "unknown", "generic", "android"} else value


def classify(user_agent: str | None, hints: dict | None = None) -> tuple[str, str, str, str]:
    hints = hints or {}
    return _classify(user_agent or "", _clean_model(str(hints.get("model") or "")),
                     str(hints.get("platform") or "")[:40], bool(hints.get("ipad")), hints.get("mobile"))


@lru_cache(maxsize=4096)
def _classify(ua: str, model: str, platform: str, ipad: bool, mobile: bool | None) -> tuple[str, str, str, str]:
    lower = ua.lower()
    browser = next((label for pattern, label in (
        (r"kakaotalk", "카카오 인앱"), (r"naver\(|naver\(inapp|naverapp", "네이버 인앱"),
        (r"samsungbrowser", "Samsung Internet"), (r"whale/", "Whale"),
        (r"edg[a-z]*/", "Edge"), (r"opr/|opera", "Opera"),
        (r"firefox/|fxios/", "Firefox"), (r"chrome/|crios/", "Chrome"),
        (r"safari/", "Safari"),
    ) if re.search(pattern, lower)), "미확인")
    if ipad or "ipad" in lower:
        return "tablet", "Apple iPad", "iPadOS", browser
    if "iphone" in lower or "ipod" in lower:
        return "mobile", "Apple iPhone" if "iphone" in lower else "Apple iPod", "iOS", browser
    if "android" in lower or platform.lower() == "android":
        if not model:
            match = re.search(r"Android[^;)]*;\s*(?:[a-z]{2}[-_][a-z]{2};\s*)?([^;)]+)", ua, re.I)
            if match:
                model = _clean_model(re.split(r"\s+Build/", match[1], flags=re.I)[0])
        tablet = (mobile is False or (mobile is None and "mobile" not in lower)) or bool(re.search(r"SM-[TX]|Nexus (7|9|10)\b|Pixel Tablet|\btablet\b", model, re.I))
        kind = "tablet" if tablet else "mobile"
        if re.match(r"SM-|GT-|SCH-|SHV-", model, re.I):
            name = "Samsung · " + model
        elif "pixel" in model.lower():
            name = "Google · " + model
        elif model:
            name = "Android · " + model
        else:
            name = "Android 태블릿 · 모델 미공개" if tablet else "Android 휴대폰 · 모델 미공개"
        return kind, name, "Android", browser
    if "windows phone" in lower:
        return "mobile", "Windows Phone", "Windows Phone", browser
    if "windows" in lower or platform.lower() == "windows":
        return "desktop", "Windows PC", "Windows", browser
    if "macintosh" in lower or "mac os x" in lower or platform.lower() == "macos":
        return "desktop", "Apple Mac", "macOS", browser
    if "cros" in lower or platform.lower() == "chrome os":
        return "desktop", "Chromebook / ChromeOS PC", "ChromeOS", browser
    if "linux" in lower or platform.lower() == "linux":
        return "desktop", "Linux PC", "Linux", browser
    return "unknown", "기기 미확인", "미확인", browser


def _groups(conn, day: str) -> Counter:
    from app.services import page_view_store as store
    start, end = store._kst_day_bounds(day)
    # SQL groups at the source: Python never fetches individual visit rows.
    rows = conn.execute(
        "SELECT device_type, device_name, device_os, device_browser, user_agent, COUNT(*) "
        "FROM page_views WHERE created_at>=? AND created_at<? "
        f"AND event_type='page_view' AND {store.HUMAN} GROUP BY 1,2,3,4,5", (start, end),
    ).fetchall()
    counts = Counter()
    for kind, name, os_name, browser, ua, count in rows:
        key = (kind, name, os_name, browser) if kind in TYPES and name and os_name and browser else classify(ua)
        counts[key] += count
    return counts


def aggregate_pending_days(max_days: int = 7, now: datetime | None = None) -> int:
    """Bounded, restart-safe backfill, newest days first; empty days get a marker.

    Absolute upserts are retry-safe. A completion marker is published only AFTER
    every bounded SQL chunk succeeds; readers ignore unfinished days. This also
    works with Turso's per-request auto-commit, without assuming a remote rollback.
    """
    from app.services import page_view_store as store
    if not _job_lock.acquire(blocking=False):
        return 0
    try:
        now = now or datetime.now(timezone.utc)
        today = now.astimezone(KST).date()
        def discover(conn):
            first = conn.execute("SELECT MIN(created_at) FROM page_views").fetchone()[0]
            if not first:
                first_day = today.isoformat()
            else:
                first_day = store._to_kst_date(first).isoformat()
            previous = conn.execute("SELECT first_day FROM device_traffic_state WHERE id=1").fetchone()
            if previous and previous[0]:
                first_day = min(first_day, previous[0])
            conn.execute("INSERT OR REPLACE INTO device_traffic_state VALUES(1,?,?)", (first_day, now.isoformat()))
            conn.commit()
            completed = {r[0] for r in conn.execute(
                "SELECT day FROM device_traffic_daily WHERE device_type='_complete'"
            ).fetchall()}
            return first_day, completed
        first_day, completed = store._with_connection(discover)
        day = today - timedelta(days=1)
        pending = []
        while day.isoformat() >= first_day and len(pending) < max_days:
            if day.isoformat() not in completed:
                pending.append(day.isoformat())
            day -= timedelta(days=1)
        for day in pending:
            def materialize(conn):
                if conn.execute("SELECT 1 FROM device_traffic_daily WHERE day=? AND device_type='_complete'", (day,)).fetchone():
                    return
                counts = _groups(conn, day)
                source_count = sum(counts.values())
                # Rebuilds may remove a dimension (e.g. bot reclassification).
                # Zero obsolete keys before publishing the new completion marker.
                for row in conn.execute("SELECT device_type,device_name,os,browser FROM device_traffic_daily WHERE day=? AND device_type!='_complete'", (day,)).fetchall():
                    counts.setdefault(tuple(row), 0)
                rows = [(day, *key, count, now.isoformat()) for key, count in counts.items()]
                for offset in range(0, len(rows), 100):
                    chunk = rows[offset:offset + 100]
                    conn.execute("INSERT OR REPLACE INTO device_traffic_daily VALUES " +
                                 ",".join(["(?,?,?,?,?,?,?)"] * len(chunk)),
                                 tuple(value for row in chunk for value in row))
                # Another process may write a delayed view while chunks save.
                # Publish only if the source still matches this snapshot. An
                # arrival after this atomic statement invalidates the marker.
                start, end = store._kst_day_bounds(day)
                conn.execute("INSERT OR REPLACE INTO device_traffic_daily "
                             "SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM page_views "
                             f"WHERE created_at>=? AND created_at<? AND event_type='page_view' AND {store.HUMAN})=?",
                             (day, "_complete", "", "", "", 0, now.isoformat(), start, end, source_count))
                conn.commit()
            store._with_connection(materialize)
        return len(pending)
    finally:
        _job_lock.release()


def overview(days: int = 30, now: datetime | None = None) -> dict:
    if not 1 <= days <= 730:
        raise ValueError("days must be between 1 and 730")
    from app.services import page_view_store as store
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(KST).date()
    start = today - timedelta(days=days - 1)
    def read(conn):
        rows = conn.execute(
            "SELECT device_type,device_name,os,browser,SUM(pageviews) FROM device_traffic_daily "
            "WHERE day>=? AND day<? AND device_type!='_complete' "
            "AND EXISTS (SELECT 1 FROM device_traffic_daily c WHERE c.day=device_traffic_daily.day AND c.device_type='_complete') "
            "GROUP BY 1,2,3,4 HAVING SUM(pageviews)>0",
            (start.isoformat(), today.isoformat()),
        ).fetchall()
        completed = {r[0] for r in conn.execute(
            "SELECT day FROM device_traffic_daily WHERE day>=? AND day<? AND device_type='_complete'",
            (start.isoformat(), today.isoformat()),
        ).fetchall()}
        state = conn.execute("SELECT first_day, updated_at FROM device_traffic_state WHERE id=1").fetchone()
        counts = Counter({tuple(r[:4]): r[4] for r in rows})
        counts.update(_groups(conn, today.isoformat()))  # never a historical raw scan
        return counts, completed, state
    counts, completed, state = store._with_connection(read)
    total = sum(counts.values())
    types, devices, operating_systems, browsers = Counter(), Counter(), Counter(), Counter()
    for (kind, name, os_name, browser), count in counts.items():
        types[kind] += count
        devices[kind, name] += count
        operating_systems[os_name] += count
        browsers[browser] += count
    missing = 0
    day = start
    while day < today:
        if (not state or day.isoformat() >= state[0]) and day.isoformat() not in completed:
            missing += 1
        day += timedelta(days=1)
    pct = lambda count: round(count * 100 / total, 2) if total else 0.0
    # Bound response size while retaining every view in the denominator.
    bounded_devices = []
    for kind in TYPES:
        ranked = [(name, count) for (category, name), count in devices.most_common() if category == kind]
        bounded_devices.extend((kind, name, count) for name, count in ranked[:25])
        if len(ranked) > 25:
            bounded_devices.append((kind, "기타 기기 (상위 25종 외)", sum(count for _, count in ranked[25:])))
    return {
        "days": days, "start_date": start.isoformat(), "end_date": today.isoformat(),
        "metric": "human_pageviews", "total": total,
        "types": [{"type": kind, "count": types[kind], "percentage": pct(types[kind])} for kind in TYPES],
        "devices": [{"type": kind, "name": name, "count": count,
                     "percentage": pct(count), "within_type_percentage": round(count * 100 / types[kind], 2)}
                    for kind, name, count in bounded_devices],
        "operating_systems": [{"name": name, "count": count, "percentage": pct(count)} for name, count in operating_systems.most_common()],
        "browsers": [{"name": name, "count": count, "percentage": pct(count)} for name, count in browsers.most_common()],
        "coverage_percentage": pct(total - types["unknown"]), "missing_days": missing,
        "history_ready": state is not None and missing == 0,
        "available_from": state[0] if state else None, "aggregated_at": state[1] if state else None,
        "generated_at": now.isoformat(),
    }


def start_worker() -> None:
    global _started
    if _started:
        return
    _started = True
    def loop():
        while True:
            delay = 10
            try:
                if aggregate_pending_days() == 0:
                    delay = 300
            except Exception:
                log.exception("Device history aggregation failed; will retry")
                delay = 60
            threading.Event().wait(delay)
    threading.Thread(target=loop, name="device-analytics-rollup", daemon=True).start()


def retention_safe(cutoff_iso: str) -> bool:
    """Do not purge history that the bounded initial backfill has not reached."""
    from app.services import page_view_store as store
    def check(conn):
        return conn.execute(
            "SELECT 1 FROM page_views p WHERE p.created_at<? AND p.event_type='page_view' "
            "AND p.is_bot IS NOT 1 AND NOT EXISTS (SELECT 1 FROM device_traffic_daily d "
            "WHERE d.day=date(p.created_at,'+9 hours') AND d.device_type='_complete') LIMIT 1",
            (cutoff_iso,),
        ).fetchone() is None
    return store._with_connection(check)
