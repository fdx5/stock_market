"""The "글로벌 시가총액 TOP 100" page: a roster/fundamentals/returns snapshot rebuilt
nightly, overlaid with a live price layer refreshed every ~20s.

How it is built so the page always has something to show:

- A request never waits on an upstream. It reads two in-memory values — the
  snapshot and the live quotes — and merges them. Both are written only by
  background work (main.py's startup/nightly loop and live loop).
- Both values are also kept in the database (global_top100_rank_store), and a
  process that has nothing in memory yet loads them from there first. A deploy or
  restart used to serve an empty page for the minutes a full rebuild takes, and a
  rebuild that failed left it empty until the next one.
- A rebuild replaces the snapshot only once it has produced the full roster, and
  every part of a row that failed to refresh keeps its last good value: fundamentals
  per symbol from their own table, returns / sparkline / CEO photo from the previous
  snapshot. One failing upstream can age a field, never blank it.
- The live price no longer rests on Yahoo's crumb alone. The crumb-guarded v7 batch
  (two requests for all 100) is tried first; every symbol it did not answer — all of
  them while getcrumb is refused, which on the server is for long stretches — comes
  from the crumbless v8 chart endpoint, and a symbol neither answered shows the
  roster's own USD price rather than a dash.
"""

import datetime as dt
import logging
import threading
import time

from app.data import yahoo_session
from app.data.ceo_photo_fetcher import get_ceo_photos_bulk
from app.data.company_fundamentals_fetcher import fetch_fundamentals_bulk
from app.data.global_marketcap_fetcher import get_global_top_n
from app.data.global_returns_fetcher import get_global_returns
from app.data.global_top100_batch_quote import fetch_chart_quotes, fetch_live_quotes
from app.data.translate_fetcher import translate_to_korean
from app.services import global_top100_rank_store as store

logger = logging.getLogger(__name__)

# "500자 내외" — Yahoo's longBusinessSummary is usually a few paragraphs; trimmed to a
# card-friendly length rather than shown in full.
_DESC_MAX_CHARS = 500

# A roster shorter than this is a scrape that broke partway (a page that timed out
# or came back without its table), not the market: the last full snapshot stays.
_MIN_ROSTER = 90

# The crumbless fallback is one request per symbol, so it runs at most this often
# even though the live loop ticks every 20s; the crumb batch, when it works, is two
# requests and runs every tick.
_CHART_FALLBACK_SECONDS = 60
# Live quotes are written to the database this often, so a restart shows prices a
# few minutes old instead of none — not on every 20s tick.
_LIVE_PERSIST_SECONDS = 300

_FUNDAMENTAL_FIELDS = (
    "sector",
    "industry",
    "description_en",
    "trailing_eps",
    "profit_margin",
    "earnings_growth",
    "trailing_pe",
    "recommendation_key",
    "recommendation_label",
    "analyst_count",
)

_lock = threading.Lock()
_snapshot: list[dict] | None = None
_snapshot_at: str | None = None
_live: dict[str, dict] = {}
_live_at: str | None = None
_chart_at = 0.0
_live_persisted_at = 0.0

_load_lock = threading.Lock()
_loaded = False
_build_lock = threading.Lock()


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


# ── loading what the last process left ──────────────────────────────────────


def load_persisted() -> None:
    """Fill memory from the database once per process — a single-row read each, so
    a request may do it itself if it arrives before the startup thread has."""
    global _loaded, _snapshot, _snapshot_at, _live, _live_at
    if _loaded:
        return
    with _load_lock:
        if _loaded:
            return
        try:
            saved = store.load_state("snapshot")
            live = store.load_state("live")
        except Exception:  # noqa: BLE001 - the next caller tries again
            logger.warning("global_top100: loading the saved snapshot failed", exc_info=True)
            return
        with _lock:
            if saved and _snapshot is None:
                _snapshot, _snapshot_at = saved
            if live and not _live:
                _live, _live_at = live
        _loaded = True


# ── the nightly snapshot ─────────────────────────────────────────────────────


def _merged_fundamentals(symbols: list[str]) -> dict[str, dict]:
    """Each symbol's fundamentals: what Yahoo answered tonight, field by field over
    what it answered last time. Asks Yahoo only while a crumb can be had; the saved
    values carry the page otherwise."""
    try:
        saved = store.load_fundamentals()
    except Exception:  # noqa: BLE001 - tonight's answers alone, then
        logger.warning("global_top100: loading saved fundamentals failed", exc_info=True)
        saved = {}

    fresh: dict[str, dict] = {}
    if not yahoo_session.cooling_down():
        fresh = fetch_fundamentals_bulk(symbols)

    merged: dict[str, dict] = {}
    changed: dict[str, dict] = {}
    for symbol in symbols:
        old = saved.get(symbol, {})
        new = fresh.get(symbol, {})
        row = {field: new.get(field) if new.get(field) is not None else old.get(field) for field in _FUNDAMENTAL_FIELDS}
        # Translate only a profile that is new or changed; keep the saved one otherwise.
        row["description_ko"] = old.get("description_ko") if row["description_en"] == old.get("description_en") else None
        if row["description_en"] and not row["description_ko"]:
            try:
                row["description_ko"] = translate_to_korean(row["description_en"])
            except Exception:  # noqa: BLE001 - a translation failure shouldn't drop the row
                logger.warning("global_top100: translation failed for %s", symbol, exc_info=True)
        merged[symbol] = row
        if row != old:
            changed[symbol] = row
    try:
        store.save_fundamentals(changed, _now_iso())
    except Exception:  # noqa: BLE001 - tonight's values still reach the page
        logger.warning("global_top100: saving fundamentals failed", exc_info=True)
    return merged


def _build_snapshot() -> list[dict]:
    roster = [it for it in get_global_top_n(100) if it.get("code")]
    if len(roster) < _MIN_ROSTER:
        raise RuntimeError(f"roster scrape came back short ({len(roster)} rows)")
    symbols = [it["code"] for it in roster]

    with _lock:
        previous = {it["symbol"]: it for it in (_snapshot or []) if it.get("symbol")}

    fundamentals = _merged_fundamentals(symbols)
    try:
        returns = get_global_returns(symbols)
    except Exception:  # noqa: BLE001 - last night's returns stay
        logger.warning("global_top100: returns fetch failed", exc_info=True)
        returns = {}
    try:
        ceo_photos = get_ceo_photos_bulk([it["name"] for it in roster if it.get("name")])
    except Exception:  # noqa: BLE001 - last night's photos stay
        logger.warning("global_top100: CEO photo fetch failed", exc_info=True)
        ceo_photos = {}

    today = _kst_today()
    prev_ranks: dict[str, int] = {}
    try:
        store.record_snapshot(
            today, [{"symbol": it["code"], "rank": it["rank"], "market_cap": it.get("marcap_usd")} for it in roster]
        )
        prev_date = store.previous_snapshot_date(today)
        prev_ranks = store.ranks_for_date(prev_date) if prev_date else {}
    except Exception:  # noqa: BLE001 - rank arrows fall back to last night's
        logger.warning("global_top100: rank history unavailable", exc_info=True)

    items: list[dict] = []
    for it in roster:
        symbol = it["code"]
        old = previous.get(symbol, {})
        fund = fundamentals.get(symbol, {})
        ret = returns.get(symbol)
        ceo = ceo_photos.get(it.get("name")) if it.get("name") else None

        # Positive = climbed that many ranks since yesterday, negative = fell, None =
        # no prior-day snapshot yet (first day, or a new entrant to the TOP 100).
        prev_rank = prev_ranks.get(symbol)
        rank_change = (prev_rank - it["rank"]) if prev_rank is not None else old.get("rank_change") if not prev_ranks else None

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
                "ceo_name": ceo.get("name") if ceo else old.get("ceo_name"),
                "ceo_photo_url": ceo.get("photo_url") if ceo else old.get("ceo_photo_url"),
                # The roster's own USD price; the live layer overrides it at read time.
                "price": it.get("price_usd"),
                "currency": "USD" if it.get("price_usd") is not None else None,
                "market_cap_usd": it.get("marcap_usd"),
                "change_pct": it.get("change_pct"),
                "returns": ret.returns if ret else old.get("returns", {}),
                "spark_points": ret.points if ret else old.get("spark_points", []),
                "spark_dates": ret.dates if ret else old.get("spark_dates", []),
                "sector": fund.get("sector"),
                "industry": fund.get("industry"),
                "description_ko": _truncate_description(fund.get("description_ko")),
                "description_en": _truncate_description(fund.get("description_en")),
                "trailing_eps": fund.get("trailing_eps"),
                "profit_margin": fund.get("profit_margin"),
                "earnings_growth": fund.get("earnings_growth"),
                "trailing_pe": fund.get("trailing_pe"),
                "recommendation_key": fund.get("recommendation_key"),
                "recommendation_label": fund.get("recommendation_label"),
                "analyst_count": fund.get("analyst_count"),
            }
        )
    return items


def force_refresh_full() -> dict:
    """Rebuild the snapshot now — the nightly loop, the startup run and the
    token-guarded /refresh endpoint all come here. Single-flighted; a failed build
    raises and leaves the current snapshot (in memory and saved) untouched."""
    global _snapshot, _snapshot_at
    load_persisted()
    with _build_lock:
        items = _build_snapshot()
        fetched_at = _now_iso()
        with _lock:
            _snapshot, _snapshot_at = items, fetched_at
        try:
            store.save_state("snapshot", items, fetched_at)
        except Exception:  # noqa: BLE001 - served from memory; saved next time
            logger.warning("global_top100: saving the snapshot failed", exc_info=True)
    return {"status": "ok", "count": len(items)}


# ── the live layer ───────────────────────────────────────────────────────────


def refresh_live() -> int:
    """One tick of main.py's live loop: the crumb batch for everything, the chart
    endpoint for whatever that left out (at most once a minute), each symbol keeping
    its previous quote when neither answered. Returns how many symbols are quoted."""
    global _live, _live_at, _chart_at, _live_persisted_at
    load_persisted()
    with _lock:
        symbols = [it["symbol"] for it in (_snapshot or []) if it.get("symbol")]
    if not symbols:
        return 0

    quotes = fetch_live_quotes(symbols)
    missing = [s for s in symbols if s not in quotes]
    now = time.monotonic()
    if missing and now - _chart_at >= _CHART_FALLBACK_SECONDS:
        _chart_at = now
        quotes.update(fetch_chart_quotes(missing))
    if not quotes:
        return len(_live)

    stamp = _now_iso()
    with _lock:
        _live = {**_live, **quotes}
        _live_at = stamp
        live_copy = dict(_live)
    if now - _live_persisted_at >= _LIVE_PERSIST_SECONDS:
        _live_persisted_at = now
        try:
            store.save_state("live", live_copy, stamp)
        except Exception:  # noqa: BLE001 - kept in memory; saved next time
            logger.warning("global_top100: saving live quotes failed", exc_info=True)
    return len(live_copy)


# ── the read ─────────────────────────────────────────────────────────────────


def get_top100() -> dict:
    """The merged view the router serves. Memory only — plus, once per process, the
    saved copy if memory is still empty — so it answers at once whatever the
    upstreams are doing. A symbol without a live quote keeps the roster's USD price
    and its snapshot-time change instead of a dash."""
    load_persisted()
    with _lock:
        snapshot, live = _snapshot, _live
        updated_at, live_updated_at = _snapshot_at, _live_at
    if not snapshot:
        return {"items": [], "updated_at": None, "live_updated_at": None}

    items = []
    for it in snapshot:
        merged = dict(it)
        quote = live.get(it.get("symbol") or "")
        if quote and quote.get("price") is not None:
            merged["price"] = quote["price"]
            merged["currency"] = quote.get("currency")
            if quote.get("change_pct") is not None:
                merged["change_pct"] = quote["change_pct"]
            # The USD column is companiesmarketcap's figure, moved by how far the
            # price has gone since that scrape — only where both prices are dollars.
            # Yahoo's own `marketCap` is in the listing currency (SAR for 2222.SR,
            # KRW for 005930.KS), and scaling by the day's change instead counted the
            # part of the move the scrape had already seen twice.
            base_price = it.get("price") if it.get("currency") == "USD" else None
            if quote.get("currency") == "USD" and base_price and it.get("market_cap_usd") is not None:
                merged["market_cap_usd"] = it["market_cap_usd"] * quote["price"] / base_price
        items.append(merged)
    return {"items": items, "updated_at": updated_at, "live_updated_at": live_updated_at}
