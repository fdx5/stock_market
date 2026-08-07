"""EPS/PER for KRX-listed companies, from Naver Finance's mobile integration API.

Exists because Yahoo's quoteSummary — which supplies fundamentals for every other
company on the 글로벌 시가총액 TOP 100 page (see company_fundamentals_fetcher.py) —
answers 200 for `.KS`/`.KQ` symbols with those two fields present but *empty*:
`defaultKeyStatistics.trailingEps` comes back as `{}` and `summaryDetail` has no
`trailingPE` key at all, while sector, profit margin and the analyst rating in the
same response are fine. So the gap is specific and narrow, and this fills exactly it
rather than replacing the Yahoo path.

Naver is already this app's source for every other piece of Korean market data
(stock_quote_fetcher, naver_price_fetcher, company_overview_fetcher), so this adds a
vendor the deployment already depends on rather than a new one.
"""

import logging
import re

import requests

logger = logging.getLogger(__name__)

INTEGRATION_URL = "https://m.stock.naver.com/api/stock/{code}/integration"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://m.stock.naver.com/",
}

# The Yahoo symbols this can answer for: a six-digit KRX code on either board.
KRX_SYMBOL = re.compile(r"^(\d{6})\.(KS|KQ)$")

# Naver's own field codes inside `totalInfos`, mapped to the names this app's
# fundamentals dict already uses. `cnsPer` is the analyst-consensus forward PER,
# which is what Yahoo's forwardPE is too.
_FIELDS = {"eps": "trailing_eps", "per": "trailing_pe", "cnsPer": "forward_pe"}


def krx_code(symbol: str) -> str | None:
    """The bare six-digit code for a KRX Yahoo symbol, or None for anything else."""
    match = KRX_SYMBOL.match(symbol or "")
    return match.group(1) if match else None


def _number(text) -> float | None:
    """Naver ships these as display strings with their unit attached — '12,372원',
    '18.67배', and '-1,234원' when a company is losing money. Anything without a digit
    in it (Naver uses '-' and 'N/A' for "no figure") reads as no value rather than as
    zero, which for a PER would be a very different claim."""
    if not isinstance(text, str):
        return None
    cleaned = re.sub(r"[^\d.\-]", "", text)
    if not re.search(r"\d", cleaned):
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def fetch_korea_fundamentals(code: str) -> dict:
    """EPS/PER/forward PER for one six-digit KRX code. Returns only the keys it
    actually found, so a caller can update() a dict with it without overwriting
    good values with None."""
    try:
        resp = requests.get(INTEGRATION_URL.format(code=code), headers=HEADERS, timeout=8)
        resp.raise_for_status()
        infos = resp.json().get("totalInfos") or []
    except Exception:
        logger.warning("korea_fundamentals_fetcher: failed for %s", code, exc_info=True)
        return {}

    out: dict[str, float] = {}
    for info in infos:
        field = _FIELDS.get(info.get("code"))
        if not field:
            continue
        value = _number(info.get("value"))
        if value is not None:
            out[field] = value
    return out
