from fastapi import APIRouter, HTTPException, Response

from app.services import hot_issues

router = APIRouter()


@router.get("/current")
def current(response: Response):
    response.headers["Cache-Control"] = "public, max-age=60"
    return hot_issues.current()


def _reason(detail: str) -> str:
    text = (detail or "").lower()
    if any(k in text for k in ("not found", "찾을 수 없", "no such file")):
        return "cli_missing"
    if any(k in text for k in ("auth", "login", "401", "403", "credential", "token", "api key")):
        return "auth"
    if "timeout" in text or "timed out" in text:
        return "timeout"
    if "structured output" in text:
        return "no_output"
    if "valueerror" in text or "publishable" in text or "headline" in text:
        return "validation"
    return "other"


@router.get("/status")
def status(response: Response):
    """Public, coarse writer status (no raw error text): is the server writing editions?"""
    import datetime as dt
    import shutil
    import os
    from app.services import hot_issue_store
    response.headers["Cache-Control"] = "no-store"
    since = (dt.datetime.now(hot_issues.KST) - dt.timedelta(days=2)).isoformat(timespec="seconds")
    try:
        runs = hot_issue_store.recent_runs(since, 20)
        store = "ok"
    except Exception as exc:
        runs, store = [], type(exc).__name__
    return {
        "scheduler": os.environ.get("HOT_ISSUES_SCHEDULER", "1") != "0",
        "cli": bool(shutil.which(os.environ.get("CLAUDE_CLI", "claude"))),
        "subscription_token": bool(os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")),
        "store": store,
        "runs": [{"slot": r["slot"], "at": r["at"], "event": r["event"], "trigger": r["trigger"],
                  **({"reason": _reason(r["detail"] or "")} if r["event"] == "failed" else {})} for r in runs],
    }


@router.get("/{day}/{hhmm}")
def by_slot(day: str, hhmm: str, response: Response):
    slot = hot_issues.parse_slot(day, hhmm)
    if slot is None:
        raise HTTPException(status_code=404, detail="없는 판입니다")
    found = hot_issues.edition(slot)
    if not found:
        raise HTTPException(status_code=404, detail="아직 발행되지 않은 판입니다")
    response.headers["Cache-Control"] = "public, max-age=600"
    return found
