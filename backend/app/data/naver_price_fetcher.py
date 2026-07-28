import re
from urllib.parse import parse_qs, urlparse

import requests
from bs4 import BeautifulSoup

# Shared by any feature that needs a live KOSPI market-cap-ranked snapshot (the KOSPI
# MAP treemap, the top-100 prediction panel's live price column, etc). Each caller owns
# its own cache tier on top of this — this module only knows how to fetch and parse one
# page of https://finance.naver.com/sise/sise_market_sum.naver.
NAVER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://finance.naver.com/",
}
NAVER_PAGE_SIZE = 50
CHANGE_WORD_SIGN = {"상승": 1, "하락": -1, "보합": 0}

# A shared, connection-pooled session avoids paying a fresh TCP/TLS handshake for each
# of the (potentially many) page requests a cold fetch makes to the same host.
_session = requests.Session()
_session.headers.update(NAVER_HEADERS)
_session.mount(
    "https://",
    requests.adapters.HTTPAdapter(pool_connections=10, pool_maxsize=20, max_retries=1),
)


def _parse_change(text: str) -> float:
    match = re.match(r"(상승|하락|보합)([\d,]+)", text)
    if not match:
        return 0.0
    sign = CHANGE_WORD_SIGN[match.group(1)]
    return sign * float(match.group(2).replace(",", ""))


def _parse_number(text: str) -> float:
    cleaned = text.replace(",", "").replace("%", "").strip()
    return float(cleaned) if cleaned else 0.0


def _parse_optional(text: str) -> float | None:
    """For the fundamentals columns, where "N/A" is a real answer rather than a parse
    failure — a loss-making company genuinely has no PER, and reporting that as 0.0
    (what `_parse_number` would give) would rank it as the cheapest stock on the board.
    """
    cleaned = text.replace(",", "").replace("%", "").strip()
    try:
        return float(cleaned)
    except ValueError:
        return None


def fetch_market_cap_page(page: int, sosok: int = 0) -> list[dict]:
    """One page (50 rows) of the market-cap ranking, live — `sosok=0` for KOSPI,
    `sosok=1` for KOSDAQ. Includes ETFs — callers that need companies only should
    cross-reference StockListing('ETF/KR')."""
    url = f"https://finance.naver.com/sise/sise_market_sum.naver?sosok={sosok}&page={page}"
    resp = _session.get(url, timeout=4)
    resp.raise_for_status()
    resp.encoding = "euc-kr"
    soup = BeautifulSoup(resp.text, "html.parser")

    table = soup.select_one("table.type_2")
    if table is None:
        return []

    rows = []
    for tr in table.select("tr"):
        link = tr.select_one("a.tltle")
        if not link:
            continue
        code = parse_qs(urlparse(link.get("href", "")).query).get("code", [None])[0]
        if not code:
            continue

        cells = [td.get_text(strip=True) for td in tr.select("td")]
        if len(cells) < 7:
            continue

        try:
            row = {
                "code": code,
                "name": link.get_text(strip=True),
                "close": _parse_number(cells[2]),
                "change": _parse_change(cells[3]),
                "change_pct": _parse_number(cells[4]),
                "marcap": _parse_number(cells[6]) * 100_000_000,  # 억원 -> 원
            }
            # The default column set carries 상장주식수 / 외국인비율 / 거래량 / PER / ROE
            # to the right of 시가총액 — free with the page this scrape is already
            # paying for, which is why the board cards can show fundamentals without a
            # second request per stock. Optional rather than assumed: the column set is
            # user-configurable on Naver's side, so a page served with a narrower table
            # still yields a valid price row instead of failing to parse at all.
            if len(cells) >= 12:
                row.update(
                    {
                        "shares": _parse_number(cells[7]) * 1_000,  # 천주 -> 주
                        "foreign_ratio": _parse_optional(cells[8]),
                        "volume": _parse_number(cells[9]),
                        "per": _parse_optional(cells[10]),
                        "roe": _parse_optional(cells[11]),
                    }
                )
            rows.append(row)
        except (ValueError, IndexError):
            continue
    return rows
