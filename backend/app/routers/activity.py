from fastapi import APIRouter, BackgroundTasks, Request, Response
from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Literal

from app.services import activity_log, audience_analytics, audience_location, audience_live, bot_detector
from app.utils import SESSION_ID_PATTERN

router = APIRouter()

_VALID_TYPES = {"page_view", "click", "stock_view", "hub", "support"}

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


@router.get("/audience-config")
def audience_config(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return {"enabled": audience_analytics.ready(),
            "location_enabled": audience_live.ready(), "presence_enabled": audience_live.ready()}


class LocationObservation(BaseModel):
    browser_id: str = Field(pattern=SESSION_ID_PATTERN)
    session_id: str = Field(pattern=SESSION_ID_PATTERN)
    consent: Literal[True]
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    accuracy_m: float = Field(gt=0, le=5000, allow_inf_nan=False)


@router.post("/audience-location")
def audience_location_observation(payload: LocationObservation, request: Request):
    observation = audience_analytics.context(request, payload.browser_id, payload.session_id,
                                            bot_detector.is_bot(request.headers.get("user-agent")))
    accepted = bool(observation and audience_live.record(observation, {
        "latitude": payload.latitude, "longitude": payload.longitude, "accuracy_m": payload.accuracy_m}))
    if accepted and audience_location.enabled():
        audience_location.resolve(observation, payload.latitude, payload.longitude, payload.accuracy_m)
    return {"accepted": accepted}


class PresenceObservation(BaseModel):
    browser_id: str = Field(pattern=SESSION_ID_PATTERN)
    session_id: str = Field(pattern=SESSION_ID_PATTERN)


@router.post("/audience-presence")
def audience_presence(payload: PresenceObservation, request: Request):
    observation = audience_analytics.context(request, payload.browser_id, payload.session_id,
                                            bot_detector.is_bot(request.headers.get("user-agent")))
    if not observation:
        return {"accepted": False}
    stored = audience_analytics.record(observation)
    # These are separate observations: a busy aggregate store must not prevent
    # the encrypted session store from recording the visit (or vice versa).
    presence_stored = audience_live.record(observation)
    return {"accepted": stored and presence_stored}


class DeviceInfo(BaseModel):
    model: str | None = Field(default=None, max_length=80)
    platform: str | None = Field(default=None, max_length=40)
    ipad: bool = False
    mobile: bool | None = None


class ActivityEvent(BaseModel):
    session_id: str = Field(pattern=SESSION_ID_PATTERN)
    browser_id: str | None = Field(default=None, pattern=SESSION_ID_PATTERN)
    automated: bool = False
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
    device_info: DeviceInfo | None = None
    occurred_at: float | None = Field(default=None, ge=0, allow_inf_nan=False)

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

    @model_validator(mode="after")
    def support_packet(self):
        if self.type == "support":
            import re
            if (self.path != "/support" or self.action != "dwell"
                or not self.object_key or not re.fullmatch(SESSION_ID_PATTERN, self.object_key)
                or self.value is None or not 0 < self.value <= 30):
                raise ValueError("Invalid support dwell packet")
        return self


@router.post("/event")
def post_event(payload: ActivityEvent, request: Request, background_tasks: BackgroundTasks):
    # This is where a JS-rendering crawler enters the analytics: it executes
    # useActivityTracking.ts exactly as a browser does, so the payload alone is
    # indistinguishable from a person's. The one thing that does distinguish them is a
    # request header nothing here used to read - Googlebot's beacons carry Googlebot's
    # User-Agent - so it is read here, at the only point where the header still exists,
    # and carried down with the event rather than guessed at afterwards.
    user_agent = bot_detector.normalize_user_agent(request.headers.get("user-agent"))
    is_bot = payload.automated or bot_detector.is_bot(user_agent)
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
        user_agent=user_agent,
        is_bot=is_bot,
        device_info=payload.device_info.model_dump() if payload.device_info else None,
        occurred_at=payload.occurred_at,
    )
    if payload.type == "page_view" and not payload.path.split("?", 1)[0].startswith("/admin"):
        observation = audience_analytics.context(request, payload.browser_id, payload.session_id,
                                                 is_bot, allow_session_only=True)
        if observation:
            if observation["browser"]:
                background_tasks.add_task(audience_analytics.record, observation)
            background_tasks.add_task(audience_live.record, observation)
    return {"ok": True}
