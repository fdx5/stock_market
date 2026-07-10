import re
from typing import TypedDict

import requests
from bs4 import BeautifulSoup

from app.services.cache import cache

# Business descriptions, share count and consensus PER all barely change; still
# bounded so a one-off bad scrape (or a code that briefly has no data yet)
# recovers within a day rather than being cached as empty forever.
TTL_OVERVIEW_SECONDS = 24 * 60 * 60

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
}


class CompanyInfo(TypedDict):
    overview: list[str]
    per_estimate: str | None
    shares_outstanding: int | None


_EMPTY: CompanyInfo = {"overview": [], "per_estimate": None, "shares_outstanding": None}


def _parse_shares(text: str) -> int | None:
    match = re.search(r"([\d,]+)\s*주", text)
    if not match:
        return None
    return int(match.group(1).replace(",", ""))


def _extract_shares_outstanding(soup: BeautifulSoup) -> int | None:
    # "기업의 기본적인 시세정보" table — row label is "발행주식수/유동비율",
    # e.g. "5,846,278,608주 / 75.74%".
    info_table = soup.select_one("table#cTB11")
    if not info_table:
        return None
    for row in info_table.find_all("tr"):
        label = row.find("th")
        if label and "발행주식수" in label.get_text():
            value = row.find("td")
            return _parse_shares(value.get_text(strip=True)) if value else None
    return None


def _extract_per_estimate(soup: BeautifulSoup) -> str | None:
    # Fundamentals table has two columns: latest actual fiscal year "(A)" and
    # next fiscal year consensus "(E)" — the estimated/forward PER is the (E) one.
    fund_table = soup.select_one("table.gHead03")
    if not fund_table:
        return None
    thead = fund_table.find("thead")
    header_cells = thead.find_all("th") if thead else []
    est_col = next((i - 1 for i, th in enumerate(header_cells) if "(E)" in th.get_text()), None)
    if est_col is None:
        return None
    for row in fund_table.select("tbody tr"):
        label = row.find("th")
        if label and label.get_text(strip=True) == "PER":
            cells = row.find_all("td")
            if 0 <= est_col < len(cells):
                return cells[est_col].get_text(strip=True)
    return None


def _fetch_company_info(code: str) -> CompanyInfo:
    url = f"https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd={code}"
    resp = requests.get(url, headers=HEADERS, timeout=4)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    overview = [
        li.get_text(strip=True)
        for li in soup.select("div.cmp_comment ul.dot_cmp li.dot_cmp")
        if li.get_text(strip=True)
    ][:3]

    return {
        "overview": overview,
        "per_estimate": _extract_per_estimate(soup),
        "shares_outstanding": _extract_shares_outstanding(soup),
    }


def get_company_info(code: str) -> CompanyInfo:
    key = f"company_info:{code}"
    try:
        return cache.get_or_set(key, TTL_OVERVIEW_SECONDS, lambda: _fetch_company_info(code))
    except Exception:
        return _EMPTY
