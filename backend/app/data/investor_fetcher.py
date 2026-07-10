import requests

from app.services.cache import cache

# Investor buy/sell breakdown is only published as a completed-day figure — there is no
# free source for intraday (let alone 30-second) ticks of this data, so a long TTL is
# fine; it won't change again until the next session closes.
TTL_INVESTOR_SECONDS = 30 * 60

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://m.stock.naver.com/",
}


def _parse_num(text: str) -> float:
    return float(str(text).replace(",", "").replace("+", ""))


def _fetch_investor_trend(code: str, page_size: int) -> list[dict]:
    url = (
        f"https://m.stock.naver.com/front-api/stock/domestic/trend"
        f"?code={code}&marketType=KRX&pageSize={page_size}"
    )
    resp = requests.get(url, headers=HEADERS, timeout=4)
    resp.raise_for_status()
    payload = resp.json()
    if not payload.get("isSuccess"):
        return []

    records = []
    for row in payload.get("result") or []:
        try:
            close = _parse_num(row["closePrice"])
            foreigner_qty = _parse_num(row["foreignerPureBuyQuant"])
            organ_qty = _parse_num(row["organPureBuyQuant"])
            individual_qty = _parse_num(row["individualPureBuyQuant"])
            bizdate = row["bizdate"]
        except (KeyError, ValueError):
            continue

        # Naver only publishes net *quantity* by investor type, not net amount — the
        # 억원 figure here is quantity x that day's close, a standard approximation
        # when the true volume-weighted trade price isn't available.
        records.append(
            {
                "date": f"{bizdate[:4]}-{bizdate[4:6]}-{bizdate[6:]}",
                "close": close,
                "change": _parse_num(row.get("compareToPreviousClosePrice", "0")),
                "individual_amount": round(individual_qty * close / 100_000_000, 1),
                "institution_amount": round(organ_qty * close / 100_000_000, 1),
                "foreign_amount": round(foreigner_qty * close / 100_000_000, 1),
            }
        )
    return records


def get_investor_trend(code: str, page_size: int = 20) -> list[dict]:
    key = f"investor_trend:{code}:{page_size}"
    try:
        return cache.get_or_set(key, TTL_INVESTOR_SECONDS, lambda: _fetch_investor_trend(code, page_size))
    except Exception:
        return []
