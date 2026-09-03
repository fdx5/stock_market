"""Read-only access to publicly visible Toss Securities stock communities."""

from app.data.toss_session import INFO_API, resolve_product_code, session
from app.services.cache import cache

TTL_DISCUSSION_SECONDS = 3 * 60

__all__ = ["get_toss_discussion", "resolve_product_code"]


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
    response = session.get(f"{INFO_API}/api/v4/comments", params=params, timeout=4)
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
