import pytest
import requests

from app.services import turso


class Resp:
    status_code = 200

    def json(self):
        return {"results": [{"type": "ok", "response": {"type": "execute", "result": {"cols": [{"name": "x"}], "rows": [[{"type": "integer", "value": "1"}]]}}}]}


def _conn(monkeypatch, outcomes):
    c = turso.Connection("libsql://example.turso.io", "t")
    calls = []

    def post(*a, **k):
        calls.append(1)
        o = outcomes[len(calls) - 1]
        if isinstance(o, Exception):
            raise o
        return o

    monkeypatch.setattr(c._session, "post", post)
    monkeypatch.setattr(turso.time, "sleep", lambda s: None)
    return c, calls


def test_a_read_that_times_out_is_tried_once_more(monkeypatch):
    c, calls = _conn(monkeypatch, [requests.ReadTimeout("slow"), Resp()])
    assert c.execute("SELECT 1").fetchall() == [(1,)]
    assert len(calls) == 2


def test_a_write_that_times_out_is_not_resent(monkeypatch):
    c, calls = _conn(monkeypatch, [requests.ReadTimeout("slow"), Resp()])
    with pytest.raises(turso.TursoError):
        c.execute("INSERT INTO t VALUES (1)")
    assert len(calls) == 1


def test_a_connection_that_never_opened_is_retried_even_for_a_write(monkeypatch):
    c, calls = _conn(monkeypatch, [requests.ConnectTimeout("no route"), Resp()])
    c.execute("INSERT INTO t VALUES (1)")
    assert len(calls) == 2
