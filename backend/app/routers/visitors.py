from fastapi import APIRouter, Query, Request

from app.services.visitor_tracker import tracker

router = APIRouter()

# crypto.randomUUID() is exactly what the frontend generates (see
# useVisitorCount.ts) — anything else is either a bug on the caller's end or a
# forged value, and it's the "no format check at all" gap that let a script mint
# unlimited distinct session_ids to both inflate the visitor counter and grow the
# tracker's in-memory session set without bound.
_SESSION_ID_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"


def _client_ip(request: Request) -> str | None:
    # This app runs behind Cloudflare in front of Render (confirmed: prod responses
    # carry Server: cloudflare / CF-RAY) — Cloudflare always sets CF-Connecting-IP to
    # the real connecting client IP, overwriting any value the client itself tried to
    # send, so it's used first. X-Forwarded-For's *first* entry, by contrast, is
    # exactly what an attacker's own request supplies and Cloudflare/Render typically
    # only *append* their own hop to rather than overwrite it — trusting it blindly
    # (as this app's other IP lookup, geo.py, does for a merely cosmetic default-
    # language pick) would let per-IP throttling below be trivially bypassed by
    # sending a different forged X-Forwarded-For on every request.
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip.strip()
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


@router.get("/count")
def visitor_count(request: Request, session_id: str = Query(..., pattern=_SESSION_ID_PATTERN)):
    current, total = tracker.heartbeat(session_id, _client_ip(request))
    return {"count": current, "total": total}
