"""Publish ledger for the Naver blog auto-poster — the idempotency boundary.

One row per (report_date, market). The primary key IS the de-dupe: the requirement is
that the same 종목×날짜 never gets published twice, and the cheapest way to guarantee
that is to let the database refuse the second insert rather than to reason about it in
Python. `claim()` below is written so that a row only moves into "publishing" from a
state that is allowed to be retried, and it returns whether it actually won the claim.

Why a separate table from market_close_briefs: a brief is generated once and rewritten
freely (the batch is idempotent per date+version and re-runs on every restart after
16:10), whereas publishing is a one-way side effect on an external service. Those two
have different lifecycles and must not share a row.

status values
    pending     queued, never attempted
    publishing  a worker holds the claim right now
    published   confirmed on Naver — log_no is set
    failed      attempts exhausted; needs a human or a re-queue
    skipped     deliberately not published (manual admin action)
"""

import datetime as dt
import logging
import os
from pathlib import Path

from app.services import libsql_gate, turso
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger(__name__)

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "naver_publish.db"

_gate = libsql_gate.Gate("naver_publish_store")
_conn = None

MAX_ATTEMPTS = 3

_SCHEMA = """
CREATE TABLE IF NOT EXISTS naver_blog_posts (
    report_date TEXT NOT NULL,
    market TEXT NOT NULL,
    status TEXT NOT NULL,
    log_no TEXT,
    post_url TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    queued_at TEXT NOT NULL,
    published_at TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (report_date, market)
)
"""


def _connect():
    if TURSO_DATABASE_URL:
        return turso.connect(database=TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
    LOCAL_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return turso.connect(database=str(LOCAL_DB_PATH))


def _new_ready_connection():
    conn = _connect()
    conn.execute(_SCHEMA)
    conn.commit()
    return conn


def _with_connection(fn):
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


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def enqueue(report_date: str, market: str) -> bool:
    """Registers a (date, market) as needing publication. Returns True if this call
    created the row.

    Deliberately does NOT reset an existing row. Re-running the brief batch — which
    happens on every process restart after 16:10 KST — must not resurrect something
    already published, and must not zero the attempt counter on something that has
    already failed twice.
    """
    now = _now()

    def _run(conn):
        cur = conn.execute(
            "SELECT status FROM naver_blog_posts WHERE report_date = ? AND market = ?",
            (report_date, market),
        ).fetchone()
        if cur is not None:
            return False
        conn.execute(
            """
            INSERT INTO naver_blog_posts
                (report_date, market, status, attempts, queued_at, updated_at)
            VALUES (?, ?, 'pending', 0, ?, ?)
            """,
            (report_date, market, now, now),
        )
        conn.commit()
        return True

    return _with_connection(_run)


def claim(report_date: str, market: str) -> bool:
    """Transitions pending/failed -> publishing. Returns True only if this caller won.

    The UPDATE ... WHERE status IN (...) is the whole mechanism: two workers racing on
    the same row both run it, but only one sees a rowcount of 1. That is what keeps a
    double publish impossible even if the batch chain and a manual trigger overlap, and
    it is why the status check is not done as a separate SELECT first.

    'failed' is claimable because a failed row is exactly what a retry should pick up;
    the attempts ceiling (MAX_ATTEMPTS) is what stops it looping forever.
    """
    now = _now()

    def _run(conn):
        cur = conn.execute(
            """
            UPDATE naver_blog_posts
               SET status = 'publishing', attempts = attempts + 1, updated_at = ?
             WHERE report_date = ? AND market = ?
               AND status IN ('pending', 'failed')
               AND attempts < ?
            """,
            (now, report_date, market, MAX_ATTEMPTS),
        )
        conn.commit()
        # turso.py's cursor mirrors sqlite3's rowcount for UPDATE.
        return getattr(cur, "rowcount", 0) == 1

    return _with_connection(_run)


def mark_published(report_date: str, market: str, log_no: str, post_url: str) -> None:
    now = _now()

    def _run(conn):
        conn.execute(
            """
            UPDATE naver_blog_posts
               SET status = 'published', log_no = ?, post_url = ?, last_error = NULL,
                   published_at = ?, updated_at = ?
             WHERE report_date = ? AND market = ?
            """,
            (log_no, post_url, now, now, report_date, market),
        )
        conn.commit()

    _with_connection(_run)


def mark_failed(report_date: str, market: str, error: str) -> None:
    """Releases the claim back to 'failed' so a later run can retry it.

    Note the row keeps its incremented attempts count — claim() refuses once it reaches
    MAX_ATTEMPTS, which is what turns "retry 3 times" into a hard stop rather than a
    daily rediscovery of the same broken post.
    """
    now = _now()

    def _run(conn):
        conn.execute(
            """
            UPDATE naver_blog_posts
               SET status = 'failed', last_error = ?, updated_at = ?
             WHERE report_date = ? AND market = ?
            """,
            (error[:500], now, report_date, market),
        )
        conn.commit()

    _with_connection(_run)


def reset(report_date: str, market: str | None = None) -> int:
    """Clears the attempt counter and puts rows back to 'pending'.

    Operational escape hatch for "this failed three times for a reason I have since
    fixed" — without it the only way back is editing the table by hand. Does not touch
    rows that are already published: re-publishing is what the whole ledger exists to
    prevent.
    """
    now = _now()

    def _run(conn):
        if market:
            cur = conn.execute(
                """
                UPDATE naver_blog_posts
                   SET status = 'pending', attempts = 0, last_error = NULL, updated_at = ?
                 WHERE report_date = ? AND market = ? AND status != 'published'
                """,
                (now, report_date, market),
            )
        else:
            cur = conn.execute(
                """
                UPDATE naver_blog_posts
                   SET status = 'pending', attempts = 0, last_error = NULL, updated_at = ?
                 WHERE report_date = ? AND status != 'published'
                """,
                (now, report_date),
            )
        conn.commit()
        return getattr(cur, "rowcount", 0)

    return _with_connection(_run)


def release_stale(older_than_minutes: int = 30) -> int:
    """Returns rows stuck in 'publishing' to 'failed'.

    A container that is redeployed mid-publish leaves its claim held forever, and
    nothing else would ever pick that row up. Called at publisher start.
    """
    cutoff = (
        dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=older_than_minutes)
    ).isoformat(timespec="seconds")
    now = _now()

    def _run(conn):
        cur = conn.execute(
            """
            UPDATE naver_blog_posts
               SET status = 'failed', last_error = 'stale claim released', updated_at = ?
             WHERE status = 'publishing' AND updated_at < ?
            """,
            (now, cutoff),
        )
        conn.commit()
        return getattr(cur, "rowcount", 0)

    return _with_connection(_run)


def get(report_date: str, market: str) -> dict | None:
    def _run(conn):
        return conn.execute(
            """
            SELECT report_date, market, status, log_no, post_url, attempts,
                   last_error, queued_at, published_at, updated_at
              FROM naver_blog_posts WHERE report_date = ? AND market = ?
            """,
            (report_date, market),
        ).fetchone()

    row = _with_connection(_run)
    return _row_to_dict(row) if row else None


def pending(report_date: str | None = None, limit: int = 50) -> list[dict]:
    """Rows still worth attempting, oldest first."""

    def _run(conn):
        if report_date:
            return conn.execute(
                """
                SELECT report_date, market, status, log_no, post_url, attempts,
                       last_error, queued_at, published_at, updated_at
                  FROM naver_blog_posts
                 WHERE report_date = ? AND status IN ('pending', 'failed') AND attempts < ?
                 ORDER BY queued_at LIMIT ?
                """,
                (report_date, MAX_ATTEMPTS, limit),
            ).fetchall()
        return conn.execute(
            """
            SELECT report_date, market, status, log_no, post_url, attempts,
                   last_error, queued_at, published_at, updated_at
              FROM naver_blog_posts
             WHERE status IN ('pending', 'failed') AND attempts < ?
             ORDER BY queued_at LIMIT ?
            """,
            (MAX_ATTEMPTS, limit),
        ).fetchall()

    return [_row_to_dict(r) for r in (_with_connection(_run) or [])]


def recent(limit: int = 60) -> list[dict]:
    def _run(conn):
        return conn.execute(
            """
            SELECT report_date, market, status, log_no, post_url, attempts,
                   last_error, queued_at, published_at, updated_at
              FROM naver_blog_posts
             ORDER BY report_date DESC, market LIMIT ?
            """,
            (limit,),
        ).fetchall()

    return [_row_to_dict(r) for r in (_with_connection(_run) or [])]


def _row_to_dict(row) -> dict:
    return {
        "report_date": row[0],
        "market": row[1],
        "status": row[2],
        "log_no": row[3],
        "post_url": row[4],
        "attempts": row[5],
        "last_error": row[6],
        "queued_at": row[7],
        "published_at": row[8],
        "updated_at": row[9],
    }
