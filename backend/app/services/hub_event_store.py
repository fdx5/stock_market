import os
from pathlib import Path

from app.services import libsql_gate, turso
from dotenv import load_dotenv

load_dotenv()

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

# Same local-file fallback as page_view_store.py / visitor_store.py, so main-page
# behaviour survives a backend restart when no Turso credentials are configured.
LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "hub_events.db"

_gate = libsql_gate.Gate("hub_event_store")
_conn = None

# One row per thing a visitor did on the entrance page.
#
# Deliberately a table of its own rather than more rows in page_views. The two
# answer different questions and have different shapes: page_views counts
# arrivals at a path, and this records WHAT was touched once someone was there,
# plus how long they stayed. Folding dwell seconds into a table whose every
# other row means "one view" would make every existing count wrong.
#
# `object_key` is the stable identity (a body key, a control's name) and
# `object_label` is what it was called on screen at the time. Both, because the
# label is what an admin wants to read and the key is what a ranking has to
# group by — a body renamed in bodies.ts must not split into two ranking rows.
#
# `value` is only meaningful for rows that measure something: dwell seconds on a
# `dwell` row, and nothing at all on a click.
_SCHEMA = """
CREATE TABLE IF NOT EXISTS hub_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    action TEXT NOT NULL,
    object_key TEXT,
    object_label TEXT,
    value REAL,
    created_at TEXT NOT NULL
)
"""
_INDEXES = (
    "CREATE INDEX IF NOT EXISTS idx_hub_events_created_at ON hub_events (created_at)",
    "CREATE INDEX IF NOT EXISTS idx_hub_events_action ON hub_events (action, created_at)",
)

# Matches page_view_store's window: the trend chart never looks further back
# than 30 days and the rankings never further than 7, so anything older is dead
# weight. Purged on the same startup timer in main.py.
RETENTION_DAYS = 30


def _connect():
    if TURSO_DATABASE_URL:
        return turso.connect(database=TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
    LOCAL_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return turso.connect(database=str(LOCAL_DB_PATH))


def _new_ready_connection():
    conn = _connect()
    conn.execute(_SCHEMA)
    for index in _INDEXES:
        conn.execute(index)
    conn.commit()
    return conn


def _with_connection(fn):
    """Retry-once-on-a-fresh-connection, the same shape every store here uses —
    see comment_store.py for why one process-wide connection rather than one
    per call."""
    global _conn
    with _gate.hold():
        if _conn is None:
            _conn = _new_ready_connection()
        try:
            return fn(_conn)
        except Exception:
            try:
                _conn.close()
            except Exception:
                pass
            _conn = _new_ready_connection()
            return fn(_conn)


def record(
    session_id: str,
    action: str,
    created_at: str,
    object_key: str | None = None,
    object_label: str | None = None,
    value: float | None = None,
) -> None:
    def _run(conn):
        conn.execute(
            "INSERT INTO hub_events (session_id, action, object_key, object_label, value, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (session_id, action, object_key, object_label, value, created_at),
        )
        conn.commit()

    _with_connection(_run)


def action_totals(since_iso: str) -> dict[str, int]:
    """How many of each kind of thing happened, for the summary tiles."""

    def _run(conn):
        return conn.execute(
            "SELECT action, COUNT(*) FROM hub_events WHERE created_at >= ? GROUP BY action",
            (since_iso,),
        ).fetchall()

    return {action: count for action, count in _with_connection(_run)}


def session_count(since_iso: str) -> int:
    def _run(conn):
        return conn.execute(
            "SELECT COUNT(DISTINCT session_id) FROM hub_events WHERE created_at >= ?",
            (since_iso,),
        ).fetchone()[0]

    return _with_connection(_run)


# A tab left open overnight would otherwise report a dwell of fourteen hours and
# drag the average somewhere meaningless. The client already stops counting when
# the page is hidden (see useHubTracking), so this is the second line of defence
# against a machine that slept, a clock that jumped, or a forged payload.
MAX_DWELL_SECONDS = 3600


def dwell_stats(since_iso: str) -> dict:
    """Average and total time spent on the entrance page.

    Averaged over SESSIONS, not over rows. A visitor who backgrounds and returns
    to the tab five times sends five dwell rows, and counting each as a separate
    "visit" would report an average stay a fifth of the real one. So the seconds
    are summed per session first, and the mean is taken over those totals."""

    def _run(conn):
        return conn.execute(
            "SELECT session_id, SUM(value) FROM hub_events "
            "WHERE action = 'dwell' AND value IS NOT NULL AND created_at >= ? "
            "GROUP BY session_id",
            (since_iso,),
        ).fetchall()

    rows = _with_connection(_run)
    totals = sorted(min(float(total or 0), MAX_DWELL_SECONDS) for _, total in rows)
    if not totals:
        return {"sessions": 0, "avg_seconds": 0.0, "median_seconds": 0.0, "total_seconds": 0.0}

    middle = len(totals) // 2
    median = totals[middle] if len(totals) % 2 else (totals[middle - 1] + totals[middle]) / 2
    return {
        "sessions": len(totals),
        "avg_seconds": sum(totals) / len(totals),
        # Carried alongside the mean because these two disagree loudly here and
        # the disagreement is the information: a handful of visitors who leave
        # the orbit running pull the mean well above what a typical stay is.
        "median_seconds": median,
        "total_seconds": sum(totals),
    }


def top_objects(since_iso: str, limit: int, action: str | None = None) -> list[dict]:
    """The ranking: what got touched, most-touched first.

    Grouped by `object_key` so a body keeps one row across a rename, and the
    label reported is the most recent one seen for that key (MAX over created_at
    picks the latest row's label)."""

    def _run(conn):
        if action:
            return conn.execute(
                "SELECT object_key, "
                "       (SELECT object_label FROM hub_events inner_e "
                "         WHERE inner_e.object_key = e.object_key AND inner_e.object_label IS NOT NULL "
                "         ORDER BY inner_e.created_at DESC LIMIT 1), "
                "       action, COUNT(*), COUNT(DISTINCT session_id) "
                "FROM hub_events e WHERE created_at >= ? AND object_key IS NOT NULL AND action = ? "
                "GROUP BY object_key, action ORDER BY COUNT(*) DESC LIMIT ?",
                (since_iso, action, limit),
            ).fetchall()
        return conn.execute(
            "SELECT object_key, "
            "       (SELECT object_label FROM hub_events inner_e "
            "         WHERE inner_e.object_key = e.object_key AND inner_e.object_label IS NOT NULL "
            "         ORDER BY inner_e.created_at DESC LIMIT 1), "
            "       action, COUNT(*), COUNT(DISTINCT session_id) "
            "FROM hub_events e WHERE created_at >= ? AND object_key IS NOT NULL "
            "GROUP BY object_key, action ORDER BY COUNT(*) DESC LIMIT ?",
            (since_iso, limit),
        ).fetchall()

    rows = _with_connection(_run)
    return [
        {
            "object_key": key,
            "label": label or key,
            "action": action_name,
            "count": count,
            "sessions": sessions,
        }
        for key, label, action_name, count, sessions in rows
    ]


_BUCKET_FORMAT = {"minute": "%Y-%m-%dT%H:%M", "day": "%Y-%m-%d"}


def counts_by_bucket(since_iso: str, granularity: str) -> list[dict]:
    """Events per action per time bucket, in KST — same shift and the same two
    granularities page_view_store uses, so the admin dashboard's existing range
    controls drive this chart without a second set of rules."""

    fmt = _BUCKET_FORMAT[granularity]

    def _run(conn):
        return conn.execute(
            f"SELECT strftime('{fmt}', created_at, '+9 hours') AS bucket, action, COUNT(*) "
            "FROM hub_events WHERE created_at >= ? GROUP BY bucket, action ORDER BY bucket",
            (since_iso,),
        ).fetchall()

    rows = _with_connection(_run)
    return [{"bucket": bucket, "action": action, "count": count} for bucket, action, count in rows]


def session_detail(session_id: str, limit: int = 200) -> list[dict]:
    """Everything one session did, oldest first — the trail behind a row in the
    live log, for following a single visitor through the page."""

    def _run(conn):
        return conn.execute(
            "SELECT action, object_key, object_label, value, created_at FROM hub_events "
            "WHERE session_id = ? ORDER BY created_at LIMIT ?",
            (session_id, limit),
        ).fetchall()

    rows = _with_connection(_run)
    return [
        {
            "action": action,
            "object_key": key,
            "label": label,
            "value": value,
            "created_at": created_at,
        }
        for action, key, label, value, created_at in rows
    ]


def purge_older_than(cutoff_iso: str) -> int:
    def _run(conn):
        cursor = conn.execute("DELETE FROM hub_events WHERE created_at < ?", (cutoff_iso,))
        conn.commit()
        return cursor.rowcount or 0

    return _with_connection(_run)
