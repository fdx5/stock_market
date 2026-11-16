"""Feed parsing only, with mocked HTTP and clock. No databases or app startup."""
from app.data import index_fetcher


def test_net_flow_metadata_keeps_source_precision_and_business_date(monkeypatch):
    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {"dealTrendInfo": {
                "bizdate": "20261116", "personalValue": "+6,256",
                "foreignValue": "-9,116", "institutionalValue": "+1,235",
            }}

    monkeypatch.setattr(index_fetcher.requests, "get", lambda *args, **kwargs: Response())
    monkeypatch.setattr(index_fetcher.time, "time", lambda: 1794790800.0)
    assert index_fetcher._fetch_market_investor("KOSPI") == {
        "individual_amount": 6256.0,
        "foreign_amount": -9116.0,
        "institution_amount": 1235.0,
        "business_date": "20261116",
        "fetched_at": 1794790800.0,
    }
