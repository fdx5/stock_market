from fastapi import APIRouter
from pydantic import BaseModel, Field, field_validator

from app.services import activity_log
from app.utils import SESSION_ID_PATTERN

router = APIRouter()

_VALID_TYPES = {"page_view", "click", "stock_view"}


class ActivityEvent(BaseModel):
    session_id: str = Field(pattern=SESSION_ID_PATTERN)
    type: str
    path: str = Field(min_length=1, max_length=200)
    label: str | None = Field(default=None, max_length=100)
    stock_code: str | None = Field(default=None, max_length=20)
    stock_name: str | None = Field(default=None, max_length=100)

    @field_validator("type")
    @classmethod
    def _valid_type(cls, value: str) -> str:
        if value not in _VALID_TYPES:
            raise ValueError(f"type must be one of {_VALID_TYPES}")
        return value


@router.post("/event")
def post_event(payload: ActivityEvent):
    activity_log.record_event(
        session_id=payload.session_id,
        event_type=payload.type,
        path=payload.path,
        label=payload.label,
        stock_code=payload.stock_code,
        stock_name=payload.stock_name,
    )
    return {"ok": True}
