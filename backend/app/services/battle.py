from app.data import global_marketcap_fetcher
from app.data.exchange_fetcher import get_usd_krw
from app.data.global_marketcap_fetcher import get_company_detail, get_global_top20, get_live_quotes_bulk
from app.data.stock_quote_fetcher import get_stock_quote, get_stock_quotes_bulk
from app.data.translate_fetcher import translate_to_korean
from app.services.cache import cache

SAMSUNG_CODE = "005930"
SKHYNIX_CODE = "000660"

TTL_BATTLE_SECONDS = 3
TTL_EXCHANGE_SECONDS = 3
# The companiesmarketcap.com scrape itself barely moves within seconds of a repeat
# request — it reads as a periodic snapshot, not a live feed — so its ranking/logos/
# composition are cached generously, and freshness instead comes from overlaying Yahoo
# Finance quotes (see get_live_quotes_bulk) on a much shorter cache below.
TTL_GLOBAL_TOP20_SNAPSHOT_SECONDS = 5 * 60
TTL_GLOBAL_TOP20_QUOTES_SECONDS = 10
TTL_COMPANY_DETAIL_SECONDS = 60 * 60


def _fetch_battle() -> dict:
    return {
        "samsung": get_stock_quote(SAMSUNG_CODE),
        "skhynix": get_stock_quote(SKHYNIX_CODE),
    }


def get_battle() -> dict:
    return cache.get_or_set("battle_marketcap", TTL_BATTLE_SECONDS, _fetch_battle)


def get_exchange_rate() -> dict | None:
    return cache.get_or_set("battle_usd_krw", TTL_EXCHANGE_SECONDS, get_usd_krw)


def _get_global_top20_snapshot() -> list[dict]:
    return cache.get_or_set("global_top20_snapshot", TTL_GLOBAL_TOP20_SNAPSHOT_SECONDS, get_global_top20)


def get_global_top20_cached() -> list[dict]:
    items = _get_global_top20_snapshot()
    codes = [it["code"] for it in items if it.get("code")]

    # The roster's two Korean tickers (Samsung/SK Hynix, "NNNNNN.KS") get overlaid from
    # Naver's NXT-aware quote instead of Yahoo: Yahoo's regular-session price freezes at
    # the 15:30 KRX close and has no visibility into NXT's continued pre-/after-hours
    # trading, so picking either of them as a /fight combatant outside regular hours
    # would otherwise silently stop updating — unlike every other place in this app that
    # shows these two (the dedicated battle page, dashboard, KOSPI/KOSDAQ maps), which
    # already read from stock_quote_fetcher for exactly this reason.
    krx_codes = [c[: -len(".KS")] for c in codes if c.endswith(".KS")]
    other_symbols = [c for c in codes if not c.endswith(".KS")]

    quotes = cache.get_or_set(
        "global_top20_quotes", TTL_GLOBAL_TOP20_QUOTES_SECONDS, lambda: get_live_quotes_bulk(other_symbols)
    )
    krx_quotes = (
        cache.get_or_set(
            "global_top20_krx_quotes", TTL_GLOBAL_TOP20_QUOTES_SECONDS, lambda: get_stock_quotes_bulk(krx_codes)
        )
        if krx_codes
        else {}
    )

    result = []
    for it in items:
        code = it["code"]
        if code.endswith(".KS"):
            krx_quote = krx_quotes.get(code[: -len(".KS")])
            if krx_quote:
                ratio = 1 + krx_quote["change_pct"] / 100
                it = {**it, "marcap_usd": it["marcap_usd"] * ratio, "change_pct": krx_quote["change_pct"]}
            result.append(it)
            continue

        quote = quotes.get(code)
        if quote and quote["previous_close"]:
            # A same-currency price ratio, not an absolute price — several of these
            # tickers quote in their home currency on Yahoo (e.g. 2222.SR in SAR) while
            # companiesmarketcap's marcap_usd is USD-denominated. Multiplying by an
            # absolute foreign-currency price would silently inflate the USD figure by
            # whatever that currency's exchange rate is; the ratio sidesteps needing a
            # live FX rate for each ticker's currency at all.
            ratio = quote["price"] / quote["previous_close"]
            it = {**it, "marcap_usd": it["marcap_usd"] * ratio, "change_pct": (ratio - 1) * 100}
        result.append(it)
    return result


def get_company_detail_cached(detail_path: str, lang: str = "ko") -> dict | None:
    """companiesmarketcap.com's description is already in English, so English callers
    get it as scraped; Korean callers get a translated copy, cached separately so the
    same page's translation isn't re-requested from Google on every popup open."""
    raw = cache.get_or_set(
        f"company_detail:{detail_path}", TTL_COMPANY_DETAIL_SECONDS, lambda: get_company_detail(detail_path)
    )
    if not raw:
        return None
    if lang != "ko":
        return raw

    description_ko = cache.get_or_set(
        f"company_detail_ko:{detail_path}",
        TTL_COMPANY_DETAIL_SECONDS,
        lambda: translate_to_korean(raw["description"]),
    )
    return {"description": description_ko}


TTL_DETAIL_PATH_SECONDS = 24 * 3600
TTL_MARKETCAP_GUESS_SECONDS = 60 * 60


def _find_top20_item(code: str) -> dict | None:
    for item in get_global_top20_cached():
        if item.get("code") == code:
            return item
    return None


def get_global_enrichment(code: str, name: str, lang: str = "ko") -> dict:
    """Logo URL (constructed, no fetch needed), market cap (USD, converted to KRW via
    the existing FX rate), and a short company description for the /global stock detail
    page. The already-cached top-20 snapshot covers most-viewed large caps for free;
    everything else falls back to a name-slug guess against companiesmarketcap.com (see
    global_marketcap_fetcher.resolve_detail_path). Each field degrades to None
    independently on failure rather than failing the whole response."""
    logo_url = f"{global_marketcap_fetcher.BASE_URL}/img/company-logos/256/{code}.png"

    top20_item = _find_top20_item(code)
    if top20_item:
        detail_path = top20_item.get("detail_path")
        marcap_usd = top20_item.get("marcap_usd")
    else:
        detail_path = cache.get_or_set(
            f"detail_path:{code}",
            TTL_DETAIL_PATH_SECONDS,
            lambda: global_marketcap_fetcher.resolve_detail_path(code, name),
        )
        marcap_usd = (
            cache.get_or_set(
                f"marketcap_guess:{code}",
                TTL_MARKETCAP_GUESS_SECONDS,
                lambda: global_marketcap_fetcher.get_marketcap_usd(detail_path),
            )
            if detail_path
            else None
        )

    description = None
    if detail_path:
        detail = get_company_detail_cached(detail_path, lang)
        description = detail["description"] if detail else None

    marcap_krw = None
    fx = get_exchange_rate()
    if marcap_usd is not None and fx and fx.get("rate"):
        marcap_krw = marcap_usd * fx["rate"]

    return {
        "logo_url": logo_url,
        "marcap_usd": marcap_usd,
        "marcap_krw": marcap_krw,
        "description": description,
    }
