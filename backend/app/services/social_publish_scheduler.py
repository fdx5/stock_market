"""Request the social workflow from the running web service at KST posting times."""

import logging
import os
import threading
import time
from datetime import datetime, time as clock_time, timedelta, timezone

import requests

from app.services.trading_calendar import is_trading_day


log = logging.getLogger(__name__)
KST = timezone(timedelta(hours=9))
WORKFLOW_API = "https://api.github.com/repos/fdx5/stock_market/actions/workflows/social-publish.yml"
RECEIPTS = "https://raw.githubusercontent.com/fdx5/stock_market/social-post-assets/receipts"
SECRET_NAME = "SOCIAL_PUBLISH_DISPATCH_TOKEN"
POLL_SECONDS = 15
RETRY_SECONDS = 5 * 60


def due_slot(now: datetime):
    day = now.date()
    slots = [(clock_time(7, 15), "morning"), (clock_time(22, 15), "evening")]
    if is_trading_day(day, "KR"):
        slots.append((clock_time(16), "close"))
    for at, edition in slots:
        due = datetime.combine(day, at, KST)
        if due <= now < due + timedelta(minutes=90):
            return day.isoformat(), edition
    return None


def _confirmed(day: str, edition: str) -> bool:
    response = requests.get(f"{RECEIPTS}/{day}/{edition}.json", timeout=8)
    if response.status_code == 404:
        return False
    response.raise_for_status()
    receipt = response.json()
    return receipt.get("date") == day and receipt.get("edition") == edition and receipt.get("published") is True


def _dispatch(token: str, edition: str) -> bool:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    response = requests.get(WORKFLOW_API + "/runs", headers=headers, params={"per_page": 8}, timeout=8)
    response.raise_for_status()
    active = {"queued", "in_progress", "pending", "waiting", "requested"}
    if any(run["status"] in active for run in response.json()["workflow_runs"]):
        return False
    response = requests.post(
        WORKFLOW_API + "/dispatches",
        headers=headers,
        json={"ref": "main", "inputs": {"mode": "publish-current", "edition": edition}},
        timeout=8,
    )
    response.raise_for_status()
    return response.status_code in {200, 204}


def _run(token: str) -> None:
    last_slot = None
    next_attempt = 0.0
    verified = False
    while True:
        slot = due_slot(datetime.now(KST))
        if slot != last_slot:
            last_slot, next_attempt, verified = slot, 0.0, False
        if slot and not verified and time.monotonic() >= next_attempt:
            next_attempt = time.monotonic() + RETRY_SECONDS
            day, edition = slot
            try:
                verified = _confirmed(day, edition)
                if verified:
                    log.info("Social publication %s %s confirmed on all channels", day, edition)
                elif _dispatch(token, edition):
                    log.info("Requested social publication for %s %s", day, edition)
                else:
                    next_attempt = time.monotonic() + 2 * POLL_SECONDS
            except requests.HTTPError as exc:
                log.warning("Social publisher HTTP error for %s %s: %s", day, edition, exc.response.status_code)
            except (requests.RequestException, ValueError, KeyError) as exc:
                log.warning("Social publisher check failed for %s %s: %s", day, edition, type(exc).__name__)
        time.sleep(POLL_SECONDS)


def start_scheduler() -> None:
    token = os.getenv(SECRET_NAME, "").strip()
    if not token:
        log.info("Render social publication trigger is awaiting credentials")
        return
    threading.Thread(target=_run, args=(token,), name="social-publish-trigger", daemon=True).start()
    log.info("Render social publication trigger started")
