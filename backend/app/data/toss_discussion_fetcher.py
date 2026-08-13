"""Read-only access to publicly visible Toss Securities stock communities."""

import requests

from app.services.cache import cache

TTL_DISCUSSION_SECONDS = 3 * 60
TTL_PRODUCT_SECONDS = 24 * 60 * 60
INFO_API = "https://wts-info-api.tossinvest.com"

_session = requests.Session()
_session.headers.update(
    {
        "User-Agent": "Mozilla/5.0 (compatible; KStockHub/1.0)",
        "Accept": "application/json",
        "Origin": "https://www.tossinvest.com",
        "Referer": "https://www.tossinvest.com/",
    }
)
_session.mount(
    "https://",
    requests.adapters.HTTPAdapter(pool_connections=10, pool_maxsize=20, max_retries=1),
)


def _resolve_product_code(symbol: str) -> str | None:
    response = _session.post(
        f"{INFO_API}/api/v3/search-all/wts-auto-complete",
        json={"query": symbol, "sections": [{"type": "PRODUCT"}]},
        timeout=4,
    )
    response.raise_for_status()
    sections = response.json().get("result") or []
    for section in sections:
        for item in (section.get("data") or {}).get("items") or []:
            if str(item.get("symbol") or "").upper() == symbol.upper():
                return item.get("productCode") or item.get("code")
    return None


def resolve_product_code(symbol: str) -> str | None:
    return cache.get_or_set(
        f"toss_product:{symbol.upper()}",
        TTL_PRODUCT_SECONDS,
        lambda: _resolve_product_code(symbol.upper()),
    )


def _message(comment: dict) -> tuple[str, str]:
    message = comment.get("message") or {}
    title = str(message.get("title") or "").strip()
    text = str(message.get("message") or "").strip()
    # Toss can return a repost shell with its readable content nested inside it.
    if not title and not text and comment.get("repostComment"):
        repost_message = (comment["repostComment"].get("message") or {})
        title = str(repost_message.get("title") or "").strip()
        text = str(repost_message.get("message") or "").strip()
    return title, text


def _fetch_discussion(symbol: str, limit: int, offset: str | None) -> dict:
    product_code = resolve_product_code(symbol)
    if not product_code:
        return {"items": [], "next_offset": None}
    params = {
        "subjectType": "STOCK",
        "subjectId": product_code,
        "commentSortType": "RECENT",
    }
    if offset:
        params["lastCommentId"] = offset
    response = _session.get(f"{INFO_API}/api/v4/comments", params=params, timeout=4)
    response.raise_for_status()
    result = response.json().get("result") or {}
    comments = result.get("results") or []
    items = []
    for comment in comments:
        title, text = _message(comment)
        if not title and not text:
            continue
        author = comment.get("author") or {}
        statistic = comment.get("statistic") or {}
        items.append(
            {
                "id": str(comment.get("commentId") or ""),
                "title": title,
                "text": text,
                "author": author.get("nickname") or "",
                "written_at": comment.get("createdAt") or "",
                "likes": statistic.get("likeCount") or 0,
                "dislikes": 0,
                "views": statistic.get("readCount") or 0,
                "is_reply": comment.get("parentId") is not None,
            }
        )
        if len(items) >= limit:
            break
    next_offset = str(result.get("key")) if result.get("hasNext") and result.get("key") else None
    return {"items": items, "next_offset": next_offset}


def get_toss_discussion(symbol: str, limit: int = 10, offset: str | None = None) -> dict:
    symbol = symbol.upper()
    try:
        return cache.get_or_set(
            f"toss_discussion:{symbol}:{limit}:{offset or 'first'}",
            TTL_DISCUSSION_SECONDS,
            lambda: _fetch_discussion(symbol, limit, offset),
        )
    except Exception:
        return {"items": [], "next_offset": None}
