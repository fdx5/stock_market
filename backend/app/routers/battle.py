from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.battle import get_battle, get_exchange_rate
from app.services.comment_store import add_comment, count_by_side, list_comments

router = APIRouter()


class CommentCreate(BaseModel):
    side: str
    username: str = Field(min_length=1, max_length=30)
    text: str = Field(min_length=1, max_length=200)


@router.get("/status")
def battle_status():
    data = get_battle()
    if not data["samsung"] or not data["skhynix"]:
        raise HTTPException(status_code=502, detail="시가총액 데이터를 가져오지 못했습니다.")
    return data


@router.get("/exchange")
def battle_exchange():
    rate = get_exchange_rate()
    if not rate:
        raise HTTPException(status_code=502, detail="환율 데이터를 가져오지 못했습니다.")
    return rate


@router.get("/comments")
def get_comments():
    return {"items": list_comments(200), "counts": count_by_side()}


@router.post("/comments")
def post_comment(payload: CommentCreate):
    if payload.side not in ("samsung", "skhynix"):
        raise HTTPException(status_code=400, detail="side는 samsung 또는 skhynix여야 합니다.")
    text = payload.text.strip()
    username = payload.username.strip()
    if not text:
        raise HTTPException(status_code=400, detail="댓글 내용을 입력해 주세요.")
    if not username:
        raise HTTPException(status_code=400, detail="사용자명이 필요합니다.")

    created_at = datetime.now(timezone.utc).isoformat()
    return add_comment(payload.side, username, text, created_at)
