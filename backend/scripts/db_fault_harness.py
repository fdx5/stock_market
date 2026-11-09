"""Fault-injection check for the database layer: admin endpoints over the real turso.Connection, its HTTP call replaced by a throwaway
SQLite file per database plus injected faults. Usage: faults2.py <p> <kind> [rounds]
kind: timeout | reset | http502"""
import collections, logging, os, random, sqlite3, sys, tempfile, traceback

for k in list(os.environ):
    if "TURSO" in k:
        os.environ.pop(k)
BACKEND = os.environ.get("BACKEND", r"I:\ai_root\sm-pulse-bg-20261109\backend")
sys.path.insert(0, BACKEND)
os.chdir(BACKEND)
import dotenv
dotenv.load_dotenv = lambda *a, **k: False
os.environ["TURSO_DATABASE_URL"] = "https://fake.turso.invalid"
os.environ["TURSO_AUTH_TOKEN"] = "test"

import requests
from app.services import turso

P, KIND = float(sys.argv[1]), sys.argv[2]
ROUNDS = int(sys.argv[3]) if len(sys.argv) > 3 else 4
TMP = tempfile.mkdtemp(prefix="dbfault2-")
Unreachable = getattr(turso, "TursoUnreachable", turso.TursoError)
stats = collections.Counter()
_db = sqlite3.connect(os.path.join(TMP, "shared.db"), check_same_thread=False, isolation_level=None)


def _enc(v):
    if v is None: return {"type": "null"}
    if isinstance(v, int): return {"type": "integer", "value": str(v)}
    if isinstance(v, float): return {"type": "float", "value": v}
    if isinstance(v, bytes):
        import base64; return {"type": "blob", "base64": base64.b64encode(v).decode()}
    return {"type": "text", "value": str(v)}


def _dec(a):
    return turso._decode(a)


class FakeResp:
    status_code = 200
    def __init__(self, payload, code=200):
        self._p, self.status_code, self.text = payload, code, "upstream forward failed"
    def json(self):
        return self._p


def fake_post(self, url, json=None, timeout=None, **kw):
    stats["round_trips"] += 1
    if random.random() < P:
        stats["faults"] += 1
        if KIND == "timeout":
            raise requests.ReadTimeout("Read timed out")
        if KIND == "reset":
            raise requests.ConnectionError("Connection reset by peer")
        return FakeResp({}, 502)
    results = []
    for req in json["requests"]:
        if req["type"] != "execute":
            results.append({"type": "ok", "response": {"type": "close"}})
            continue
        sql = req["stmt"]["sql"]; args = [_dec(x) for x in req["stmt"]["args"]]
        try:
            if sql in ("BEGIN", "COMMIT"):
                _db.execute(sql); cols, rows, rc, last = [], [], 0, None
            else:
                c = _db.execute(sql, args); rows = c.fetchall()
                cols, rc, last = [d[0] for d in c.description or ()], c.rowcount, c.lastrowid
        except sqlite3.Error as exc:
            if _db.in_transaction: _db.execute("ROLLBACK")
            results.append({"type": "error", "error": {"message": str(exc)}})
            break
        results.append({"type": "ok", "response": {"type": "execute", "result": {
            "cols": [{"name": n} for n in cols], "rows": [[_enc(v) for v in r] for r in rows],
            "affected_row_count": max(rc, 0), "last_insert_rowid": None if last is None else str(last)}}})
    return FakeResp({"results": results})


requests.Session.post = fake_post
turso.time.sleep = lambda *_: None
from app.main import app
from app.services import admin_auth
from fastapi.testclient import TestClient

for dep in (admin_auth.require_admin, getattr(admin_auth, "require_monitor", None)):
    if dep:
        app.dependency_overrides[dep] = lambda: None
client = TestClient(app, raise_server_exceptions=True)
paths = sorted({r.path for r in app.routes if getattr(r, "methods", None) and "GET" in r.methods
                and r.path.startswith("/api/admin") and "{" not in r.path})
logging.disable(logging.CRITICAL)
random.seed(7)
saveP, P = P, 0.0
from app.services import admin_query_cache
for p in paths:  # schemas created, no faults
    try:
        client.get(p)
    except Exception:
        pass
P = saveP
stats.clear()
codes = collections.Counter()
bad = collections.defaultdict(list)
for _ in range(ROUNDS):
    for p in paths:
        with admin_query_cache._lock:
            admin_query_cache._entries.clear()
        try:
            r = client.get(p)
            codes[r.status_code] += 1
        except Exception:
            codes[500] += 1
            bad[p].append(traceback.format_exc().strip().splitlines()[-1][:160])
from app.services import libsql_gate
opened = sum(1 for g in libsql_gate.all_gates() if g["failures"] >= 4)
total = sum(codes.values())
print(f"p={P} {KIND}: requests={total} codes={dict(codes)} fail%={round(100*(total-codes[200]-codes[400])/total,1)} "
      f"round_trips={stats['round_trips']} faults={stats['faults']}")
for p, v in bad.items():
    print("  500", p, v[:2])
