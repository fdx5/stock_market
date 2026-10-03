"""Support analytics share the existing persistent activity database, not comments."""
from datetime import datetime, timedelta, timezone
from app.services import page_view_store

SCHEMA = """CREATE TABLE IF NOT EXISTS support_dwell (
    event_id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
    seconds REAL NOT NULL CHECK(seconds >= 0 AND seconds <= 30), created_at TEXT NOT NULL
)"""


def record(session_id, event_id, seconds, created_at):
    def run(conn):
        conn.execute("INSERT OR IGNORE INTO support_dwell VALUES (?, ?, ?, ?)",
                     (event_id, session_id, min(30, max(0, seconds)), created_at))
        # Bounded retention; the created_at index also serves range queries.
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        conn.execute("DELETE FROM support_dwell WHERE created_at < ?", (cutoff,))
        conn.commit()
    page_view_store._with_connection(run)


def read(since, until, offset=0, session_id=None):
    def run(conn):
        # All values, including session IDs, are parameterized. Bots excluded.
        cte = """WITH events AS (
          SELECT session_id, created_at, event_type, label, object_key,
                 device_name, device_os, device_browser, source_name, 0 AS seconds
          FROM page_views WHERE path='/support' AND is_bot IS NOT 1
            AND created_at >= ? AND created_at <= ?
          UNION ALL
          SELECT session_id, created_at, 'dwell', NULL, NULL, NULL, NULL, NULL, NULL, seconds
          FROM support_dwell WHERE created_at >= ? AND created_at <= ?
        ) """
        bounds = (since, until, since, until)
        pay = "(event_type='click' AND (object_key IN ('support-pay','support-qr') OR label LIKE '%카카오%'))"
        if session_id:
            rows = conn.execute(cte + """SELECT created_at, event_type, label, object_key,
                device_name, device_os, device_browser, source_name FROM events
                WHERE session_id=? AND event_type!='dwell' ORDER BY created_at LIMIT 501""",
                (*bounds, session_id)).fetchall()
            keys = ('created_at','type','label','object_key','device','os','browser','source')
            return {"events": [dict(zip(keys, row)) for row in rows[:500]], "truncated": len(rows)>500}
        totals = conn.execute(cte + f"""SELECT COUNT(DISTINCT session_id),
            COALESCE(SUM(event_type='page_view'),0), COALESCE(SUM(event_type='click'),0),
            COALESCE(SUM({pay}),0), COALESCE(SUM(seconds),0) FROM events""", bounds).fetchone()
        rows = conn.execute(cte + f"""SELECT session_id, MIN(created_at), MAX(created_at),
            SUM(event_type='page_view'), SUM(event_type='click'), SUM({pay}),
            SUM(seconds), SUM(event_type='dwell'), MAX(device_name), MAX(device_os),
            MAX(device_browser), MAX(source_name)
            FROM events GROUP BY session_id ORDER BY MAX(created_at) DESC, session_id LIMIT 50 OFFSET ?""",
            (*bounds, offset)).fetchall()
        keys = ('session_id','first_seen','last_seen','views','clicks','pay_clicks','seconds',
                'dwell_samples','device','os','browser','source')
        return {"total": totals[0], "summary": dict(zip(('sessions','views','clicks','pay_clicks','seconds'),totals)),
                "items": [dict(zip(keys,row)) for row in rows], "offset": offset, "limit": 50}
    return page_view_store._with_connection(run)
