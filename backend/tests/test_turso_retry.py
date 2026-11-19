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


def test_rows_read_is_tallied_per_statement(monkeypatch):
    class Counted(Resp):
        def json(self):
            body = super().json()
            body["results"][0]["response"]["result"]["rows_read"] = 1234
            return body

    c, _ = _conn(monkeypatch, [Counted()])
    sql = "SELECT  x FROM   rows_read_probe"
    c.execute(sql)
    top = {row["sql"]: row for row in turso.read_stats(400)["top"]}
    assert top["SELECT x FROM rows_read_probe"]["rows_read"] == 1234
    assert top["SELECT x FROM rows_read_probe"]["calls"] == 1
