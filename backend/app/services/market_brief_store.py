import json, os
from pathlib import Path
from app.services import libsql_gate, turso

LOCAL_DB_PATH=Path(__file__).resolve().parent.parent/"data"/"store"/"market_briefs.db"
_gate=libsql_gate.Gate("market_brief_store"); _conn=None
SCHEMA="""CREATE TABLE IF NOT EXISTS market_close_briefs (report_date TEXT NOT NULL, market TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(report_date,market))"""
def _connect():
    url=os.environ.get("TURSO_DATABASE_URL")
    if url:return turso.connect(database=url,auth_token=os.environ.get("TURSO_AUTH_TOKEN"))
    LOCAL_DB_PATH.parent.mkdir(parents=True,exist_ok=True); return turso.connect(database=str(LOCAL_DB_PATH))
def _run(fn):
    global _conn
    with _gate.hold():
        if _conn is None:_conn=_connect();_conn.execute(SCHEMA);_conn.commit()
        try:return fn(_conn)
        except Exception:
            try:_conn.close()
            except Exception:pass
            _conn=_connect();_conn.execute(SCHEMA);_conn.commit();return fn(_conn)
def save(day,market,payload,created):
    def f(c):c.execute("INSERT OR REPLACE INTO market_close_briefs VALUES(?,?,?,?)",(day,market,json.dumps(payload,ensure_ascii=False),created));c.commit()
    _run(f)
def get(day,market):
    row=_run(lambda c:c.execute("SELECT payload FROM market_close_briefs WHERE report_date=? AND market=?",(day,market)).fetchone())
    return json.loads(row[0]) if row else None
def latest(market):
    row=_run(lambda c:c.execute("SELECT payload FROM market_close_briefs WHERE market=? ORDER BY report_date DESC LIMIT 1",(market,)).fetchone())
    return json.loads(row[0]) if row else None
def dates(limit=120):
    rows=_run(lambda c:c.execute("SELECT report_date,market,created_at FROM market_close_briefs ORDER BY report_date DESC,market LIMIT ?",(limit,)).fetchall())
    return [{"date":r[0],"market":r[1],"created_at":r[2]} for r in rows]
