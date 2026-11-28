"""Local Naver blog worker — run by Windows Task Scheduler every 2 minutes.

    cd backend
    python scripts/naver_blog_worker.py                 # one tick: due SNS twins, briefs, daily perf
    python scripts/naver_blog_worker.py --status        # today's ledger
    python scripts/naver_blog_worker.py --test morning --date 2026-11-26 [--dry-run]
    python scripts/naver_blog_worker.py --test all --date 2026-11-26 --dry-run
    python scripts/naver_blog_worker.py --perf          # measure now

Why a PC and not the server: Naver refuses blog writes from the Render IP while the
same session publishes fine from here (docs/naver-blog-auto-publish-design.md §9).

A tick is cheap when nothing is due: the schedule is computed locally and the shared
ledger is only read for editions inside their window. Logs go to
backend/logs/naver_blog_worker.log; no cookies or tokens are ever written there.
"""

import argparse
import datetime as dt
import json
import logging
import logging.handlers
import os
import subprocess
import sys
import time
from pathlib import Path
from zoneinfo import ZoneInfo

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

KST = ZoneInfo("Asia/Seoul")
STATE = BACKEND / "app" / "data" / "store" / "naver_worker_state.json"
LOG = BACKEND / "logs" / "naver_blog_worker.log"


def _setup_logging(verbose: bool) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    handler = logging.handlers.RotatingFileHandler(LOG, maxBytes=2_000_000, backupCount=5, encoding="utf-8")
    handlers = [handler] + ([logging.StreamHandler(sys.stdout)] if verbose else [])
    logging.basicConfig(level=logging.INFO, handlers=handlers,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def _state() -> dict:
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_state(state: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")


def _version() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True,
                              cwd=BACKEND, timeout=10).stdout.strip() or "?"
    except Exception:
        return "?"


def _auto_update(state: dict, log) -> None:
    """Pulls origin/main at most hourly, so tuning and fixes pushed to main reach the PC."""
    if os.environ.get("NAVER_WORKER_AUTOUPDATE", "1") != "1":
        return
    last = state.get("pulled_at", 0)
    if time.time() - last < 3600:
        return
    state["pulled_at"] = time.time()
    try:
        out = subprocess.run(["git", "pull", "--ff-only", "-q", "origin", "main"], capture_output=True, text=True,
                             cwd=BACKEND, timeout=120)
        if out.returncode:
            log.warning("git pull failed: %s", (out.stderr or out.stdout)[:200])
    except Exception as exc:
        log.warning("git pull failed: %s", exc)


def tick(verbose: bool = False) -> int:
    from app.services import naver_publish_store, naver_publisher, naver_social_publisher, naver_social_store

    log = logging.getLogger("naver_blog_worker")
    state = _state()
    now = dt.datetime.now(KST)
    naver_publisher._alert = lambda text: None  # the PC never sends account messages

    if time.time() - state.get("beat_at", 0) >= 600:
        try:
            naver_social_store.heartbeat(_version(), f"tick {now:%H:%M}")
            state["beat_at"] = time.time()
        except Exception:
            log.exception("heartbeat failed")

    code = 0
    due = naver_social_publisher.due(now, recover=True)
    if due:
        done = set(state.get("done", []))
        if any(f"{d}:{e}" not in done for d, e in due):
            result = naver_social_publisher.run_due(now)
            log.info("social: %s", json.dumps({k: v for k, v in result.items() if v}, ensure_ascii=False, default=str)[:1500])
            if verbose:
                print(json.dumps(result, ensure_ascii=False, indent=1, default=str))
            if result["status"] in ("all_done",):
                # "all_done" only means nothing was open for *this* worker — a row can be
                # claimed by another worker that then fails (11-26 12:00: the server held
                # the midday post, hit 502s, and the PC had already written it off). Only
                # rows that are really finished are remembered as done.
                for d, e in due:
                    row = naver_social_store.get(naver_social_store.key(d, e)) or {}
                    if row.get("status") in ("published", "skipped") or (row.get("attempts") or 0) >= naver_social_store.MAX_ATTEMPTS:
                        done.add(f"{d}:{e}")
            elif result["status"] not in ("ok", "nothing_due", "busy", "deferred"):
                code = 1
            for item in result.get("published", []):
                done.add(item["key"])
            state["done"] = sorted(set(state.get("done", [])) | done)[-60:]

    # Closing briefs (7 posts): KRX days 16:20–23:00, every 10 minutes until all are out.
    from app.services import trading_calendar
    if (trading_calendar.is_trading_day(now.date(), "KR") and dt.time(16, 20) <= now.time() < dt.time(23, 0)
            and state.get("briefs_done") != now.date().isoformat()
            and time.time() - state.get("briefs_at", 0) >= 600):
        state["briefs_at"] = time.time()
        _save_state(state)
        try:
            result = naver_publisher.run(now.date().isoformat(), triggered_by="local")
            log.info("briefs: %s", json.dumps({k: v for k, v in result.items() if v}, ensure_ascii=False, default=str)[:1500])
            if result["status"] == "nothing_to_do":
                rows = [r for r in naver_publish_store.recent(10) if r["report_date"] == now.date().isoformat()]
                if len(rows) >= 7 and all(r["status"] == "published" for r in rows):
                    state["briefs_done"] = now.date().isoformat()
        except Exception:
            log.exception("brief publish failed")
            code = 1

    # Daily performance pass for the tuning loop.
    if now.time() >= dt.time(23, 30) and state.get("perf_day") != now.date().isoformat():
        try:
            from app.services import naver_social_perf
            log.info("perf: %s", naver_social_perf.collect(now.date()))
            state["perf_day"] = now.date().isoformat()
        except Exception:
            log.exception("perf collection failed")

    # Each tick is a fresh process, so pulling at the end of one is safe; the next tick
    # runs the new code. (Waiting for "nothing due" never happened on trading days —
    # the windows overlap from 06:50 to 23:00 — and the PC ran day-old code.)
    _auto_update(state, log)
    _save_state(state)
    return code


def status() -> int:
    from app.services import naver_social_content, naver_social_publisher, naver_social_store

    now = dt.datetime.now(KST)
    days = [(now.date() - dt.timedelta(days=1)).isoformat(), now.date().isoformat()]
    rows = {r["post_key"]: r for r in naver_social_store.for_days(days)}
    print(f"{'시각':<6} {'판':<16} {'상태':<11} {'시도':<4} 주소/사유")
    for day in days:
        d = dt.date.fromisoformat(day)
        for edition, spec in naver_social_content.EDITIONS.items():
            if not naver_social_publisher.applies(d, edition):
                continue
            r = rows.get(f"{day}:{edition}")
            print(f"{day[5:]} {spec[0]} {edition:<16} {(r or {}).get('status', '-'):<11} {(r or {}).get('attempts', ''):<4} "
                  f"{(r or {}).get('post_url') or ((r or {}).get('last_error') or '')[:70]}")
    print("worker:", naver_social_store.worker_status())
    return 0


def test(editions: list[str], day: dt.date, dry_run: bool) -> int:
    from app.services import naver_social_content, naver_social_publisher

    names = list(naver_social_content.EDITIONS) if editions == ["all"] else editions
    result = naver_social_publisher.run_due(dry_run=dry_run, only=names, force_day=day,
                                           weekly_profile=names == ["weekly_market"])
    print(json.dumps(result, ensure_ascii=False, indent=1, default=str))
    return 0 if result["status"] in ("ok", "all_done") else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="네이버 블로그 로컬 발행기")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--test", nargs="+", help="판 이름(들) 또는 all — 시각과 무관하게 해당 날짜로 발행")
    parser.add_argument("--date", help="--test 날짜 (YYYY-MM-DD, 기본 오늘 KST)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--perf", action="store_true")
    parser.add_argument("--weekly", action="store_true", help="현재 발행 창의 주간 시황만 처리")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()
    _setup_logging(args.verbose or bool(args.test) or args.perf)
    if args.status:
        return status()
    if args.perf:
        from app.services import naver_social_perf
        print(naver_social_perf.collect())
        return 0
    if args.test:
        day = dt.date.fromisoformat(args.date) if args.date else dt.datetime.now(KST).date()
        return test(args.test, day, args.dry_run)
    if args.weekly:
        from app.services import naver_social_publisher

        result = naver_social_publisher.run_due(only=["weekly_market"], dry_run=args.dry_run, weekly_profile=True)
        logging.getLogger(__name__).info("Weekly blog delivery: %s", json.dumps(result, ensure_ascii=False))
        if result["status"] in ("all_done", "nothing_due") or result["published"] or result["verified"]:
            return 0
        return 1
    return tick(args.verbose)


if __name__ == "__main__":
    raise SystemExit(main())
