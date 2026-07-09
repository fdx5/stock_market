import requests
from bs4 import BeautifulSoup

from app.services.cache import cache

# Business descriptions barely change; still bounded so a one-off bad scrape
# (or a code that briefly has no data yet) recovers within a day rather than
# being cached as empty forever.
TTL_OVERVIEW_SECONDS = 24 * 60 * 60

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
}


def _fetch_overview(code: str) -> list[str]:
    url = f"https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd={code}"
    resp = requests.get(url, headers=HEADERS, timeout=8)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    lines = [
        li.get_text(strip=True)
        for li in soup.select("div.cmp_comment ul.dot_cmp li.dot_cmp")
        if li.get_text(strip=True)
    ]
    return lines[:3]


def get_company_overview(code: str) -> list[str]:
    key = f"company_overview:{code}"
    try:
        return cache.get_or_set(key, TTL_OVERVIEW_SECONDS, lambda: _fetch_overview(code))
    except Exception:
        return []
