import datetime as dt
import os
import re
import shutil

from fastapi import APIRouter, HTTPException, Response

from app.services import movers

router = APIRouter()


@router.get("/current")
def current(response: Response, market: str = "kr"):
    response.headers["Cache-Control"] = "public, max-age=60"
    return movers.current(market="us" if market == "us" else "kr")


@router.get("/stock/{code}")
def stock(code: str, response: Response):
    """This stock's move and reason in the latest edition, or null (stock page banner)."""
    response.headers["Cache-Control"] = "public, max-age=120"
    return {"entry": movers.for_stock(code.upper()) if re.fullmatch(r"[A-Za-z0-9.]{1,12}", code) else None}


@router.get("/status")
def status(response: Response):
    from app.services import movers_store
    response.headers["Cache-Control"] = "no-store"
    since = (dt.datetime.now(movers.KST) - dt.timedelta(days=2)).isoformat(timespec="seconds")
    try:
        runs, store = movers_store.recent_runs(since, 20), "ok"
    except Exception as exc:
        runs, store = [], type(exc).__name__
    return {"scheduler": os.environ.get("MOVERS_SCHEDULER", "1") != "0",
            "cli": bool(shutil.which(os.environ.get("CLAUDE_CLI", "claude"))), "store": store,
            "runs": [{"slot": r["slot"], "at": r["at"], "event": r["event"], "trigger": r["trigger"]} for r in runs]}


@router.get("/social-performance")
def social_performance(response: Response, days: int = 14):
    """Visits brought by each automated SNS post (aggregate counts of our own campaigns only)."""
    import re
    from app.services import page_view_store
    response.headers["Cache-Control"] = "public, max-age=600"
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=max(1, min(days, 30)))).isoformat(timespec="seconds")
    rows = [r for r in page_view_store.social_campaign_views(since)
            if re.fullmatch(r"(world|movers|us_movers|hot|close|morning|evening)[a-z_]*-\d{8}(-\d{4})?", r["campaign"] or "")]
    return {"since": since, "posts": rows}


@router.get("/us/{day}/{hhmm}")
def us_by_slot(day: str, hhmm: str, response: Response):
    slot = movers.parse_slot(day, hhmm, "us")
    found = movers.edition(slot, "us") if slot else None
    if not found:
        raise HTTPException(status_code=404, detail="아직 발행되지 않은 판입니다")
    response.headers["Cache-Control"] = "public, max-age=600"
    return found


@router.get("/{day}/{hhmm}")
def by_slot(day: str, hhmm: str, response: Response):
    slot = movers.parse_slot(day, hhmm)
    found = movers.edition(slot) if slot else None
    if not found:
        raise HTTPException(status_code=404, detail="아직 발행되지 않은 판입니다")
    response.headers["Cache-Control"] = "public, max-age=600"
    return found
