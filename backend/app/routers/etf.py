from fastapi import APIRouter, HTTPException, Query, Response

from app.services.etf_market import get_etf_discussions, get_etfs
from app.services.public_discussion import get_public_discussion

router = APIRouter()


@router.get("")
def etf_market(response: Response, region: str = Query("KR", pattern="^(KR|US)$")):
    response.headers["Cache-Control"] = "no-store"
    return get_etfs(region)


@router.get("/discussions")
def etf_discussions(response: Response, region: str = Query("KR", pattern="^(KR|US)$")):
    response.headers["Cache-Control"] = "no-store"
    return {"items": get_etf_discussions(region)}


@router.get("/{code}/quote")
def etf_quote(code: str, response: Response, region: str = Query("KR", pattern="^(KR|US)$")):
    response.headers["Cache-Control"] = "no-store"
    normalized = code.strip().upper()
    item = next((item for item in get_etfs(region)["items"] if item["code"].upper() == normalized), None)
    if item is None:
        raise HTTPException(status_code=404, detail="ETF quote not found")
    return item


@router.get("/{code}/toss-discussion")
def toss_etf_discussion(
    code: str,
    response: Response,
    limit: int = Query(10, ge=1, le=30),
    offset: str | None = Query(None, max_length=64),
):
    response.headers["Cache-Control"] = "no-store"
    try: return get_public_discussion(code, limit, offset, "foreignEtf")
    except Exception: raise HTTPException(503, "종목토론 수집이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.") from None
