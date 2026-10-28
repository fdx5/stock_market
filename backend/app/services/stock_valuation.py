"""Read-only PBR feeds for stock details, cached in process memory only."""
import datetime as dt
import logging
import math

import requests

from app.data import korea_fundamentals_fetcher as korea, yahoo_batch_transport
from app.services.cache import cache

logger = logging.getLogger(__name__)
TTL_SECONDS = 300


def _positive(value) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def _fetch(code: str, us: bool) -> dict:
    period = None
    basis = "provider"
    if us:
        symbol = code.replace(".", "-")
        rows = yahoo_batch_transport.fetch_rows([symbol])
        row = next((row for row in rows if row.get("symbol", "").upper() == symbol), None)
        if row is None:
            raise ValueError("No valuation row")
        bps = _positive(row.get("bookValue"))
        pbr = _positive(row.get("priceToBook"))
        if pbr is None and row.get("priceToBook") is None and bps:
            price = _positive(row.get("regularMarketPrice"))
            if price:
                pbr = _positive(price / bps)
                basis = "regular_price_to_book"
        source = "Yahoo Finance"
    else:
        with requests.get(korea.INTEGRATION_URL.format(code=code), headers=korea.HEADERS, timeout=8) as response:
            response.raise_for_status()
            infos = {item.get("code"): item for item in response.json().get("totalInfos", [])}
        pbr_info = infos.get("pbr", {})
        pbr = _positive(korea._number(pbr_info.get("value")))
        bps = _positive(korea._number(infos.get("bps", {}).get("value")))
        period = pbr_info.get("valueDesc") or None
        source = "Naver Finance"
    return {"code": code, "pbr": pbr, "bps": bps, "period": period,
            "source": source, "basis": basis, "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}


def get_stock_valuation(code: str, *, us: bool = False) -> dict:
    code = code.strip().upper()
    try:
        return cache.get_or_set(f"stock_valuation:{'us' if us else 'kr'}:{code}", TTL_SECONDS, lambda: _fetch(code, us))
    except Exception as error:
        logger.info("Stock valuation unavailable: code=%s error=%s", code, type(error).__name__)
        return {"code": code, "pbr": None, "bps": None, "period": None,
                "source": None, "basis": None, "fetched_at": None}
