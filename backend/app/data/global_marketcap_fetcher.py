import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
}

BASE_URL = "https://companiesmarketcap.com"


def get_global_top20() -> list[dict]:
    """Top 20 companies worldwide by market cap, scraped from companiesmarketcap.com's
    homepage table. No live per-second feed exists for this globally, so callers should
    cache this for a while — the composition/values don't need sub-minute freshness."""
    resp = requests.get(BASE_URL + "/", headers=HEADERS, timeout=10)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    # Over-fetch a few extra rows: an occasional non-data row in the table body (ads,
    # upsells) would otherwise shift a real row past a hard rows[:20] cutoff.
    rows = soup.select("table.marketcap-table tbody tr")
    items: list[dict] = []
    for tr in rows[:30]:
        if len(items) >= 20:
            break

        rank_td = tr.select_one("td.rank-td")
        if not rank_td:
            continue

        name_el = tr.select_one(".company-name")
        code_el = tr.select_one(".company-code")
        logo_el = tr.select_one("img.company-logo")
        flag_el = tr.select_one("img.flag")
        country_el = tr.select_one(".responsive-hidden")
        # The rank cell also carries the "td-right" class, so market cap is the
        # *second* td-right cell in the row (rank, then market cap, then price).
        mcap_tds = [td for td in tr.select("td.td-right") if "rank-td" not in td.get("class", [])]
        change_td = tr.select_one("td.rh-sm")

        try:
            rank = int(rank_td.get_text(strip=True))
            marcap_usd = float(mcap_tds[0]["data-sort"])
        except (ValueError, IndexError, KeyError, TypeError):
            continue

        change_pct = None
        if change_td and change_td.get("data-sort") is not None:
            try:
                change_pct = float(change_td["data-sort"]) / 100
            except (ValueError, KeyError):
                change_pct = None

        items.append(
            {
                "rank": rank,
                "name": name_el.get_text(strip=True) if name_el else "",
                "code": code_el.get_text(strip=True) if code_el else "",
                "logo_url": BASE_URL + logo_el["src"] if logo_el and logo_el.get("src") else None,
                "marcap_usd": marcap_usd,
                "change_pct": change_pct,
                "flag_url": BASE_URL + flag_el["src"] if flag_el and flag_el.get("src") else None,
                "country": country_el.get_text(strip=True) if country_el else "",
            }
        )
    return items
