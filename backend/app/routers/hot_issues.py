from fastapi import APIRouter, HTTPException, Response

from app.services import hot_issues

router = APIRouter()


@router.get("/current")
def current(response: Response):
    response.headers["Cache-Control"] = "public, max-age=60"
    return hot_issues.current()


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
