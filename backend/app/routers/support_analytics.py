from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query, HTTPException
from app.services.admin_auth import require_admin
from app.services import support_analytics_store
from app.utils import SESSION_ID_PATTERN

router = APIRouter(dependencies=[Depends(require_admin)])


@router.get('/support-log')
def support_log(hours: int = 24, offset: int = Query(0, ge=0, le=100000),
                session_id: str | None = Query(None, pattern=SESSION_ID_PATTERN)):
    if hours not in (24, 48, 72, 168):
        raise HTTPException(422, 'Invalid range')
    now = datetime.now(timezone.utc)
    since = (now - timedelta(hours=hours)).isoformat()
    return {"hours": hours, "since": since, "until": now.isoformat(),
            **support_analytics_store.read(since, now.isoformat(), offset, session_id)}
