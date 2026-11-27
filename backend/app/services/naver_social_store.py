"""Ledger for the Naver blog posts that mirror the SNS editions (hot issues, heatmaps,
world scoreboards, movers). Separate from naver_publish_store, which keeps the seven
closing briefs keyed by (report_date, market).

Every table here is additive. Rows are inserted once and then only move forward
through their status; nothing is ever removed.

naver_social_posts   one row per post key "<YYYY-MM-DD>:<edition>"
    status  pending → publishing → published | failed (retried while attempts < MAX)
            skipped  the edition's window closed before its data was ready
naver_social_runs    append-only log of each attempt and outcome (admin monitoring)
naver_social_perf    one row per (post key, measured day): site visits from the post,
                     Naver likes/comments and whether the post shows in Naver search
naver_blog_worker    one row: when the local publisher last checked in
"""

import datetime as dt
import json
import logging
import os
from pathlib import Path

from dotenv import load_dotenv

from app.services import libsql_gate, turso

load_dotenv()
log = logging.getLogger(__name__)

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")
LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "naver_publish.db"

MAX_ATTEMPTS = 4

_gate = libsql_gate.Gate("naver_social_store")
_conn = None

_SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS naver_social_posts (
        post_key TEXT PRIMARY KEY,
        day TEXT NOT NULL,
        edition TEXT NOT NULL,
        category_no INTEGER,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        title TEXT,
        tags TEXT,
        variant TEXT,
        campaign TEXT,
        log_no TEXT,
        post_url TEXT,
        category_seen INTEGER,
        chars INTEGER,
        images INTEGER,
        last_error TEXT,
        queued_at TEXT NOT NULL,
        published_at TEXT,
        updated_at TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_naver_social_posts_day ON naver_social_posts(day)",
    """
    CREATE TABLE IF NOT EXISTS naver_social_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_key TEXT NOT NULL,
        at TEXT NOT NULL,
        event TEXT NOT NULL,
        detail TEXT
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_naver_social_runs_key ON naver_social_runs(post_key)",
    """
    CREATE TABLE IF NOT EXISTS naver_social_perf (
        post_key TEXT NOT NULL,
        measured_day TEXT NOT NULL,
        age_days INTEGER,
        visits INTEGER,
        visitors INTEGER,
        likes INTEGER,
        comments INTEGER,
        read_count INTEGER,
        search_rank INTEGER,
        search_query TEXT,
        measured_at TEXT NOT NULL,
        PRIMARY KEY (post_key, measured_day)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS naver_blog_worker (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        seen_at TEXT NOT NULL,
        version TEXT,
        note TEXT
    )
    """,
)

_COLUMNS = ("post_key", "day", "edition", "category_no", "status", "attempts", "title", "tags", "variant",
            "campaign", "log_no", "post_url", "category_seen", "chars", "images", "last_error", "queued_at",
            "published_at", "updated_at")


def _connect():
    if TURSO_DATABASE_URL:
        return turso.connect(database=TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
    LOCAL_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return turso.connect(database=str(LOCAL_DB_PATH))


def _ready():
    conn = _connect()
    for statement in _SCHEMA:
        conn.execute(statement)
    conn.commit()
    return conn


def _with(fn):
    global _conn
    with _gate.hold():
        if _conn is None:
            _conn = _ready()
        try:
            return fn(_conn)
        except Exception as exc:
            if not turso.should_retry(exc):
                raise
            try:
                _conn.close()
            except Exception:
                pass
            _conn = _ready()
            return fn(_conn)


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def key(day: dt.date | str, edition: str) -> str:
    return f"{day}:{edition}"


def _row(row) -> dict:
    return dict(zip(_COLUMNS, row))


def get(post_key: str) -> dict | None:
    row = _with(lambda c: c.execute(f"SELECT {', '.join(_COLUMNS)} FROM naver_social_posts WHERE post_key = ?",
                                    (post_key,)).fetchone())
    return _row(row) if row else None


def for_days(days: list[str]) -> list[dict]:
    if not days:
        return []
    marks = ",".join("?" for _ in days)
    rows = _with(lambda c: c.execute(
        f"SELECT {', '.join(_COLUMNS)} FROM naver_social_posts WHERE day IN ({marks}) ORDER BY queued_at",
        tuple(days)).fetchall())
    return [_row(r) for r in rows or []]


def recent(limit: int = 80) -> list[dict]:
    rows = _with(lambda c: c.execute(
        f"SELECT {', '.join(_COLUMNS)} FROM naver_social_posts ORDER BY queued_at DESC LIMIT ?", (limit,)).fetchall())
    return [_row(r) for r in rows or []]


def published_since(day: str) -> list[dict]:
    rows = _with(lambda c: c.execute(
        f"SELECT {', '.join(_COLUMNS)} FROM naver_social_posts WHERE status = 'published' AND day >= ? ORDER BY day",
        (day,)).fetchall())
    return [_row(r) for r in rows or []]


def enqueue(day: str, edition: str, category_no: int) -> None:
    enqueue_many([(day, edition, category_no)])


def enqueue_many(slots: list[tuple[str, str, int]], *, missed: bool = False) -> None:
    if not slots:
        return
    now = _now()
    status = "skipped" if missed else "pending"
    error = "publication window closed without a worker result" if missed else None

    def run(c):
        c.executemany(
            "INSERT INTO naver_social_posts (post_key, day, edition, category_no, status, attempts, "
            "last_error, queued_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?) "
            "ON CONFLICT(post_key) DO NOTHING",
            [(key(day, edition), day, edition, category, status, error, now, now)
             for day, edition, category in slots])
        c.commit()

    _with(run)


def claim(post_key: str) -> bool:
    """pending/failed → publishing; True only for the caller that won the row."""
    now = _now()

    def run(c):
        cur = c.execute(
            "UPDATE naver_social_posts SET status = 'publishing', attempts = attempts + 1, updated_at = ? "
            "WHERE post_key = ? AND status IN ('pending', 'failed') AND attempts < ?",
            (now, post_key, MAX_ATTEMPTS))
        c.commit()
        return getattr(cur, "rowcount", 0) == 1

    return _with(run)


def release(post_key: str, error: str, *, refund: bool) -> None:
    """publishing → pending (data not ready / session refused: refund the attempt) or failed."""
    now = _now()
    status = "pending" if refund else "failed"
    attempts = "CASE WHEN attempts > 0 THEN attempts - 1 ELSE 0 END" if refund else "attempts"

    def run(c):
        c.execute(
            f"UPDATE naver_social_posts SET status = ?, attempts = {attempts}, last_error = ?, updated_at = ? "
            "WHERE post_key = ? AND status = 'publishing'", (status, error[:500], now, post_key))
        c.commit()

    _with(run)


def mark_skipped(post_key: str, reason: str) -> None:
    now = _now()

    def run(c):
        c.execute("UPDATE naver_social_posts SET status = 'skipped', "
                  "last_error = COALESCE(last_error, ?), updated_at = ? "
                  "WHERE post_key = ? AND status IN ('pending', 'failed') AND attempts < ?",
                  (reason, now, post_key, MAX_ATTEMPTS))
        c.commit()

    _with(run)


def mark_published(post_key: str, *, log_no: str, post_url: str, title: str, tags: list[str], variant: str,
                   campaign: str, category_seen: int | None, chars: int | None, images: int) -> None:
    now = _now()

    def run(c):
        c.execute(
            "UPDATE naver_social_posts SET status = 'published', log_no = ?, post_url = ?, title = ?, tags = ?, "
            "variant = ?, campaign = ?, category_seen = ?, chars = ?, images = ?, last_error = NULL, "
            "published_at = ?, updated_at = ? WHERE post_key = ?",
            (log_no, post_url, title, json.dumps(tags, ensure_ascii=False), variant, campaign, category_seen,
             chars, images, now, now, post_key))
        c.commit()

    _with(run)


def release_stale(older_than_minutes: int = 40) -> int:
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=older_than_minutes)).isoformat(timespec="seconds")

    def run(c):
        cur = c.execute("UPDATE naver_social_posts SET status = 'failed', last_error = 'stale claim released', "
                        "updated_at = ? WHERE status = 'publishing' AND updated_at < ?", (_now(), cutoff))
        c.commit()
        return getattr(cur, "rowcount", 0)

    return _with(run)


def log_run(post_key: str, event: str, detail: str = "") -> None:
    try:
        def run(c):
            c.execute("INSERT INTO naver_social_runs (post_key, at, event, detail) VALUES (?, ?, ?, ?)",
                      (post_key, _now(), event, (detail or "")[:600]))
            c.commit()

        _with(run)
    except Exception:
        log.exception("could not record the run log")


def runs_for_days(days: list[str], limit: int = 200) -> list[dict]:
    if not days:
        return []
    likes = " OR ".join("post_key LIKE ?" for _ in days)
    rows = _with(lambda c: c.execute(
        f"SELECT post_key, at, event, detail FROM naver_social_runs WHERE {likes} ORDER BY id DESC LIMIT ?",
        (*[f"{d}:%" for d in days], limit)).fetchall())
    return [{"post_key": k, "at": a, "event": e, "detail": d} for k, a, e, d in rows or []]


def record_perf(post_key: str, measured_day: str, **values) -> bool:
    """One measurement per post per day, written once (later passes that day are ignored)."""
    cols = ("age_days", "visits", "visitors", "likes", "comments", "read_count", "search_rank", "search_query")
    data = [values.get(c) for c in cols]

    def run(c):
        cur = c.execute(
            f"INSERT INTO naver_social_perf (post_key, measured_day, {', '.join(cols)}, measured_at) "
            f"VALUES (?, ?, {', '.join('?' for _ in cols)}, ?) ON CONFLICT(post_key, measured_day) DO NOTHING",
            (post_key, measured_day, *data, _now()))
        c.commit()
        return getattr(cur, "rowcount", 0) == 1

    return _with(run)


def perf_measured(measured_day: str) -> set[str]:
    rows = _with(lambda c: c.execute("SELECT post_key FROM naver_social_perf WHERE measured_day = ?",
                                     (measured_day,)).fetchall())
    return {r[0] for r in rows or []}


def perf_since(day: str) -> list[dict]:
    rows = _with(lambda c: c.execute(
        "SELECT post_key, measured_day, age_days, visits, visitors, likes, comments, read_count, search_rank, "
        "search_query FROM naver_social_perf WHERE measured_day >= ? ORDER BY post_key, measured_day", (day,)).fetchall())
    keys = ("post_key", "measured_day", "age_days", "visits", "visitors", "likes", "comments", "read_count",
            "search_rank", "search_query")
    return [dict(zip(keys, r)) for r in rows or []]


def heartbeat(version: str, note: str = "") -> None:
    def run(c):
        c.execute("INSERT INTO naver_blog_worker (id, seen_at, version, note) VALUES (1, ?, ?, ?) "
                  "ON CONFLICT(id) DO UPDATE SET seen_at = excluded.seen_at, version = excluded.version, "
                  "note = excluded.note", (_now(), version, note[:300]))
        c.commit()

    _with(run)


def worker_status() -> dict | None:
    row = _with(lambda c: c.execute("SELECT seen_at, version, note FROM naver_blog_worker WHERE id = 1").fetchone())
    return {"seen_at": row[0], "version": row[1], "note": row[2]} if row else None
