"""Read-only access to publicly visible Toss Securities stock communities."""

from app.data.toss_session import request_json, resolve_product_code
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
    # Transient lookup failure must raise: caching it as an empty board would erase
    # the last successful comments during stale-while-revalidate.
    product_code = resolve_product_code(symbol, raise_on_error=True)
    if not product_code:
        return {"items": [], "next_offset": None}
    params = {
        "subjectType": "STOCK",
        "subjectId": product_code,
        "commentSortType": "RECENT",
    }
    if offset:
        params["lastCommentId"] = offset
    items, seen = [], set()
    next_offset = offset
    # Public pages include an eleventh look-ahead row. Its key would skip that
    # row when showing ten items, so continue from the last row actually emitted.
    # Bounded extra reads fill short pages containing unreadable/repost shells.
    for _ in range(6):
        if next_offset: params["lastCommentId"] = next_offset
        result = request_json("GET", "/api/v4/comments", host="cert", params=params, list_field="results")["result"]
        comments = result.get("results") or []
        for index, comment in enumerate(comments):
            title, text = _message(comment)
            comment_id = str(comment.get("commentId") or "")
            if not comment_id or comment_id in seen or not (title or text): continue
            seen.add(comment_id)
            author = comment.get("author") or {}
            statistic = comment.get("statistic") or {}
            items.append({
                "id": comment_id, "title": title, "text": text,
                "author": author.get("nickname") or "",
                "written_at": comment.get("createdAt") or "",
                "likes": statistic.get("likeCount") or 0, "dislikes": 0,
                "views": statistic.get("readCount") or 0,
                "is_reply": comment.get("parentId") is not None,
            })
            if len(items) >= limit:
                more = index < len(comments) - 1 or result.get("hasNext")
                return {"items": items, "next_offset": comment_id if more else None}
        cursor = str(result["key"]) if result.get("hasNext") and result.get("key") else None
        if not comments or not cursor or cursor == next_offset:
            next_offset = None
            break
        next_offset = cursor
    return {"items": items, "next_offset": next_offset}


def get_toss_discussion(symbol: str, limit: int = 10, offset: str | None = None, *, raise_on_error: bool = False) -> dict:
    symbol = symbol.upper()
    try:
        return cache.get_or_set(
            f"toss_discussion:{symbol}:{limit}:{offset or 'first'}",
            TTL_DISCUSSION_SECONDS,
            lambda: _fetch_discussion(symbol, limit, offset),
        )
    except Exception:
        if raise_on_error: raise
        return {"items": [], "next_offset": None}
