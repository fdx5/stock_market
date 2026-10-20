import os
import secrets

from fastapi import APIRouter, Header, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field

from app.services import editorial

router = APIRouter()


class CollectorVideo(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{11}$")
    title: str = Field(min_length=1, max_length=500)
    channel: str = Field(max_length=200)
    views: int = Field(ge=0, strict=True)
    published_at: str = Field(max_length=50)
    duration_seconds: int | None = Field(default=None, ge=0)


class CollectorEdition(BaseModel):
    market: str = Field(pattern="^(kr|us)$")
    edition: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    collected_at: str = Field(max_length=50)
    candidate_count: int = Field(ge=1, le=10000)
    items: list[CollectorVideo] = Field(min_length=1, max_length=20)


@router.post("/videos/edition")
def collect_videos(payload: CollectorEdition, authorization: str | None = Header(None)):
    # Reuse the existing private batch credential unless a separate one is configured.
    token = os.environ.get("EDITORIAL_REFRESH_TOKEN") or os.environ.get("PREDICTION_BATCH_TOKEN")
    if not token:
        raise HTTPException(status_code=503, detail="Editorial collector is not configured")
    supplied = authorization[7:] if authorization and authorization.startswith("Bearer ") else ""
    if not supplied or not secrets.compare_digest(supplied, token):
        raise HTTPException(status_code=401, detail="Invalid collector authorization")
    data = payload.model_dump()
    for row in data["items"]:
        row.update(thumbnail=f'https://i.ytimg.com/vi/{row["id"]}/hqdefault.jpg',
                   url=f'https://www.youtube.com/watch?v={row["id"]}')
    try:
        return editorial.accept_video_edition(payload.market, data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@router.get("/videos")
def videos(response: Response, market: str = Query("kr", pattern="^(kr|us)$")):
    response.headers["Cache-Control"] = "no-store"
    return editorial.get_videos(market)


@router.get("/investors")
def investors(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return editorial.get_investors()


@router.get("/investors/{investor_id}")
def portfolio(investor_id: str, response: Response):
    response.headers["Cache-Control"] = "no-store"
    result = editorial.get_portfolio(investor_id)
    if result is None:
        raise HTTPException(status_code=404, detail="등록된 투자자를 찾을 수 없습니다.")
    return result
