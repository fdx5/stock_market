"""Every KRX-listed ETF, from Naver Finance's ETF list (about 1,200 funds).

The curated KR_ETFS table (etf_market) drives the ETF ranking pages and is a couple
of dozen funds. Search and the detail lookup need the whole market, so they fall
back to this list. Memory only, refreshed daily, with a back-off on failure so an
outage costs one slow search, not every keystroke.
"""

import json
import logging
import time

import requests

from app.services.cache import cache

logger = logging.getLogger(__name__)

SOURCE_URL = "https://finance.naver.com/api/sise/etfItemList.nhn?etfType=0&targetColumn=market_sum&sortOrder=desc"
TTL_SECONDS = 24 * 3600
RETRY_AFTER_SECONDS = 600
_failed_at: float | None = None


def parse(payload: bytes) -> list[dict]:
    data = json.loads(payload.decode("euc-kr", errors="replace"))
    rows = []
    for item in data.get("result", {}).get("etfItemList", []):
        code, name = str(item.get("itemcode") or "").strip(), str(item.get("itemname") or "").strip()
        if code and name:
            rows.append({"code": code.upper(), "name": name})
    return rows


def _load() -> list[dict]:
    response = requests.get(SOURCE_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=(5, 20))
    response.raise_for_status()
    rows = parse(response.content)
    if len(rows) < 300:
        raise ValueError(f"KR ETF list looks truncated ({len(rows)} rows)")
    return rows


def get_listings() -> list[dict]:
    global _failed_at
    cached = cache.peek("kr_etf_directory", max_stale_seconds=7 * 24 * 3600)
    if _failed_at is not None and time.monotonic() - _failed_at < RETRY_AFTER_SECONDS:
        return cached or []
    try:
        rows = cache.get_or_set("kr_etf_directory", TTL_SECONDS, _load)
        _failed_at = None
        return rows
    except Exception as exc:  # noqa: BLE001 - an outage must not break search
        _failed_at = time.monotonic()
        logger.warning("kr_etf_directory: fetch failed (%s)", exc)
        return cached or []


def lookup(code: str) -> dict | None:
    code = code.strip().upper()
    return next((row for row in get_listings() if row["code"] == code), None)


def search(query: str, limit: int) -> list[dict]:
    """Code or name contains `query` (case- and space-insensitive), exact code first.
    The list is already ordered by market cap, which is kept as the tiebreak."""
    needle = query.strip().casefold().replace(" ", "")
    if not needle or limit <= 0:
        return []
    hits = [
        row for row in get_listings()
        if needle in row["code"].casefold() or needle in row["name"].casefold().replace(" ", "")
    ]
    hits.sort(key=lambda r: r["code"].casefold() != needle)
    return hits[:limit]
