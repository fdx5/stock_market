from fastapi import APIRouter, HTTPException, Query
from app.services.community_feed import listing, preview, comments

router = APIRouter()


@router.get("/{board}/comments")
def post_comments(board: str, snapshot: str = Query(..., pattern="^[a-f0-9]{32}$"), post_id: str = Query(..., pattern="^(pax|82)-[0-9]{1,20}$"), page: int = Query(1, ge=1, le=1000)):
    if board not in {"kr", "global", "property"}: raise HTTPException(404, "게시판을 찾을 수 없습니다.")
    try: return comments(board, snapshot, post_id, page)
    except LookupError: raise HTTPException(409, "목록이 만료되었습니다.") from None


@router.get("/{board}/preview")
@router.get("/{board}/post")
def post_preview(board: str, snapshot: str = Query(..., pattern="^[a-f0-9]{32}$"), post_id: str = Query(..., pattern="^(pax|82)-[0-9]{1,20}$")):
    if board not in {"kr", "global", "property"}: raise HTTPException(404, "게시판을 찾을 수 없습니다.")
    try: return preview(board, snapshot, post_id)
    except LookupError: raise HTTPException(409, "목록이 만료되었습니다.") from None


@router.get("/{board}")
def posts(board: str, page: int = Query(1, ge=1, le=1000), snapshot: str | None = Query(None, max_length=32, pattern="^[a-f0-9]{32}$"), q: str = Query("", max_length=100), source: str = Query("", max_length=40), topic: str = Query("", max_length=20), refresh: bool = False, background: bool = True):
    if board not in {"kr", "global", "property"}: raise HTTPException(404, "게시판을 찾을 수 없습니다.")
    try: return listing(board, page, snapshot, q.strip(), source, topic, refresh, background)
    except LookupError: raise HTTPException(409, "수집 목록이 만료되었습니다. 최신 목록을 다시 불러와 주세요.") from None
