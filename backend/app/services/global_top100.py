"""Orchestrates the "글로벌 시가총액 TOP 100" page: roster + fundamentals + returns +
rank-change history from the nightly-refreshed full snapshot, overlaid with a
20-30s-fresh live price/market-cap/day-change layer. See the four data modules this
pulls from (global_marketcap_fetcher, company_fundamentals_fetcher,
global_returns_fetcher, global_top100_batch_quote) for the actual upstream calls, and
global_top100_rank_store for the persisted day-over-day rank history.

Same two-tier TTL-cache shape as services/battle.py: a slow, expensive layer (here,
~100 sequential Yahoo calls) cached for hours, with a cheap, frequent layer cached for
seconds overlaid on top at read time.
"""

import datetime as dt
import logging
import threading

from app.data.ceo_photo_fetcher import get_ceo_photos_bulk
from app.data.company_fundamentals_fetcher import fetch_fundamentals_bulk
from app.data.global_marketcap_fetcher import get_global_top_n
from app.data.global_returns_fetcher import get_global_returns
from app.data.global_top100_batch_quote import fetch_live_quotes
from app.data.translate_fetcher import translate_to_korean
from app.services import global_top100_rank_store as rank_store
from app.services.cache import cache

logger = logging.getLogger(__name__)

FULL_SNAPSHOT_KEY = "global_top100_full"
LIVE_OVERLAY_KEY = "global_top100_live"

# Rebuilding the full snapshot costs ~100 sequential Yahoo calls (fundamentals) plus a
# couple hundred more (returns, threaded) — expensive enough that it's meant to run
# once a night (see routers/global_top100.py's /refresh + the GitHub Actions cron),
# not on every cache expiry. The TTL here is a safety net if that trigger is ever
# missed, not the primary refresh mechanism.
TTL_FULL_SECONDS = 12 * 3600
# A little above the frontend's 20s poll interval so a request landing just after a
# tick reuses the same cached quote batch instead of forcing a synchronous refetch.
TTL_LIVE_SECONDS = 25

# "500자 내외" — Yahoo's longBusinessSummary is usually a few paragraphs; trimmed to a
# card-friendly length rather than shown in full.
_DESC_MAX_CHARS = 500

_state_lock = threading.Lock()
_full_fetched_at: str | None = None
_live_fetched_at: str | None = None

# Tracks whether the full snapshot has ever completed once since this process started
# — distinct from whether it's *currently* cached, which cache.get_or_set already
# tracks internally. The only thing this flags is "would reading the snapshot right
# now block on a synchronous cold fetch", which is only true before the very first
# successful build in this process's lifetime (see get_top100()'s docstring for why
# that specific window needed its own handling).
_warm_lock = threading.Lock()
_ever_warmed = False
_warming_in_background = False


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _kst_today() -> str:
    return (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=9)).strftime("%Y-%m-%d")


def _truncate_description(text: str | None) -> str | None:
    if not text:
        return None
    text = text.strip()
    if len(text) <= _DESC_MAX_CHARS:
        return text
    return text[: _DESC_MAX_CHARS - 1].rstrip() + "…"


def _fetch_full_snapshot() -> list[dict]:
    global _full_fetched_at

    roster = get_global_top_n(100)
    symbols = [it["code"] for it in roster if it.get("code")]

    fundamentals = fetch_fundamentals_bulk(symbols)
    returns = get_global_returns(symbols)
    names = [it["name"] for it in roster if it.get("name")]
    ceo_photos = get_ceo_photos_bulk(names)

    today = _kst_today()
    rank_store.record_snapshot(
        today,
        [
            {"symbol": it["code"], "rank": it["rank"], "market_cap": it.get("marcap_usd")}
            for it in roster
            if it.get("code")
        ],
    )
    prev_date = rank_store.previous_snapshot_date(today)
    prev_ranks = rank_store.ranks_for_date(prev_date) if prev_date else {}

    items: list[dict] = []
    for it in roster:
        symbol = it.get("code")
        fund = fundamentals.get(symbol, {}) if symbol else {}
        ret = returns.get(symbol) if symbol else None
        ceo = ceo_photos.get(it.get("name")) if it.get("name") else None

        description_en = fund.get("description_en")
        description_ko = None
        if description_en:
            try:
                description_ko = translate_to_korean(description_en)
            except Exception:  # noqa: BLE001 - a translation failure shouldn't drop the row
                logger.warning("global_top100: translation failed for %s", symbol, exc_info=True)

        # Positive = climbed that many ranks since yesterday, negative = fell, None =
        # no prior-day snapshot yet (first day after launch, or this symbol is a new
        # entrant to the TOP 100 since yesterday).
        prev_rank = prev_ranks.get(symbol) if symbol else None
        rank_change = (prev_rank - it["rank"]) if prev_rank is not None else None

        items.append(
            {
                "rank": it["rank"],
                "rank_change": rank_change,
                "symbol": symbol,
                "name": it.get("name"),
                "country": it.get("country"),
                "flag_url": it.get("flag_url"),
                "logo_url": it.get("logo_url"),
                "detail_path": it.get("detail_path"),
                "ceo_name": ceo.get("name") if ceo else None,
                "ceo_photo_url": ceo.get("photo_url") if ceo else None,
                # price/currency/change_pct are filled in by the live overlay at read
                "price": None,
                "currency": None,
                "market_cap_usd": it.get("marcap_usd"),
                "change_pct": it.get("change_pct"),
                "returns": ret.returns if ret else {},
                "spark_points": ret.points if ret else [],
                "spark_dates": ret.dates if ret else [],
                "sector": fund.get("sector"),
                "industry": fund.get("industry"),
                "description_ko": _truncate_description(description_ko),
                "description_en": _truncate_description(description_en),
                "trailing_eps": fund.get("trailing_eps"),
                "profit_margin": fund.get("profit_margin"),
                "earnings_growth": fund.get("earnings_growth"),
                "trailing_pe": fund.get("trailing_pe"),
                "recommendation_key": fund.get("recommendation_key"),
                "recommendation_label": fund.get("recommendation_label"),
                "analyst_count": fund.get("analyst_count"),
            }
        )

    global _ever_warmed
    with _state_lock:
        _full_fetched_at = _now_iso()
    _ever_warmed = True
    return items


def get_full_snapshot_cached() -> list[dict]:
    return cache.get_or_set(FULL_SNAPSHOT_KEY, TTL_FULL_SECONDS, _fetch_full_snapshot)


def _warm_in_background() -> None:
    global _warming_in_background
    try:
        get_full_snapshot_cached()
    finally:
        with _warm_lock:
            _warming_in_background = False


def ensure_warm_started() -> None:
    """Kicks off the (multi-minute) full-snapshot build on a daemon thread if nothing
    is warming it already, and returns immediately either way. Called both by
    main.py's startup/nightly loop and by get_top100() itself on a cold read, so the
    build starts on whichever happens first after a deploy rather than waiting on
    either one exclusively."""
    global _warming_in_background
    with _warm_lock:
        if _warming_in_background:
            return
        _warming_in_background = True
    threading.Thread(target=_warm_in_background, daemon=True).start()


def force_refresh_full() -> dict:
    """Bypasses the TTL and rebuilds the full snapshot right now — used by the
    token-guarded /refresh endpoint (see routers/global_top100.py) that the nightly
    GitHub Actions cron and main.py's in-process fallback both call, mirroring
    kakao_notify's dual-trigger shape."""
    cache.invalidate(FULL_SNAPSHOT_KEY)
    items = cache.get_or_set(FULL_SNAPSHOT_KEY, TTL_FULL_SECONDS, _fetch_full_snapshot)
    return {"status": "ok", "count": len(items)}


def _fetch_live_overlay() -> dict[str, dict]:
    global _live_fetched_at
    snapshot = get_full_snapshot_cached()
    symbols = [it["symbol"] for it in snapshot if it.get("symbol")]
    quotes = fetch_live_quotes(symbols)
    with _state_lock:
        _live_fetched_at = _now_iso()
    return quotes


def get_live_overlay_cached() -> dict[str, dict]:
    return cache.get_or_set(LIVE_OVERLAY_KEY, TTL_LIVE_SECONDS, _fetch_live_overlay)


def get_top100() -> dict:
    """The merged view the router serves: full snapshot fields with price/currency/
    change_pct overlaid from the live cache wherever a quote came back for that
    symbol. A symbol the live overlay couldn't reach just keeps its snapshot-time
    change_pct (from the companiesmarketcap scrape) and a null price rather than
    disappearing from the list.

    Deliberately does NOT call get_full_snapshot_cached() before the first snapshot
    has ever completed in this process: that function's cache.get_or_set blocks
    synchronously on a genuinely cold key, and the full build now costs minutes (100
    sequential Yahoo fundamentals calls, a threaded returns fetch, and a CEO-photo
    lookup per company via Wikidata — see ceo_photo_fetcher.py) — long enough to hang
    the request past any reasonable timeout. Every deploy/restart empties this
    process's in-memory cache, so this cold window isn't rare, and the frontend
    already polls every 20s — returning an empty, still-loading response instantly
    and letting the next poll pick up real data once the background build finishes is
    strictly better than one request hanging for minutes. Once _ever_warmed flips
    true it stays true for the rest of the process's life, so this branch only ever
    matters in the minutes right after a (re)start.
    """
    if not _ever_warmed:
        ensure_warm_started()
        return {"items": [], "updated_at": None, "live_updated_at": None}

    snapshot = get_full_snapshot_cached()
    live = get_live_overlay_cached()

    items = []
    for it in snapshot:
        symbol = it.get("symbol")
        quote = live.get(symbol) if symbol else None
        merged = dict(it)
        if quote:
            merged["price"] = quote.get("price")
            merged["currency"] = quote.get("currency")
            # Yahoo's `marketCap` is denominated in the ticker's own listing currency
            # (SAR for 2222.SR, KRW for 005930.KS, ...), not USD — using it directly
            # here would silently mix currencies into one USD-labeled ranking column.
            # market_cap_usd's baseline comes from companiesmarketcap (genuinely USD);
            # the live day-change ratio is applied to *that* instead, same technique
            # battle.py's get_global_top20_cached uses for the same reason.
            change_pct = quote.get("change_pct")
            if change_pct is not None:
                merged["change_pct"] = change_pct
                if it.get("market_cap_usd") is not None:
                    merged["market_cap_usd"] = it["market_cap_usd"] * (1 + change_pct / 100)
        items.append(merged)

    with _state_lock:
        updated_at, live_updated_at = _full_fetched_at, _live_fetched_at
    return {"items": items, "updated_at": updated_at, "live_updated_at": live_updated_at}
