import pandas as pd
from fastapi import Request

# crypto.randomUUID() is exactly what the frontend generates for its session id
# (see frontend/src/session.ts) — anything else is either a bug on the caller's
# end or a forged value. Shared by every endpoint that accepts a client-supplied
# session_id (visitor heartbeat, activity events) so they all reject the same way.
SESSION_ID_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"


def client_ip(request: Request) -> str | None:
    """The real connecting IP, for anything that throttles per client.

    This app runs behind Cloudflare in front of Render (confirmed: prod responses carry
    Server: cloudflare / CF-RAY) — Cloudflare always sets CF-Connecting-IP to the real
    connecting client IP, overwriting any value the client itself tried to send, so it's
    used first. X-Forwarded-For's *first* entry, by contrast, is exactly what an
    attacker's own request supplies and Cloudflare/Render typically only *append* their
    own hop to rather than overwrite it — trusting it blindly (as this app's merely
    cosmetic IP lookup, geo.py, does for a default-language pick) would let per-IP
    throttling be bypassed by sending a different forged X-Forwarded-For per request.
    """
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip.strip()
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def _clean_value(value):
    if value is None:
        return None
    if isinstance(value, float) and pd.isna(value):
        return None
    if hasattr(value, "item"):
        return value.item()
    return value


def dataframe_to_records(df: pd.DataFrame) -> list[dict]:
    records = df.to_dict(orient="records")
    return [{key: _clean_value(value) for key, value in record.items()} for record in records]
