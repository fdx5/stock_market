import pandas as pd
import pytest

from app.data import price_fetcher


@pytest.mark.parametrize("code,source,symbol", [
    ("0158S0", "naver", "NAVER:0158S0"),
    ("00088K", "naver", "NAVER:00088K"),
    ("005930", "naver", "005930"),
    ("AAPL", "yahoo", "AAPL"),
])
def test_domestic_alphanumeric_codes_never_go_to_yahoo(monkeypatch, code, source, symbol):
    calls = []

    def frame():
        return pd.DataFrame({"Open": [100], "High": [110], "Low": [90],
                             "Close": [105], "Volume": [1000]},
                            index=pd.to_datetime(["2026-11-06"]))

    def naver(actual, *args):
        calls.append(("naver", actual))
        return frame()

    def yahoo(actual, *args):
        calls.append(("yahoo", actual))
        return frame()

    monkeypatch.setattr(price_fetcher.fdr, "DataReader", naver)
    monkeypatch.setattr(price_fetcher, "_fetch_yahoo_direct", yahoo)
    result = price_fetcher._load_history(code, 1)
    assert calls == [(source, symbol)]
    assert result.iloc[0]["close"] == 105
    assert result.iloc[0]["date"] == "2026-11-06"
