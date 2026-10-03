from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Literal

from app.services import comment_store, fight_comment_store, support_comment_store, supporter_store
from app.routers.support import MONTH_PATTERN, _plain, current_support_month
from app.services.admin_auth import require_admin
from app.services.battle import get_global_top20_cached

router = APIRouter()


class SupporterSave(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    month: str = Field(pattern=MONTH_PATTERN)
    nickname: str = Field(min_length=1, max_length=20)
    color: Literal['gold', 'silver']

    @field_validator('nickname')
    @classmethod
    def clean_nickname(cls, value):
        return _plain(value, 20)


@router.get('/supporters', dependencies=[Depends(require_admin)])
def list_supporters(month: str | None = Query(None, pattern=MONTH_PATTERN)):
    selected = month or current_support_month()
    return {'month': selected, 'items': supporter_store.list_supporters(selected)}


@router.post('/supporters', dependencies=[Depends(require_admin)])
def create_supporter(payload: SupporterSave):
    return supporter_store.save_supporter(payload.month, payload.nickname, payload.color)


@router.patch('/supporters/{supporter_id}', dependencies=[Depends(require_admin)])
def edit_supporter(supporter_id: int, payload: SupporterSave):
    result = supporter_store.save_supporter(payload.month, payload.nickname, payload.color, supporter_id)
    if result is None:
        raise HTTPException(409, '후원자를 찾을 수 없거나 같은 달에 동일한 닉네임이 있습니다.')
    return result


@router.delete('/supporters/{supporter_id}', dependencies=[Depends(require_admin)])
def remove_supporter(supporter_id: int):
    if not supporter_store.delete_supporter(supporter_id):
        raise HTTPException(404, '후원자를 찾을 수 없습니다.')
    return {'deleted': True}

_BATTLE_SIDE_NAMES = {"samsung": "삼성전자", "skhynix": "SK하이닉스"}


class VisibilityUpdate(BaseModel):
    visible: bool


@router.get("/comments", dependencies=[Depends(require_admin)])
def list_comments(limit: int = 200):
    """Merges the /battle (fixed samsung/skhynix) and /fight (dynamic matchup) cheer
    comment tables into one newest-first feed for the admin moderation panel — unlike
    the public endpoints, this includes hidden ('N') comments too, so the admin can
    see and toggle them back to visible."""
    roster_names = {item["code"]: item["name"] for item in get_global_top20_cached() if item.get("code")}

    items = [
        {
            "id": c["id"],
            "source": "battle",
            "stock_name": _BATTLE_SIDE_NAMES.get(c["side"], c["side"]),
            "text": c["text"],
            "created_at": c["created_at"],
            "visible": c["is_visible"] == "Y",
        }
        for c in comment_store.list_comments(limit, visible_only=False)
    ] + [
        {
            "id": c["id"],
            "source": "fight",
            "stock_name": roster_names.get(c["company_code"], c["company_code"]),
            "text": c["text"],
            "created_at": c["created_at"],
            "visible": c["is_visible"] == "Y",
        }
        for c in fight_comment_store.list_all_comments(limit)
    ]
    items.sort(key=lambda c: c["created_at"], reverse=True)
    return {"items": items[:limit]}


@router.get('/support-comments', dependencies=[Depends(require_admin)])
def list_support_comments(limit: int = Query(200, ge=1, le=200), before: int | None = Query(None, ge=1)):
    comments = support_comment_store.list_comments(limit + 1, before, visible_only=False)
    return {'items': [dict(id=c['id'], source='support', stock_name=c['username'], text=c['text'], created_at=c['created_at'], visible=c['is_visible'] == 'Y') for c in comments[:limit]],
            'next_before': comments[limit - 1]['id'] if len(comments) > limit else None}


@router.patch("/comments/{source}/{comment_id}/visibility", dependencies=[Depends(require_admin)])
def update_comment_visibility(source: str, comment_id: int, payload: VisibilityUpdate):
    if source == "battle":
        updated = comment_store.set_visibility(comment_id, payload.visible)
    elif source == "fight":
        updated = fight_comment_store.set_visibility(comment_id, payload.visible)
    elif source == "support":
        updated = support_comment_store.set_visibility(comment_id, payload.visible)
    else:
        raise HTTPException(status_code=400, detail="source는 battle, fight 또는 support여야 합니다.")
    if not updated:
        raise HTTPException(status_code=404, detail="댓글을 찾을 수 없습니다.")
    return {"visible": payload.visible}


@router.delete("/comments/{source}/{comment_id}", dependencies=[Depends(require_admin)])
def delete_comment(source: str, comment_id: int):
    if source == "battle":
        deleted = comment_store.delete_comment(comment_id)
    elif source == "fight":
        deleted = fight_comment_store.delete_comment(comment_id)
    elif source == "support":
        deleted = support_comment_store.delete_comment(comment_id)
    else:
        raise HTTPException(status_code=400, detail="source는 battle, fight 또는 support여야 합니다.")
    if not deleted:
        raise HTTPException(status_code=404, detail="댓글을 찾을 수 없습니다.")
    return {"deleted": True}
