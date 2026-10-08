import pytest
from app.data import company_fundamentals_fetcher as fundamentals
from app.data import yahoo_session as auth
from test_yahoo_batch_transport import Session, response


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setattr(fundamentals, '_summary_retry_at', 0)
    monkeypatch.setattr(fundamentals, '_fill_korea_gaps', lambda symbol, fields: fields)


def test_same_rejected_credential_is_not_retried_for_every_company(monkeypatch, caplog):
    session = Session(lambda *args: response(401))
    monkeypatch.setattr(auth, 'get_crumb', lambda force_refresh=False: (session, 'fixture'))
    for _ in range(20): assert fundamentals.fetch_fundamentals('AAPL') == fundamentals._EMPTY_FIELDS
    assert len(session.calls) == 1 and not caplog.text


def test_replaced_auth_recovers_and_parses_fundamentals(monkeypatch):
    old = Session(lambda *args: response(401))
    new = Session(lambda *args: response(payload={'quoteSummary': {'result': [{'assetProfile': {'sector': 'Technology'}}]}}))
    monkeypatch.setattr(auth, 'get_crumb', lambda force_refresh=False: (new, 'new') if force_refresh else (old, 'old'))
    assert fundamentals.fetch_fundamentals('AAPL')['sector'] == 'Technology'
    assert len(old.calls) == len(new.calls) == 1


def test_rate_limit_stops_summary_requests_and_respects_retry_after(monkeypatch):
    monkeypatch.setattr(fundamentals.time, 'monotonic', lambda: 1000)
    session = Session(lambda *args: response(429, headers={'Retry-After': '1800'}))
    monkeypatch.setattr(auth, 'get_crumb', lambda force_refresh=False: (session, 'fixture'))
    for _ in range(20): fundamentals.fetch_fundamentals('AAPL')
    assert len(session.calls) == 1 and fundamentals._summary_retry_at == 2800
