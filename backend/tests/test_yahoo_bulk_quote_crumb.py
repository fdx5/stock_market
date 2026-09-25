import logging

from app.data import yahoo_bulk_quote as yb
from app.data import yahoo_session as ys


def test_no_second_host_and_no_warning_while_the_crumb_is_unavailable(monkeypatch, caplog):
    calls = []

    def unavailable(url, symbols, retry=True):
        calls.append(url)
        raise ys.CrumbUnavailable("getcrumb cooling down for another 300s")

    monkeypatch.setattr(yb, "_fetch_chunk_from", unavailable)
    monkeypatch.setattr(ys, "cooling_down", lambda: False)
    with caplog.at_level(logging.WARNING):
        assert yb.get_quotes(["AAPL", "MSFT"]) == {}
    assert calls == [yb.QUOTE_URLS[0]]  # query2 not tried with the same dead crumb
    assert "quote host failed" not in caplog.text


def test_cooling_down_skips_the_request_entirely(monkeypatch):
    monkeypatch.setattr(ys, "cooling_down", lambda: True)
    monkeypatch.setattr(yb, "_fetch_chunk", lambda chunk: (_ for _ in ()).throw(AssertionError("called")))
    assert yb.get_quotes(["AAPL"]) == {}
