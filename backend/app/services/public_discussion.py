"""Source-bound pagination for public US stock/ETF discussion boards. No database."""
from urllib.parse import quote

from app.data import global_discussion_fetcher as naver
from app.data.toss_discussion_fetcher import get_toss_discussion
from app.data.toss_session import resolve_product_code


def get_public_discussion(code: str, limit: int, offset: str | None, discussion_type: str = "foreignStock") -> dict:
    code = code.strip().upper()
    source, cursor = None, offset
    if offset and offset[:2] in ("t:", "n:"):
        source, cursor = offset[0], offset[2:] or None
    elif offset and offset.startswith("-"):
        # Old open clients can still hold a raw Naver offset from before deployment.
        source = "n"

    def from_naver():
        data = naver.get_discussion(code, limit, cursor, discussion_type, raise_on_error=True)
        suffix = naver.resolve_naver_suffix(code)
        asset = "etf" if discussion_type == "foreignEtf" else "stock"
        return dict(data, next_offset=f"n:{data['next_offset']}" if data.get("next_offset") else None,
                    source="naver", source_label="네이버페이 증권",
                    source_url=f"https://m.stock.naver.com/worldstock/{asset}/{quote(code, safe='.-')}.{suffix}/discussion")

    if source == "n": return from_naver()
    try:
        product = resolve_product_code(code, raise_on_error=True)
        if product:
            data = get_toss_discussion(code, limit, cursor, raise_on_error=True)
            return dict(data, next_offset=f"t:{data['next_offset']}" if data.get("next_offset") else None,
                        source="toss", source_label="토스증권",
                        source_url=f"https://www.tossinvest.com/stocks/{quote(product, safe='')}/community")
    except Exception:
        # A page already in progress must not switch sources or reinterpret its cursor.
        if source == "t" or cursor: raise
    if source == "t": raise LookupError("Discussion listing unavailable")
    return from_naver()
