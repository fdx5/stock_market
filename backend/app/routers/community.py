from fastapi import APIRouter, HTTPException, Query
from app.services.community_feed import listing, preview, comments, entry

router = APIRouter()
POST_ID = r"^(?:(?:pax|82)-[0-9]{1,20}|dc-(?:kospi|stockus|immovables)-[0-9]{1,20}|pp-(?:stock|house)-[0-9]{1,20}|cl-cm_stock-[0-9]{1,20}|da-(?:stock|free)-[0-9]{1,20}|tq-(?:stock|square|review)-[0-9]{1,20}|dog-stock-[0-9]{1,20}|bb-(?:strange|freeb)-[0-9]{1,20}|rw-300143-[0-9]{1,20}|toss-(?:NVDA|TSLA|IREN|PLTR|RKLB|SOFI|TQQQ|SOXL)-[0-9]{1,20})$"


@router.get('/{board}/entry')
def post_entry(board: str, post_id: str = Query(..., pattern=POST_ID), snapshot: str | None = Query(None, pattern='^[a-f0-9]{32}$')):
    if board not in {'kr','global','property'}: raise HTTPException(404, '게시판을 찾을 수 없습니다.')
    try: return entry(board, post_id, snapshot)
    except LookupError: raise HTTPException(404, '게시글을 찾을 수 없습니다.') from None
    except Exception: raise HTTPException(502, '공개 본문을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.') from None


@router.get("/{board}/comments")
def post_comments(board: str, snapshot: str = Query(..., pattern="^[a-f0-9]{32}$"), post_id: str = Query(..., pattern=POST_ID), page: int = Query(1, ge=1, le=1000)):
    if board not in {"kr", "global", "property"}: raise HTTPException(404, "게시판을 찾을 수 없습니다.")
    try: return comments(board, snapshot, post_id, page)
    except LookupError: raise HTTPException(409, "목록이 만료되었습니다.") from None


@router.get("/{board}/preview")
@router.get("/{board}/post")
def post_preview(board: str, snapshot: str = Query(..., pattern="^[a-f0-9]{32}$"), post_id: str = Query(..., pattern=POST_ID)):
    if board not in {"kr", "global", "property"}: raise HTTPException(404, "게시판을 찾을 수 없습니다.")
    try: return preview(board, snapshot, post_id)
    except LookupError: raise HTTPException(409, "목록이 만료되었습니다.") from None


@router.get("/{board}")
def posts(board: str, page: int = Query(1, ge=1, le=1000), snapshot: str | None = Query(None, max_length=32, pattern="^[a-f0-9]{32}$"), q: str = Query("", max_length=100), source: str = Query("", max_length=40), topic: str = Query("", max_length=20), refresh: bool = False, background: bool = True):
    if board not in {"kr", "global", "property"}: raise HTTPException(404, "게시판을 찾을 수 없습니다.")
    try: return listing(board, page, snapshot, q.strip(), source, topic, refresh, background)
    except LookupError: raise HTTPException(409, "수집 목록이 만료되었습니다. 최신 목록을 다시 불러와 주세요.") from None
