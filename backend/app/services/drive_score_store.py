"""Scores of the 3D view's driving game (배송 게임), one row per finished drive.

A player is an anonymous id the browser makes once and keeps (no sign-in on the site),
with the nickname they gave; the board ranks players by the sum of their drives' scores.
Same Turso-with-local-fallback shape as realestate_store.py, on the shared database.
"""

import os
import time
from pathlib import Path

from dotenv import load_dotenv

from app.services import libsql_gate, turso

load_dotenv()

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")
LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "drive_scores.db"

_gate = libsql_gate.Gate("drive_score_store")
_conn = None

_SCHEMA = """
CREATE TABLE IF NOT EXISTS drive_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL,
    name TEXT NOT NULL,
    score INTEGER NOT NULL,
    deliveries INTEGER NOT NULL,
    vehicle TEXT NOT NULL,
    created_at INTEGER NOT NULL
)
"""
_INDEX = "CREATE INDEX IF NOT EXISTS drive_scores_player ON drive_scores (player_id)"


def _connect():
    if TURSO_DATABASE_URL:
        return turso.connect(database=TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
    LOCAL_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return turso.connect(database=str(LOCAL_DB_PATH))


def _new_ready_connection():
    conn = _connect()
    conn.execute(_SCHEMA)
    conn.execute(_INDEX)
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


def add_score(player_id: str, name: str, score: int, deliveries: int, vehicle: str) -> None:
    def _run(conn):
        conn.execute(
            "INSERT INTO drive_scores (player_id, name, score, deliveries, vehicle, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (player_id, name, score, deliveries, vehicle, int(time.time())),
        )
        # (the player's latest nickname on all their rows: one name per player on the board)
        conn.execute("UPDATE drive_scores SET name = ? WHERE player_id = ?", (name, player_id))
        conn.commit()

    _with_connection(_run)


_BOARD = """
SELECT player_id, MAX(name) AS name, SUM(score) AS total, COUNT(*) AS drives, SUM(deliveries) AS deliveries
FROM drive_scores GROUP BY player_id
"""


def leaderboard(limit: int, player_id: str | None) -> dict:
    """The top `limit` players (rank 1 first; ties share a rank) and the asking player's own row."""

    def _run(conn):
        rows = conn.execute(
            f"SELECT player_id, name, total, drives, deliveries FROM ({_BOARD}) ORDER BY total DESC, drives ASC LIMIT ?",
            (limit,),
        ).fetchall()
        me = None
        if player_id:
            mine = conn.execute(
                f"SELECT player_id, name, total, drives, deliveries FROM ({_BOARD}) WHERE player_id = ?",
                (player_id,),
            ).fetchone()
            if mine:
                above = conn.execute(f"SELECT COUNT(*) FROM ({_BOARD}) WHERE total > ?", (mine[2],)).fetchone()[0]
                me = {"rank": int(above) + 1, "name": mine[1], "score": int(mine[2]), "drives": int(mine[3]), "deliveries": int(mine[4]), "me": True}
        players = conn.execute("SELECT COUNT(DISTINCT player_id) FROM drive_scores").fetchone()[0]
        return rows, me, players

    rows, me, players = _with_connection(_run)
    top, rank, last = [], 0, None
    for i, r in enumerate(rows):
        if r[2] != last:
            rank, last = i + 1, r[2]
        top.append({"rank": rank, "name": r[1], "score": int(r[2]), "drives": int(r[3]), "deliveries": int(r[4]), "me": bool(player_id) and r[0] == player_id})
    return {"top": top, "me": me, "players": int(players)}
