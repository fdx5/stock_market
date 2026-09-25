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


def test_a_rejected_crumb_is_dropped_even_when_no_new_one_can_be_had(monkeypatch):
    import time

    monkeypatch.setattr(ys, "_session", object())
    monkeypatch.setattr(ys, "_crumb", "dead")
    monkeypatch.setattr(ys, "_crumb_at", time.time() - 600)
    monkeypatch.setattr(ys, "_blocked_until", time.time() + 300)
    try:
        ys.get_crumb(force_refresh=True)
        raise AssertionError("expected CrumbUnavailable")
    except ys.CrumbUnavailable:
        pass
    # The dead crumb is gone, so callers now see the cooldown instead of resending it.
    assert ys._crumb is None
    assert ys.cooling_down() is True


def test_global_top100_skips_quietly_while_cooling_down(monkeypatch, caplog):
    from app.data import global_top100_batch_quote as gq

    monkeypatch.setattr(ys, "cooling_down", lambda: True)
    monkeypatch.setattr(gq, "_fetch_chunk", lambda chunk: (_ for _ in ()).throw(AssertionError("called")))
    with caplog.at_level(logging.WARNING):
        assert gq.fetch_live_quotes(["AAPL", "MSFT"]) == {}
    assert caplog.text == ""


def test_global_top100_stops_at_the_first_unavailable_crumb_without_a_traceback(monkeypatch, caplog):
    from app.data import global_top100_batch_quote as gq

    calls = []

    def unavailable(chunk):
        calls.append(chunk)
        raise ys.CrumbUnavailable("getcrumb cooling down for another 300s")

    monkeypatch.setattr(ys, "cooling_down", lambda: False)
    monkeypatch.setattr(gq, "_fetch_chunk", unavailable)
    with caplog.at_level(logging.WARNING):
        assert gq.fetch_live_quotes([f"S{i}" for i in range(120)]) == {}
    assert len(calls) == 1
    assert "chunk fetch failed" not in caplog.text
