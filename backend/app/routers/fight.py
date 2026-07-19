from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.services.company_news import get_article_content_translated, get_company_news_translated
from app.services.fight import get_fight_pair
from app.services.fight_comment_store import add_comment, count_by_company, list_comments_for_pair

router = APIRouter()


class FightCommentCreate(BaseModel):
    company_code: str = Field(min_length=1, max_length=20)
    username: str = Field(min_length=1, max_length=30)
    text: str = Field(min_length=1, max_length=200)


@router.get("/status")
def fight_status(a: str = Query(..., min_length=1), b: str = Query(..., min_length=1)):
    pair = get_fight_pair(a, b)
    if not pair:
        raise HTTPException(status_code=404, detail="선택한 기업의 시가총액 데이터를 찾을 수 없습니다.")
    return pair


@router.get("/news")
def fight_news(
    code: str = Query(..., min_length=1),
    name: str = Query(..., min_length=1),
    lang: str = Query("ko"),
    limit: int = Query(6, ge=1, le=20),
):
    return {"items": get_company_news_translated(code, name, lang, limit)}


@router.get("/news/article")
def fight_news_article(
    link: str = Query(..., min_length=1),
    code: str = Query(..., min_length=1),
    lang: str = Query("ko"),
):
    content = get_article_content_translated(link, code.endswith(".KS"), lang)
    return {"paragraphs": content["paragraphs"] if content else None}


@router.get("/comments")
def get_fight_comments(a: str = Query(..., min_length=1), b: str = Query(..., min_length=1)):
    return {"items": list_comments_for_pair(a, b, 200), "counts": count_by_company(a, b)}


@router.post("/comments")
def post_fight_comment(payload: FightCommentCreate):
    text = payload.text.strip()
    username = payload.username.strip()
    if not text:
        raise HTTPException(status_code=400, detail="댓글 내용을 입력해 주세요.")
    if not username:
        raise HTTPException(status_code=400, detail="사용자명이 필요합니다.")

    created_at = datetime.now(timezone.utc).isoformat()
    return add_comment(payload.company_code, username, text, created_at)
