from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.data.stock_quote_fetcher import _quote_from_data  # noqa: E402


def _payload(status: str = "PREOPEN") -> dict:
    return {
        "itemCode": "005930",
        "stockName": "삼성전자",
        "marketStatus": status,
        "closePriceRaw": "250500",
        "compareToPreviousClosePriceRaw": "0",
        "fluctuationsRatioRaw": "0.00",
        "marketValueFullRaw": "1495426000000000",
        "accumulatedTradingVolumeRaw": "",
        "accumulatedTradingValueRaw": "",
        "openPriceRaw": "0",
        "highPriceRaw": "0",
        "lowPriceRaw": "0",
        "overMarketPriceInfo": {
            "overPrice": "255,000",
            "compareToPreviousClosePrice": "4,500",
            "fluctuationsRatio": "1.80",
            "accumulatedTradingVolumeRaw": "1318174",
            "accumulatedTradingValueRaw": "335277000000",
        },
    }


def test_pre_market_uses_one_consistent_nxt_tape():
    quote = _quote_from_data(_payload())

    assert quote["close"] == 255000
    assert quote["change_pct"] == 1.8
    assert quote["volume"] == 1_318_174
    assert quote["turnover"] == 335_277_000_000


def test_regular_market_does_not_mix_in_nxt_fields():
    payload = _payload("OPEN")
    payload["accumulatedTradingVolumeRaw"] = "777"
    payload["accumulatedTradingValueRaw"] = "888000"

    quote = _quote_from_data(payload)

    assert quote["close"] == 250500
    assert quote["volume"] == 777
    assert quote["turnover"] == 888000
