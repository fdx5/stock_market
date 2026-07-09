from concurrent.futures import ThreadPoolExecutor, as_completed

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
    homepage table. This table's own composition/values barely move between requests a
    few seconds apart — it reads as a periodic snapshot rather than a tick-by-tick feed
    — so callers wanting intraday movement should overlay `get_live_quotes_bulk` on top
    of the `price`/`marcap_usd` pair returned here rather than relying on this alone."""
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
        detail_link_el = tr.select_one(".name-div a")
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
                "detail_path": detail_link_el["href"] if detail_link_el and detail_link_el.get("href") else None,
            }
        )
    return items


def _fetch_live_quote(symbol: str) -> dict | None:
    """Live-ish intraday price for one ticker via Yahoo Finance's chart endpoint — the
    v7/v10 quote endpoints now require an auth crumb we don't have, but this one still
    answers without auth and includes `previousClose`, letting us compute change% the
    same way Yahoo itself does."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1m&range=1d"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=8)
        resp.raise_for_status()
        meta = resp.json()["chart"]["result"][0]["meta"]
        price = meta.get("regularMarketPrice")
        previous_close = meta.get("previousClose")
        if price is None or previous_close is None:
            return None
        return {"price": float(price), "previous_close": float(previous_close)}
    except Exception:
        return None


def get_live_quotes_bulk(symbols: list[str]) -> dict[str, dict]:
    """Live quotes for many tickers at once. Yahoo's chart endpoint only takes one
    symbol per request (unlike the quote endpoint, it doesn't need a crumb), so this
    fans requests out over a thread pool instead of a single batched call. A symbol
    that fails to resolve is just omitted — callers should fall back to their own
    last-known value for it."""
    quotes: dict[str, dict] = {}
    if not symbols:
        return quotes

    with ThreadPoolExecutor(max_workers=min(10, len(symbols))) as pool:
        futures = {pool.submit(_fetch_live_quote, symbol): symbol for symbol in symbols}
        for future in as_completed(futures):
            symbol = futures[future]
            quote = future.result()
            if quote:
                quotes[symbol] = quote
    return quotes


def get_company_detail(detail_path: str) -> dict | None:
    """Short company description from a companiesmarketcap.com detail page (e.g.
    "/nvidia/marketcap/"). Only the first couple of paragraphs are kept — this is
    meant as a brief blurb for a popup, not the full page."""
    if not detail_path.startswith("/") or ".." in detail_path:
        return None

    resp = requests.get(BASE_URL + detail_path, headers=HEADERS, timeout=10)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    container = soup.select_one(".company-description")
    paragraphs = container.select("p") if container else []
    if paragraphs:
        description = " ".join(p.get_text(strip=True) for p in paragraphs[:2])
    elif container:
        # Some pages (e.g. Samsung's) put the text directly in the container with no
        # <p> wrapper at all.
        description = container.get_text(" ", strip=True)
    else:
        # A few companies (e.g. SK Hynix) have no description section at all — fall
        # back to the page's meta description, which is at least a one-line summary.
        meta = soup.select_one('meta[name="description"]')
        description = meta["content"].strip() if meta and meta.get("content") else ""

    return {"description": description}
