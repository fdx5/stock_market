from app.services import etf_market


def test_us_etf_build_fills_missing_batch_quotes_from_chart(monkeypatch):
    batch_quote = {
        "close": 100.0, "change": 1.0, "change_pct": 1.0, "volume": 10,
        "average_volume": 10, "currency": "USD", "session": "regular",
    }
    fallback_quote = {
        "close": 50.0, "change": -1.0, "change_pct": -1.96, "volume": 20,
        "average_volume": 0, "currency": "USD", "session": "post",
    }
    monkeypatch.setattr(etf_market, "US_ETFS", [
        ("SPY", "SPY", "S&P 500", "index"),
        ("QQQ", "QQQ", "NASDAQ 100", "index"),
    ])
    monkeypatch.setattr(etf_market, "get_quotes", lambda codes: {"SPY": batch_quote})
    monkeypatch.setattr(
        etf_market, "_us_chart_fallback_quotes", lambda codes: {"QQQ": fallback_quote}
    )
    monkeypatch.setattr(etf_market, "_history", lambda region, codes: {})
    monkeypatch.setattr(etf_market, "resolve_naver_suffix", lambda code: "O")

    result = etf_market._build("US")

    assert {item["code"] for item in result["items"]} == {"SPY", "QQQ"}
    assert next(item for item in result["items"] if item["code"] == "SPY")["close"] == 100.0
    assert next(item for item in result["items"] if item["code"] == "QQQ")["close"] == 50.0


def test_us_etf_build_recovers_when_batch_is_completely_empty(monkeypatch):
    monkeypatch.setattr(etf_market, "US_ETFS", [("SPY", "SPY", "S&P 500", "index")])
    monkeypatch.setattr(etf_market, "get_quotes", lambda codes: {})
    monkeypatch.setattr(etf_market, "_us_chart_fallback_quotes", lambda codes: {
        "SPY": {
            "close": 101.0, "change": 1.0, "change_pct": 1.0, "volume": 100,
            "average_volume": 0, "currency": "USD", "session": "pre",
        }
    })
    monkeypatch.setattr(etf_market, "_history", lambda region, codes: {})
    monkeypatch.setattr(etf_market, "resolve_naver_suffix", lambda code: "O")

    result = etf_market._build("US")

    assert len(result["items"]) == 1
    assert result["items"][0]["code"] == "SPY"
