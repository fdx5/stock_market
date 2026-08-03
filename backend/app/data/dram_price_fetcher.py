import re

import requests
from bs4 import BeautifulSoup

# TrendForce's public DRAM spot-price table (same "session average" figures
# DRAMeXchange itself publishes - TrendForce owns it). No login required.
URL = "https://www.trendforce.com/price/dram/dram_spot"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
}

_TREND_SIGN = {"rise-trend": 1, "fall-trend": -1, "flat-trend": 0}
_PRICE_DATE_RE = re.compile(r"Last Update\s+(\d{4}-\d{2}-\d{2})")
_PCT_RE = re.compile(r"([\d.]+)\s*%")


def _to_float(text: str) -> float:
    return float(text.strip().replace(",", ""))


def _row_item(tr) -> dict | None:
    """One <tr> of the spot-price table -> {item_name, price, daily_high, daily_low,
    change_pct}, or None for a row that doesn't parse as a price row. The `History`
    column (a link to TrendForce's own chart) is deliberately never read - a per-item
    trend is something this app builds up from its own daily snapshots, not something
    scraped from theirs."""
    cells = tr.find_all("td")
    if len(cells) < 7:
        return None

    name_span = cells[0].find("span")
    item_name = (name_span or cells[0]).get_text(strip=True)
    if not item_name:
        return None

    try:
        daily_high = _to_float(cells[1].get_text())
        daily_low = _to_float(cells[2].get_text())
        # Session High/Low sit at cells[3]/[4]; the table's own "Session Average" is
        # the single representative print this app tracks per item per day.
        session_avg = _to_float(cells[5].get_text())
    except ValueError:
        return None

    change_cell = cells[6]
    trend_span = change_cell.find("span", class_=re.compile(r"(rise|fall|flat)-trend"))
    sign = 0
    if trend_span:
        classes = trend_span.get("class") or []
        for cls, s in _TREND_SIGN.items():
            if cls in classes:
                sign = s
                break
    pct_match = _PCT_RE.search(change_cell.get_text())
    change_pct = sign * float(pct_match.group(1)) if pct_match else 0.0

    return {
        "item_name": item_name,
        "price": session_avg,
        "daily_high": daily_high,
        "daily_low": daily_low,
        "change_pct": change_pct,
    }


def fetch_dram_spot_prices() -> dict:
    """Scrapes the "DRAM Spot Price" table: item name, session-average price, daily
    high/low, and the signed day-over-day change TrendForce itself computes. Raises on
    any failure (network, or the page no longer matching this shape) so the daily batch
    can tell "scrape failed" apart from "ran, found nothing new" instead of silently
    storing an empty day.
    """
    resp = requests.get(URL, headers=HEADERS, timeout=10)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")

    section = soup.find("div", id="dram_spot")
    if section is None:
        raise ValueError("dram_spot 섹션을 찾을 수 없습니다 (페이지 구조가 바뀌었을 수 있습니다)")

    update_el = section.find("div", class_="price-last-update")
    date_match = _PRICE_DATE_RE.search(update_el.get_text()) if update_el else None
    if not date_match:
        raise ValueError("Last Update 날짜를 파싱하지 못했습니다")
    price_date = date_match.group(1)

    table = section.find("table", class_="price-table")
    tbody = table.find("tbody") if table else None
    rows = tbody.find_all("tr") if tbody else []
    items = [parsed for tr in rows if (parsed := _row_item(tr)) is not None]
    if not items:
        raise ValueError("DRAM 현물가격 항목을 하나도 파싱하지 못했습니다")

    return {"price_date": price_date, "items": items}
