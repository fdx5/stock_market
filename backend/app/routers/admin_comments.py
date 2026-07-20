from fastapi import APIRouter, Depends, HTTPException

from app.services import comment_store, fight_comment_store
from app.services.admin_auth import require_admin
from app.services.battle import get_global_top20_cached

router = APIRouter()

_BATTLE_SIDE_NAMES = {"samsung": "삼성전자", "skhynix": "SK하이닉스"}


@router.get("/comments", dependencies=[Depends(require_admin)])
def list_comments(limit: int = 200):
    """Merges the /battle (fixed samsung/skhynix) and /fight (dynamic matchup) cheer
    comment tables into one newest-first feed for the admin moderation panel."""
    roster_names = {item["code"]: item["name"] for item in get_global_top20_cached() if item.get("code")}

    items = [
        {
            "id": c["id"],
            "source": "battle",
            "stock_name": _BATTLE_SIDE_NAMES.get(c["side"], c["side"]),
            "text": c["text"],
            "created_at": c["created_at"],
        }
        for c in comment_store.list_comments(limit)
    ] + [
        {
            "id": c["id"],
            "source": "fight",
            "stock_name": roster_names.get(c["company_code"], c["company_code"]),
            "text": c["text"],
            "created_at": c["created_at"],
        }
        for c in fight_comment_store.list_all_comments(limit)
    ]
    items.sort(key=lambda c: c["created_at"], reverse=True)
    return {"items": items[:limit]}


@router.delete("/comments/{source}/{comment_id}", dependencies=[Depends(require_admin)])
def delete_comment(source: str, comment_id: int):
    if source == "battle":
        deleted = comment_store.delete_comment(comment_id)
    elif source == "fight":
        deleted = fight_comment_store.delete_comment(comment_id)
    else:
        raise HTTPException(status_code=400, detail="source는 battle 또는 fight여야 합니다.")
    if not deleted:
        raise HTTPException(status_code=404, detail="댓글을 찾을 수 없습니다.")
    return {"deleted": True}
