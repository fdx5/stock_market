from fastapi import APIRouter
from pydantic import BaseModel, Field, field_validator

from app.services import activity_log
from app.utils import SESSION_ID_PATTERN

router = APIRouter()

_VALID_TYPES = {"page_view", "click", "stock_view", "hub"}

# What the entrance page is allowed to report. A closed set rather than free
# text: these become table rows, chart series and ranking groups, and a typo in
# the client would otherwise quietly open a new series that looks like real data.
_VALID_HUB_ACTIONS = {
    # A body in the sky, or a destination tile, was opened.
    "object_click",
    # A camera control: auto tour, Voyager tour, reset, focus release.
    "control",
    # Background music switched on or off — the label carries which.
    "bgm",
    # A body was looked at without being opened (first tap of the two-tap
    # open, or a hover held long enough to count as attention).
    "focus",
    # Seconds spent on the page with it actually in front of the visitor.
    "dwell",
    # The visitor left for somewhere else in the site, and where.
    "exit",
}

# One reading of the clock, not a stay. See hub_event_store.MAX_DWELL_SECONDS
# for the same ceiling applied again when the numbers are aggregated.
MAX_DWELL_VALUE = 3600.0


class ActivityEvent(BaseModel):
    session_id: str = Field(pattern=SESSION_ID_PATTERN)
    type: str
    path: str = Field(min_length=1, max_length=200)
    label: str | None = Field(default=None, max_length=100)
    stock_code: str | None = Field(default=None, max_length=20)
    stock_name: str | None = Field(default=None, max_length=100)
    action: str | None = Field(default=None, max_length=40)
    object_key: str | None = Field(default=None, max_length=100)
    value: float | None = Field(default=None, ge=0, le=MAX_DWELL_VALUE)
    referrer: str | None = Field(default=None, max_length=500)
    source_channel: str | None = Field(default=None, max_length=30)
    source_name: str | None = Field(default=None, max_length=100)
    utm_source: str | None = Field(default=None, max_length=100)
    utm_medium: str | None = Field(default=None, max_length=100)
    utm_campaign: str | None = Field(default=None, max_length=150)

    @field_validator("type")
    @classmethod
    def _valid_type(cls, value: str) -> str:
        if value not in _VALID_TYPES:
            raise ValueError(f"type must be one of {_VALID_TYPES}")
        return value

    @field_validator("action")
    @classmethod
    def _valid_action(cls, value: str | None) -> str | None:
        if value is not None and value not in _VALID_HUB_ACTIONS:
            raise ValueError(f"action must be one of {_VALID_HUB_ACTIONS}")
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
        action=payload.action,
        object_key=payload.object_key,
        value=payload.value,
        referrer=payload.referrer,
        source_channel=payload.source_channel,
        source_name=payload.source_name,
        utm_source=payload.utm_source,
        utm_medium=payload.utm_medium,
        utm_campaign=payload.utm_campaign,
    )
    return {"ok": True}
