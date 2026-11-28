"""One day of every scheduled job, by service, with what actually happened. Read-only.

Each job is judged from what it leaves behind, so the board survives restarts:
SNS posts by their receipts on the public social-post-assets branch, hot issues and
movers by their append-only stores and run logs, briefs and blog posts by their tables,
predictions and DRAM by the latest stored rows. Jobs that only keep in-process state
(Kakao sends) report what this process remembers.

Status vocabulary: ok · failed · missed (due, nothing recorded) · running · pending · off (not a session day).
"""
from __future__ import annotations

import datetime as dt
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

import requests

KST = ZoneInfo("Asia/Seoul")
RECEIPTS = "https://raw.githubusercontent.com/fdx5/stock_market/social-post-assets/receipts"
RUNS_API = "https://api.github.com/repos/fdx5/stock_market/actions/workflows/social-publish.yml/runs"
GROUPS = [
    {"key": "sns", "label": "SNS 자동 게시", "hint": "Buffer → X · Threads · Bluesky"},
    {"key": "content", "label": "콘텐츠 자동 생성", "hint": "핫이슈 · 급등락 이유 · 장마감 브리핑"},
    {"key": "blog", "label": "네이버 블로그", "hint": "SNS 판과 같은 시각 · 장마감 브리핑 · 로컬 PC 발행기"},
    {"key": "tistory", "label": "티스토리", "hint": "서버 원고 자동 작성 · 공개 RSS 확인"},
    {"key": "data", "label": "예측·데이터 배치", "hint": "AI 예측 · D램 현물가"},
    {"key": "notify", "label": "알림", "hint": "카카오톡 알림"},
]
# (edition, HH:MM, label, session rule) — the KST post times of scripts/social_publish.py
SNS = [
    ("us_movers_open", "00:50", "나스닥100 개장 직후 급등락", "us-prev"),
    ("us_movers_close", "06:50", "나스닥100 마감 급등락", "us-prev"),
    ("nasdaq_close", "07:00", "나스닥100 마감 히트맵", "us-prev"),
    ("morning", "07:15", "오늘의 핫이슈 아침판", "daily"),
    ("world_morning", "08:00", "세계 증시 성적표 아침", "daily"),
    ("movers_open", "09:30", "국내 장 초반 급등락", "kr"),
    ("midday", "12:00", "코스피·코스닥 장중 점검 히트맵", "kr"),
    ("movers_noon", "12:40", "국내 점심 급등락", "kr"),
    ("close", "16:00", "코스피·코스닥 장마감 히트맵", "kr"),
    ("movers_close", "16:15", "국내 장 마감 급등락", "kr"),
    ("world_evening", "17:00", "세계 증시 성적표 저녁", "daily"),
    ("weekly_market", "18:00", "코스피·코스닥·나스닥 주간 시황", "saturday"),
    ("us_movers_pre", "21:10", "나스닥100 프리마켓 급등락", "us"),
    ("evening", "22:15", "오늘의 핫이슈 밤판", "daily"),
]
GRACE = dt.timedelta(minutes=50)
# When each job first went live: earlier slots are "off (도입 전)", not failures.
SINCE = {
    "sns:movers_": dt.datetime(2026, 11, 26, 9, 20, tzinfo=KST), "movers:kr:": dt.datetime(2026, 11, 25, 16, 0, tzinfo=KST),
    "sns:us_movers_": dt.datetime(2026, 11, 25, 21, 0, tzinfo=KST), "movers:us:": dt.datetime(2026, 11, 25, 21, 0, tzinfo=KST),
    "sns:world_": dt.datetime(2026, 11, 25, 17, 0, tzinfo=KST),
    "sns:midday": dt.datetime(2026, 11, 26, 12, 0, tzinfo=KST), "sns:nasdaq_close": dt.datetime(2026, 11, 26, 7, 0, tzinfo=KST),
}
SINCE["sns:movers_close"] = dt.datetime(2026, 11, 25, 16, 0, tzinfo=KST)


def _before_launch(job: dict, day: dt.date) -> bool:
    start = max((v for k, v in SINCE.items() if job["id"].startswith(k)), default=None)
    return bool(start) and _at(day, job["at"]) < start
_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()


def _trading(day: dt.date, region: str) -> bool:
    try:
        from app.services.trading_calendar import is_trading_day
        return is_trading_day(day, region)
    except Exception:
        return day.weekday() < 5


def _at(day: dt.date, hhmm: str) -> dt.datetime:
    h, m = map(int, hhmm.split(":"))
    return dt.datetime(day.year, day.month, day.day, h, m, tzinfo=KST)


def _judge(now: dt.datetime, due: dt.datetime, done: bool, failed: bool = False, grace: dt.timedelta = GRACE) -> str:
    if done:
        return "ok"
    if failed:
        return "failed"
    if now < due:
        return "pending"
    return "running" if now < due + grace else "missed"


def _applies(day: dt.date, rule: str) -> bool:
    if rule == "saturday":
        return day.weekday() == 5
    if rule == "kr":
        return _trading(day, "KR")
    if rule == "us":
        return _trading(day, "US")
    if rule == "us-prev":
        return _trading(day - dt.timedelta(days=1), "US")
    return True


def _receipt(day: dt.date, edition: str) -> bool:
    try:
        r = requests.get(f"{RECEIPTS}/{day}/{edition}.json", timeout=6)
        return r.status_code == 200 and r.json().get("published") is True
    except Exception:
        return False


def _sns(day: dt.date, now: dt.datetime) -> list[dict]:
    with ThreadPoolExecutor(max_workers=8) as pool:
        scheduled = [row for row in SNS if _applies(day, row[3])]
        receipts = dict(zip([e for e, *_ in scheduled], pool.map(lambda e: _receipt(day, e[0]), scheduled)))
    jobs = []
    for edition, hhmm, label, rule in SNS:
        due = _at(day, hhmm)
        if not _applies(day, rule):
            if rule == "saturday":
                continue
            jobs.append({"id": f"sns:{edition}", "group": "sns", "at": hhmm, "name": label, "status": "off", "detail": "휴장일이라 쉽니다"})
            continue
        status = _judge(now, due, receipts[edition], grace=dt.timedelta(hours=3))
        detail = ("3개 채널 게시 확인" if status == "ok" else "예정" if status == "pending"
                  else "게시 진행 중(최대 3시간 재시도)" if status == "running" else "게시 확인 기록 없음 — 아래 실행 기록 확인")
        jobs.append({"id": f"sns:{edition}", "group": "sns", "at": hhmm, "name": label, "status": status, "detail": detail,
                     "edition": edition})
    return jobs


def _runs_detail(runs: list[dict]) -> tuple[bool, str]:
    failed = [r for r in runs if r["event"] == "failed"]
    return bool(failed), (failed[-1]["detail"] or "")[:160] if failed else ""


def _hot(day: dt.date, now: dt.datetime) -> list[dict]:
    from app.services import hot_issue_store
    jobs = []
    for hhmm in ("07:00", "22:00"):
        due = _at(day, hhmm)
        k = due.isoformat(timespec="minutes")
        try:
            done = bool(hot_issue_store.get_edition(k))
            runs = hot_issue_store.runs_for(k)
        except Exception as exc:
            jobs.append({"id": f"hot:{hhmm}", "group": "content", "at": hhmm, "name": f"오늘의 핫이슈 {hhmm}판", "status": "failed",
                         "detail": f"저장소 오류 {type(exc).__name__}"})
            continue
        failed, why = _runs_detail(runs)
        # The writer starts 25 minutes early and retries for up to 3 hours.
        status = _judge(now, due - dt.timedelta(minutes=25), done, failed and len(runs) >= 6, grace=dt.timedelta(hours=3))
        jobs.append({"id": f"hot:{hhmm}", "group": "content", "at": hhmm, "name": f"오늘의 핫이슈 {hhmm}판", "status": status,
                     "detail": "발행됨" if done else why or ("작성 중" if status == "running" else "예정" if status == "pending" else "발행 기록 없음"),
                     "link": f"/hot-issues/{day}/{hhmm.replace(':', '')}" if done else None})
    return jobs


def _movers(day: dt.date, now: dt.datetime) -> list[dict]:
    from app.services import movers, movers_store
    jobs = []
    plan = [("kr", s) for s in movers.slot_times(day, "kr")] + [("us", s) for s in movers.slot_times(day - dt.timedelta(days=1), "us") if s.date() == day] \
        + [("us", s) for s in movers.slot_times(day, "us") if s.date() == day]
    for market, slot in plan:
        hhmm = f"{slot:%H:%M}"
        name = f"{'나스닥100' if market == 'us' else '국내'} 급등락 이유 {movers.SLOT_NAMES[f'{slot:%H%M}']}"
        if not movers.is_trading_day(movers.session_day(slot, market), market):
            jobs.append({"id": f"movers:{market}:{hhmm}", "group": "content", "at": hhmm, "name": name, "status": "off", "detail": "휴장일이라 쉽니다"})
            continue
        k = movers.key(slot, market)
        try:
            stored = movers_store.get_edition(k + movers.REVISION) or movers_store.get_edition(k)
            runs = movers_store.runs_for(k) + movers_store.runs_for(k + movers.REVISION)
        except Exception as exc:
            jobs.append({"id": f"movers:{market}:{hhmm}", "group": "content", "at": hhmm, "name": name, "status": "failed",
                         "detail": f"저장소 오류 {type(exc).__name__}"})
            continue
        failed, why = _runs_detail(runs)
        status = _judge(now, slot, bool(stored), failed and sum(r["event"] == "started" for r in runs) >= movers.MAX_ATTEMPTS,
                        grace=dt.timedelta(minutes=30))
        detail = why or "예정"
        if stored:
            model = str(stored.get("model") or "")
            detail = f"{len(stored.get('stocks') or [])}종목 · {'Opus' if 'opus' in model else '대체 문장' if model == 'headlines' else model}"
        elif status == "running":
            detail = "작성 중"
        elif status == "missed":
            detail = why or "발행 기록 없음"
        jobs.append({"id": f"movers:{market}:{hhmm}", "group": "content", "at": hhmm, "name": name, "status": status, "detail": detail,
                     "link": f"{movers.base_path(market)}/{slot:%Y-%m-%d/%H%M}" if stored else None})
    return jobs


def _brief_and_blog(day: dt.date, now: dt.datetime) -> list[dict]:
    jobs = []
    if not _trading(day, "KR"):
        return [{"id": "brief", "group": "content", "at": "16:10", "name": "장마감 브리핑", "status": "off", "detail": "휴장일"},
                {"id": "blog", "group": "blog", "at": "16:20", "name": "네이버 블로그 장마감 브리핑 7건", "status": "off", "detail": "휴장일"}]
    try:
        from app.services import market_brief_store
        markets = {d["market"].lower() for d in market_brief_store.dates(6) if d["date"] == day.isoformat()}
        status = _judge(now, _at(day, "16:10"), {"kospi", "kosdaq"} <= markets, grace=dt.timedelta(hours=2))
        jobs.append({"id": "brief", "group": "content", "at": "16:10", "name": "장마감 브리핑(코스피·코스닥)", "status": status,
                     "detail": f"저장됨: {', '.join(sorted(markets)) or '없음'}", "link": f"/market-brief/{day}/kospi" if markets else None})
    except Exception as exc:
        jobs.append({"id": "brief", "group": "content", "at": "16:10", "name": "장마감 브리핑", "status": "failed", "detail": type(exc).__name__})
    try:
        from app.services import naver_publish_store
        rows = [r for r in naver_publish_store.recent(8) if str(r.get("report_date")) in (day.isoformat(), day.strftime("%Y%m%d"))]
        published = [r for r in rows if r.get("status") == "published"]
        failed = [r for r in rows if r.get("status") == "failed"]
        status = _judge(now, _at(day, "16:20"), len(published) >= 7, bool(failed) and not published, grace=dt.timedelta(hours=6))
        detail = (f"{len(published)}건 게시" + (f" · 실패 {len(failed)}" if failed else "")) if rows else "기록 없음"
        if failed:
            detail += f" — {str(failed[0].get('last_error') or '')[:120]}"
        jobs.append({"id": "blog", "group": "blog", "at": "16:20", "name": "블로그 · 장마감 브리핑 7건(오늘의 브리핑)", "status": status, "detail": detail,
                     "link": (published[0].get("post_url") if published else None)})
    except Exception as exc:
        jobs.append({"id": "blog", "group": "blog", "at": "16:20", "name": "네이버 블로그 장마감 글", "status": "failed", "detail": type(exc).__name__})
    return jobs


def _naver_social(day: dt.date, now: dt.datetime) -> list[dict]:
    """Scheduled Naver editions, delivery state and the worker heartbeat."""
    jobs = []
    try:
        from app.services import naver_social_content as content, naver_social_publisher as pub, naver_social_store as store
        rows = {r["post_key"]: r for r in store.for_days([day.isoformat()])}
        worker = store.worker_status()
    except Exception as exc:
        return [{"id": "nb:store", "group": "blog", "at": "00:00", "name": "네이버 블로그 발행 원장", "status": "failed",
                 "detail": f"저장소 오류 {type(exc).__name__}"}]
    for edition, (hhmm, hours, category, _rule, _kind, label) in content.EDITIONS.items():
        name = f"블로그 · {label}"
        jid = f"nb:{edition}"
        if not pub.applies(day, edition):
            if edition == "weekly_market":
                continue
            jobs.append({"id": jid, "group": "blog", "at": hhmm, "name": name, "status": "off", "detail": "휴장일이라 쉽니다"})
            continue
        start, end = pub.window(day, edition)
        deadline = pub.delivery_deadline(day, edition)
        if start < pub.START:
            jobs.append({"id": jid, "group": "blog", "at": hhmm, "name": name, "status": "off", "detail": "도입 전"})
            continue
        row = rows.get(f"{day}:{edition}") or {}
        st = row.get("status")
        cat = content.CATEGORY_NAMES.get(category, "")
        if edition == "weekly_market" and st != "published":
            public_post = pub.public_weekly_post(day)
            if public_post:
                jobs.append({"id": jid, "group": "blog", "at": hhmm, "name": name, "status": "ok",
                             "detail": f"공개 RSS에서 게시 확인 · {cat}", "link": public_post["url"]})
                continue
        if st == "published":
            seen = row.get("category_seen")
            status = "ok"
            detail = f"게시됨 · {cat}" + ("" if seen in (None, category) else f" (실제 카테고리 {seen} — 확인 필요)")
            detail += f" · {row.get('chars') or 0:,}자 · 변형 {row.get('variant') or '-'}"
        elif st == "skipped":
            status, detail = "missed", f"시간 초과로 건너뜀 — {str(row.get('last_error') or '')[:100]}"
        elif st == "failed" and (row.get("attempts") or 0) >= store.MAX_ATTEMPTS:
            status, detail = "failed", str(row.get("last_error") or "")[:140]
        elif now < start:
            status, detail = "pending", f"예정 · {cat}"
        elif now < deadline:
            status = "running"
            waiting = "지연 발행 대기" if now >= end else "게시 대기"
            detail = f"{waiting} · " + str(row.get("last_error") or "데이터 준비 또는 발행기 응답 대기")[:120]
        else:
            status, detail = "missed", "기한 내 확인된 게시 기록 없음"
        jobs.append({"id": jid, "group": "blog", "at": hhmm, "name": name, "status": status, "detail": detail,
                     "link": row.get("post_url")})
    seen_at = None
    try:
        seen_at = dt.datetime.fromisoformat(str((worker or {}).get("seen_at"))).astimezone(KST) if worker else None
    except Exception:
        seen_at = None
    if day == now.date():
        srv = pub.server_status()
        checked = srv["queue_checked_at"]
        queue_fresh = checked and now - dt.datetime.fromisoformat(checked) < dt.timedelta(minutes=6)
        jobs.append({"id": "nb:queue", "group": "blog", "at": f"{now:%H:%M}", "name": "서버 블로그 예약 원장",
                     "status": "ok" if queue_fresh else "unknown",
                     "detail": f"최근 갱신 {checked[11:16]}" if checked else "갱신 기록 없음"})
        mode = srv["delivery_mode"]
        last = srv["last"] or {}
        if mode != "enabled":
            status, detail = "off", {"disabled": "운영 설정에서 웹서버 발행 중지",
                                     "browser_blocked": "웹서버 브라우저 실행 차단",
                                     "unconfigured": "네이버 세션 설정 없음"}[mode]
        elif srv["paused_until"] > now.timestamp():
            status = "failed"
            detail = "네이버 쓰기 권한 거부" if last.get("status") == "session_refused" else "발행 일시 보류"
        elif last.get("status") == "no_session":
            status, detail = "failed", "저장된 네이버 로그인 세션 없음"
        elif last.get("published"):
            status, detail = "ok", "네이버 공개 게시 확인"
        else:
            status, detail = "unknown", "최근 실행에서 확인된 게시 없음"
        jobs.append({"id": "nb:server", "group": "blog", "at": f"{now:%H:%M}", "name": "웹서버 블로그 발행",
                     "status": status, "detail": detail})
        fresh = seen_at is not None and now - seen_at < dt.timedelta(minutes=25)
        jobs.append({"id": "nb:worker", "group": "blog", "at": f"{now:%H:%M}", "name": "블로그 발행기 응답",
                     "status": "ok" if fresh else "unknown",
                     "detail": (f"마지막 응답 {seen_at:%H:%M} · 버전 {(worker or {}).get('version')}" if seen_at
                                else "응답 기록 없음") + ("" if fresh else " · 발행기 미응답")})
    return jobs


def _tistory(day: dt.date, now: dt.datetime) -> list[dict]:
    from app.services import tistory_editorial

    jobs = []
    try:
        result = tistory_editorial.status(day, now=now)
        states = [item["state"] for item in result["jobs"]]
        ready = states.count("ready")
        published = states.count("published")
        waiting = states.count("waiting")
        errors = states.count("error")
        status = "off" if not states else "failed" if errors else "running" if waiting else "ok" if ready or published else "pending"
        detail = f"원고 준비 {ready}건 · 공개 확인 {published}건 · 원본 대기 {waiting}건"
        if errors:
            detail += f" · 준비 오류 {errors}건"
    except Exception:
        status, detail = "unknown", "원고 상태 조회 실패"
    jobs.append({"id": "tistory:drafts", "group": "tistory", "at": "00:00", "name": "티스토리 원고 생성",
                 "status": status, "detail": detail})
    if day >= tistory_editorial.START_DAY:
        jobs.append({"id": "tistory:api", "group": "tistory", "at": "00:01", "name": "티스토리 서버 자동 발행",
                     "status": "off", "detail": "공식 글쓰기 API 종료", "link": tistory_editorial.API_NOTICE})
    return jobs


def _data(day: dt.date, now: dt.datetime) -> list[dict]:
    jobs = []
    try:
        from app.services import prediction_store
        latest = prediction_store.latest_run_by_market() or {}
        kr_day = day - dt.timedelta(days=1)  # the 23:00 run of the previous session day is what today shows
        for market, region, label in (("KOSPI", "KR", "AI 예측 국내(코스피·코스닥)"), ("NASDAQ", "US", "AI 예측 나스닥")):
            info = latest.get(market) or {}
            collect = str(info.get("collect_date") or "").replace("-", "")
            hhmm = "23:00" if region == "KR" else "13:00"
            due = _at(day, hhmm)
            session = day if region == "KR" else day - dt.timedelta(days=1)
            if not _trading(session, region):
                jobs.append({"id": f"pred:{region}", "group": "data", "at": hhmm, "name": label, "status": "off", "detail": "휴장일"})
                continue
            done = collect >= session.strftime("%Y%m%d")
            status = _judge(now, due, done, grace=dt.timedelta(hours=2))
            jobs.append({"id": f"pred:{region}", "group": "data", "at": hhmm, "name": label, "status": status,
                         "detail": f"최근 수집 {collect or '없음'} · {info.get('row_count', 0)}건", "action": f"prediction:{region}"})
        del kr_day
    except Exception as exc:
        jobs.append({"id": "pred", "group": "data", "at": "23:00", "name": "AI 예측", "status": "failed", "detail": type(exc).__name__})
    try:
        from app.services import dram_price
        st = dram_price.get_status()
        last = st.get("last_run") or {}
        done = str(st.get("latest_price_date") or "")[:10] >= day.isoformat()
        failed = last.get("status") == "error" and str(last.get("finished_at") or "")[:10] == day.isoformat()
        status = "running" if st.get("running") else _judge(now, _at(day, "20:00"), done, failed, grace=dt.timedelta(hours=3))
        jobs.append({"id": "dram", "group": "data", "at": "20:00", "name": "D램 현물가격 수집", "status": status,
                     "detail": f"최신 가격일 {st.get('latest_price_date') or '없음'} · {st.get('item_count', 0)}개", "action": "dram"})
    except Exception as exc:
        jobs.append({"id": "dram", "group": "data", "at": "20:00", "name": "D램 현물가격 수집", "status": "failed", "detail": type(exc).__name__})
    return jobs


def _notify(day: dt.date, now: dt.datetime) -> list[dict]:
    jobs = []
    try:
        from app.services import kakao_notify
        configured = kakao_notify.is_configured()
        last = kakao_notify.get_last_visitor_run() or {}
        last_at = str(last.get("at") or last.get("sent_at") or last.get("finished_at") or "")
        for hhmm in ("09:00", "12:00", "15:00", "18:00"):
            due = _at(day, hhmm)
            if not configured:
                jobs.append({"id": f"kakao:{hhmm}", "group": "notify", "at": hhmm, "name": "카카오 방문자 알림", "status": "off", "detail": "카카오 미설정"})
                continue
            done = last_at[:13] == due.strftime("%Y-%m-%dT%H") and last.get("status") in ("sent", "ok", "success")
            failed = last_at[:13] == due.strftime("%Y-%m-%dT%H") and last.get("status") in ("error", "failed")
            status = _judge(now, due, done, failed, grace=dt.timedelta(minutes=70))
            if status == "missed":
                status, detail = "unknown", "서버 재시작 이후 기록 없음"
            else:
                detail = str(last.get("message") or last.get("status") or "")[:120] if (done or failed) else "예정" if status == "pending" else "발송 대기"
            jobs.append({"id": f"kakao:{hhmm}", "group": "notify", "at": hhmm, "name": "카카오 방문자 알림", "status": status, "detail": detail,
                         "action": "kakao:visitors"})
    except Exception as exc:
        jobs.append({"id": "kakao", "group": "notify", "at": "09:00", "name": "카카오 알림", "status": "failed", "detail": type(exc).__name__})
    return jobs


def _github_runs() -> list[dict]:
    token = os.getenv("SOCIAL_PUBLISH_DISPATCH_TOKEN", "").strip()
    if not token:
        return []
    try:
        r = requests.get(RUNS_API, params={"per_page": 12}, timeout=8, headers={
            "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})
        r.raise_for_status()
        return [{"id": run["id"], "event": run["event"], "status": run["status"], "conclusion": run.get("conclusion"),
                 "at": dt.datetime.fromisoformat(run["created_at"].replace("Z", "+00:00")).astimezone(KST).isoformat(timespec="minutes"),
                 "url": run["html_url"]} for run in r.json().get("workflow_runs", [])]
    except Exception:
        return []


def build(day: dt.date | None = None) -> dict:
    now = dt.datetime.now(KST)
    day = day or now.date()
    cache_key = day.isoformat()
    with _lock:
        hit = _cache.get(cache_key)
        if hit and hit[0] > time.monotonic():
            return hit[1]
    with ThreadPoolExecutor(max_workers=9) as pool:
        parts = [pool.submit(fn, day, now) for fn in (_sns, _hot, _movers, _brief_and_blog, _naver_social, _tistory, _data, _notify)]
        runs = pool.submit(_github_runs)
        jobs = [job for part in parts for job in part.result()]
        github = runs.result()
    for job in jobs:
        if job["status"] in ("missed", "failed") and _before_launch(job, day):
            job["status"], job["detail"] = "off", "도입 전"
    jobs.sort(key=lambda j: (j["at"], j["group"]))
    counts = {s: sum(1 for j in jobs if j["status"] == s) for s in ("ok", "failed", "missed", "running", "pending", "off", "unknown")}
    value = {"day": day.isoformat(), "now": now.isoformat(timespec="minutes"), "groups": GROUPS, "jobs": jobs,
             "counts": counts, "github_runs": github}
    with _lock:
        _cache[cache_key] = (time.monotonic() + 60, value)
    return value
