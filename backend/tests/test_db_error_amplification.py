"""One failed database call must stay one failed call: no schema replay, no resent
writes, no breaker opened by a statement the database merely rejected."""
import pytest
import requests

from app.services import libsql_gate, turso


class Resp:
    def __init__(self, status=200, rows=None, error=None):
        self.status_code = status
        self.text = "upstream forward failed"
        self._rows = rows or []
        self._error = error

    def json(self):
        if self._error:
            return {"results": [{"type": "error", "error": {"message": self._error}}]}
        return {"results": [{"type": "ok", "response": {"type": "execute", "result": {
            "cols": [{"name": "name"}], "rows": [[{"type": "text", "value": r}] for r in self._rows]}}}]}


@pytest.fixture
def conn(monkeypatch):
    monkeypatch.setattr(turso, "_ddl_done", set())
    monkeypatch.setattr(turso, "_table_info", {})
    monkeypatch.setattr(turso.time, "sleep", lambda s: None)
    c = turso.Connection("libsql://amplify.example", "t")
    c.calls = []
    c.outcomes = []

    def post(*a, **k):
        c.calls.append(k["json"]["requests"][0]["stmt"]["sql"])
        o = c.outcomes.pop(0) if c.outcomes else Resp()
        if isinstance(o, Exception):
            raise o
        return o

    monkeypatch.setattr(c._session, "post", post)
    return c


def test_idempotent_schema_is_sent_once_per_process(conn):
    for _ in range(3):
        conn.execute("CREATE TABLE IF NOT EXISTS t (a)")
        conn.execute("CREATE INDEX IF NOT EXISTS i ON t(a)")
    assert len(conn.calls) == 2


def test_failed_schema_statement_is_sent_again(conn):
    conn.outcomes = [Resp(400)]
    with pytest.raises(turso.TursoError):
        conn.execute("CREATE TABLE IF NOT EXISTS t (a)")
    conn.execute("CREATE TABLE IF NOT EXISTS t (a)")
    assert len(conn.calls) == 2


def test_table_info_is_cached_until_an_alter(conn):
    conn.outcomes = [Resp(rows=["a"])]
    assert conn.execute("PRAGMA table_info(t)").fetchall() == [("a",)]
    assert conn.execute("PRAGMA table_info(t)").fetchall() == [("a",)]
    assert len(conn.calls) == 1
    conn.execute("ALTER TABLE t ADD COLUMN b TEXT")
    conn.outcomes = [Resp(rows=["a", "b"])]
    assert conn.execute("PRAGMA table_info(t)").fetchall() == [("a",), ("b",)]
    assert len(conn.calls) == 3


def test_edge_502_is_retried_for_reads_and_writes(conn):
    conn.outcomes = [Resp(502), Resp()]
    conn.execute("SELECT 1")
    conn.outcomes = [Resp(502), Resp()]
    conn.execute("INSERT INTO t VALUES (1)")
    assert len(conn.calls) == 4


def test_a_write_answered_504_is_not_resent(conn):
    conn.outcomes = [Resp(504), Resp()]
    with pytest.raises(turso.TursoUnreachable) as caught:
        conn.execute("INSERT INTO t VALUES (1)")
    assert len(conn.calls) == 1
    assert not turso.should_retry(caught.value)


def test_should_retry():
    assert not turso.should_retry(turso.TursoError("no such column: x"))
    timed_out = turso.TursoUnreachable("Read timed out")
    assert not turso.should_retry(timed_out)
    reset = turso.TursoUnreachable("reset")
    reset.reconnect = True
    assert turso.should_retry(reset)
    assert turso.should_retry(OSError("local sqlite"))


def test_statement_errors_do_not_open_the_breaker():
    gate = libsql_gate.Gate("amplify-test", fail_threshold=2)
    for _ in range(5):
        with pytest.raises(turso.TursoError):
            with gate.hold():
                raise turso.TursoError("UNIQUE constraint failed")
    assert not gate.is_open
    for _ in range(2):
        with pytest.raises(turso.TursoUnreachable):
            with gate.hold():
                raise turso.TursoUnreachable("Read timed out")
    assert gate.is_open
    libsql_gate._registry.remove(gate)
