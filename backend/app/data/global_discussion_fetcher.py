import FinanceDataReader as fdr
import requests

from app.services.cache import cache

TTL_DISCUSSION_SECONDS = 3 * 60
TTL_NASDAQ_LISTING_SECONDS = 24 * 3600

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
        "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    ),
    "Referer": "https://m.stock.naver.com/",
}

_session = requests.Session()
_session.headers.update(HEADERS)
_session.mount(
    "https://",
    requests.adapters.HTTPAdapter(pool_connections=10, pool_maxsize=20, max_retries=1),
)

DISCUSSION_URL = "https://m.stock.naver.com/front-api/discussion/list"


def _load_nasdaq_symbols() -> set[str]:
    return set(fdr.StockListing("NASDAQ")["Symbol"].astype(str))


def _get_nasdaq_symbols() -> set[str]:
    return cache.get_or_set("nasdaq_symbols", TTL_NASDAQ_LISTING_SECONDS, _load_nasdaq_symbols)


def resolve_naver_suffix(code: str) -> str:
    """Naver's world-stock discussion board keys posts by `{TICKER}.O` for Nasdaq-listed
    tickers and `{TICKER}.K` for everything else (NYSE and other US exchanges) - found by
    directly probing the mobile app's discussion-list API (confirmed live against
    NVDA.O/AMD.O/GOOGL.O and CPNG.K/PLTR.K; not documented anywhere). Nasdaq membership
    (already fetched elsewhere in this app via the same FinanceDataReader listing) decides
    which bucket a ticker falls into."""
    try:
        is_nasdaq = code in _get_nasdaq_symbols()
    except Exception:
        is_nasdaq = False
    return "O" if is_nasdaq else "K"


def _fetch_discussion(code: str, limit: int) -> list[dict]:
    item_code = f"{code}.{resolve_naver_suffix(code)}"
    params = {
        "discussionType": "foreignStock",
        "itemCode": item_code,
        "pageSize": limit,
    }
    resp = _session.get(DISCUSSION_URL, params=params, timeout=4)
    resp.raise_for_status()
    payload = resp.json()
    if not payload.get("isSuccess"):
        return []

    posts = (payload.get("result") or {}).get("posts") or []
    items = []
    for p in posts:
        # Mirrors board_fetcher.py's Cleanbot filtering for the domestic board — a
        # post that failed Cleanbot moderation shouldn't be mirrored here either.
        if p.get("isCleanbotPassed") is False:
            continue
        writer = p.get("writer") or {}
        items.append(
            {
                "id": p.get("id", ""),
                "title": p.get("title") or "",
                "text": p.get("contentSwReplacedButImg") or "",
                "author": writer.get("nickname") or "",
                "written_at": p.get("writtenAt", ""),
                "likes": p.get("recommendCount") or 0,
                "dislikes": p.get("notRecommendCount") or 0,
                "views": p.get("viewCount") or 0,
                "is_reply": (p.get("replyDepth") or 0) > 0,
            }
        )
    return items


def get_discussion(code: str, limit: int = 20) -> list[dict]:
    key = f"global_discussion:{code}:{limit}"
    try:
        return cache.get_or_set(key, TTL_DISCUSSION_SECONDS, lambda: _fetch_discussion(code, limit))
    except Exception:
        return []
