from fastapi import APIRouter, Query, Response

from app.services.etf_market import get_etf_discussions, get_etfs
from app.data.toss_discussion_fetcher import get_toss_discussion

router = APIRouter()


@router.get("")
def etf_market(response: Response, region: str = Query("KR", pattern="^(KR|US)$")):
    response.headers["Cache-Control"] = "no-store"
    return get_etfs(region)


@router.get("/discussions")
def etf_discussions(response: Response, region: str = Query("KR", pattern="^(KR|US)$")):
    response.headers["Cache-Control"] = "no-store"
    return {"items": get_etf_discussions(region)}


@router.get("/{code}/toss-discussion")
def toss_etf_discussion(
    code: str,
    response: Response,
    limit: int = Query(10, ge=1, le=10),
    offset: str | None = Query(None, max_length=32),
):
    response.headers["Cache-Control"] = "no-store"
    return get_toss_discussion(code, limit, offset)
