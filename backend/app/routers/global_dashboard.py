import datetime as dt
import logging
import math
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, Response

from app.data import global_discussion_fetcher, global_index_fetcher, kospi_futures_fetcher
from app.services import kospi_night, nasdaq_futures
from app.services.public_discussion import get_public_discussion
from app.data.toss_news_fetcher import get_toss_image, get_toss_news, get_toss_news_article
from app.data.us_universe import get_us_stock_item
from app.services.battle import get_global_enrichment

logger = logging.getLogger(__name__)

router = APIRouter()

# Keep public widget codes stable; global_index_fetcher maps them to explicit
# provider symbols. Indices are point-valued; SOXL/TQQQ are USD ETF prices.
# Country flags and region groups are shared by the existing dashboard layouts.
US_WIDGETS = [
    {"key": "dow", "label": "다우존스", "code": "DJI", "unit": "index", "flag": "us", "group": "us"},
    {"key": "nasdaq", "label": "나스닥종합", "code": "IXIC", "unit": "index", "flag": "us", "group": "us"},
    {"key": "soxl", "label": "SOXL", "code": "SOXL", "unit": "usd", "flag": "us", "group": "us"},
    {"key": "tqqq", "label": "TQQQ", "code": "TQQQ", "unit": "usd", "flag": "us", "group": "us"},
]

OVERSEAS_WIDGETS = [
    {"key": "nikkei", "label": "니케이225", "code": "N225", "unit": "index", "flag": "jp", "group": "overseas"},
    {"key": "shanghai", "label": "상하이종합", "code": "SSEC", "unit": "index", "flag": "cn", "group": "overseas"},
    {"key": "hangseng", "label": "항셍지수", "code": "HSI", "unit": "index", "flag": "hk", "group": "overseas"},
    {"key": "taiwan", "label": "대만 가권", "code": "^TWII", "unit": "index", "flag": "tw", "group": "overseas"},
    {"key": "ftse", "label": "FTSE 100", "code": "FTSE", "unit": "index", "flag": "gb", "group": "overseas"},
]

KST = ZoneInfo("Asia/Seoul")

# Day quotes use Naver; night quotes share the external crawl used by the header.
# KORU is not used as a substitute for the night-futures contract.
KOSPI_SESSION_WIDGETS = {
    "day": {
        "key": "kospi_fut_day",
        "label": "코스피200 주간선물",
        "code": "FUT",
        "unit": "index",
        "flag": "kr",
        "group": "us",
        "source": "naver",
    },
    "night": {
        "key": "kospi_fut_night",
        "label": "코스피200 야간선물",
        "code": "KOSPI200-NIGHT",
        "unit": "index",
        "flag": "kr",
        "group": "us",
        "source": "night_external",
    },
}


def _kospi_session(now: dt.datetime) -> str | None:
    """Which KOSPI 200 futures session is open right now, if any.

    Day is 09:00-15:45 KST; night is 18:00-06:00 KST, which straddles midnight and so
    lands its two halves on different weekdays — Mon-Fri evenings, Tue-Sat mornings.
    Holidays aren't modelled: on one the widget shows a flat previous close, which is
    the same thing every other tile on this grid does when its market is shut."""
    weekday = now.weekday()  # Mon=0 .. Sun=6
    minutes = now.hour * 60 + now.minute

    if weekday < 5 and 9 * 60 <= minutes < 15 * 60 + 45:
        return "day"
    if weekday < 5 and minutes >= 18 * 60:
        return "night"
    if 1 <= weekday <= 5 and minutes < 6 * 60:
        return "night"
    return None


def _sanitized(item: dict, empty: dict) -> dict:
    """Guarantee one tile is JSON-renderable, whatever its feed returned.

    Starlette renders with allow_nan=False, so a single non-finite number anywhere in
    the payload raises at render time and takes the *entire* grid down with a 500 —
    which is exactly how every index once vanished at once. A tile whose quote didn't
    come through cleanly degrades to its own empty state instead; the rest still ship."""
    if not all(math.isfinite(item[k]) for k in ("close", "change", "change_pct") if item.get(k) is not None):
        logger.warning("global_dashboard: non-finite quote for %s, blanking tile", item.get("key"))
        return empty
    item["points"] = [p for p in item["points"] if p.get("close") is not None and math.isfinite(p["close"])]
    return item


def _widget_data(widget: dict) -> dict:
    # "source" only steers the fetch below; it isn't part of the wire format.
    meta = {k: v for k, v in widget.items() if k != "source"}
    empty = {**meta, "close": None, "change": None, "change_pct": None, "points": []}

    if widget.get("source") == "night_external":
        return _sanitized({**meta, **kospi_night.get_quote()}, empty)

    if widget.get("source") == "naver":
        try:
            return _sanitized({**meta, **kospi_futures_fetcher.get_index(widget["code"])}, empty)
        except Exception:
            logger.exception("global_dashboard: failed to load Naver index %s", widget["code"])
            return empty

    try:
        return _sanitized({**meta, **global_index_fetcher.get_index(widget["code"])}, empty)
    except Exception:
        logger.exception("global_dashboard: failed to load index %s", widget["code"])
        return empty


@router.get("/indices")
def indices(response: Response):
    response.headers["Cache-Control"] = "no-store"
    # Independent, short-lived quotes for every region, with bounded concurrency.
    with ThreadPoolExecutor(max_workers=9) as pool:
        all_items = list(pool.map(_widget_data, US_WIDGETS + OVERSEAS_WIDGETS))
    items = all_items[:len(US_WIDGETS)]

    session = _kospi_session(dt.datetime.now(KST))
    if session:
        partner_widget = KOSPI_SESSION_WIDGETS[session]
        partner = _widget_data(partner_widget)
        # A tile that failed to load has nothing to show, so drop it rather than flipping
        # a dash into the US rotation every few seconds. When it did load, it rides the
        # same bottom-to-top flip as everything else — slotted right after SOXL, the tile
        # it historically doubled for.
        if partner["close"] is not None:
            soxl_at = next((i for i, it in enumerate(items) if it["key"] == "soxl"), len(items) - 1)
            items.insert(soxl_at + 1, partner)

    items += all_items[len(US_WIDGETS):]

    return {"items": items}


@router.get("/kospi-futures")
def kospi_futures_quote():
    return kospi_futures_fetcher.get_header_quote()


@router.get("/nasdaq-futures")
def nasdaq_futures_quotes():
    return nasdaq_futures.get_quotes()


@router.get("/kospi-night")
def kospi_night_quote():
    return kospi_night.get_quote()


@router.get("/{code}/enrichment")
def enrichment(code: str, lang: str = Query("ko")):
    item = get_us_stock_item(code)
    name = item["name"] if item else code
    return get_global_enrichment(code, name, lang)


@router.get("/{code}/discussion")
def discussion(
    code: str,
    limit: int = Query(10, ge=1, le=50),
    offset: str | None = Query(None),
    discussion_type: str = Query("foreignStock", pattern="^(foreignStock|foreignEtf)$"),
):
    return global_discussion_fetcher.get_discussion(code, limit, offset, discussion_type)


@router.get("/{code}/toss-discussion")
def toss_discussion(
    code: str,
    limit: int = Query(10, ge=1, le=30),
    offset: str | None = Query(None, max_length=64),
    discussion_type: str = Query("foreignStock", pattern="^(foreignStock|foreignEtf)$"),
):
    """Public discussions, with explicit source metadata and source-bound cursors."""
    try: return get_public_discussion(code, limit, offset, discussion_type)
    except Exception: raise HTTPException(503, "종목토론 수집이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.") from None


@router.get("/{code}/toss-news")
def toss_news(
    code: str,
    limit: int = Query(12, ge=1, le=30),
    page: int = Query(1, ge=1, le=50),
):
    """Korean-language news for a US listing, from Toss's per-company feed.

    Paged at the source rather than client-side (as the Naver-search path is), because
    this feed really is addressable by page number — asking for page 2 returns the next
    block rather than the same one again.
    """
    return get_toss_news(code, limit, page)


@router.get("/toss-news-article")
def toss_news_article(id: str = Query(..., min_length=1, max_length=128)):
    """One Toss article's body, already segmented into paragraphs at the source.

    A query parameter rather than a path segment because Toss's article ids carry
    outlet-specific punctuation (`hankyung_X20260903.104227`), and a dotted final
    segment is exactly the shape a path router is most likely to mangle.
    """
    return get_toss_news_article(id)


@router.get("/toss-image")
def toss_image(u: str = Query(..., min_length=1, max_length=512)):
    """A Toss-hosted news image, relayed: Toss marks its images same-site only, so
    the browser will not draw them on this site directly. Toss hosts only."""
    image = get_toss_image(u)
    if image is None:
        raise HTTPException(status_code=404)
    body, kind = image
    return Response(content=body, media_type=kind, headers={"Cache-Control": "public, max-age=86400"})
