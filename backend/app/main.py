import os
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.data.global_discussion_fetcher import warm_nasdaq_symbols
from app.data.universe import warm_english_names
from app.data.us_universe import warm_us_korean_names
from app.routers import (
    activity,
    admin,
    admin_comments,
    admin_db,
    battle,
    fight,
    geo,
    global_dashboard,
    investor,
    market_map,
    notify,
    prediction,
    search,
    stock,
    translate,
    us_stock,
    visitors,
)
from app.services import kakao_notify, notify_stats_store, page_view_store, prediction_batch, stock_search_store
from app.services.investor_summary import get_investor_summary, get_weekly_foreign_top
from app.services.market_map import get_kosdaq_map, get_kospi_map
from app.services.us_market_map import get_nasdaq100_map, get_sp500_map

app = FastAPI(title="KOSPI 종목 예측")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)
# Compresses JS/CSS bundles and JSON API responses on the wire — same bytes served,
# fewer bytes billed against Render's free-tier bandwidth cap.
app.add_middleware(GZipMiddleware, minimum_size=500)

app.include_router(search.router, prefix="/api")
app.include_router(stock.router, prefix="/api/stock")
app.include_router(us_stock.router, prefix="/api/us-stock")
app.include_router(market_map.router, prefix="/api/market")
app.include_router(visitors.router, prefix="/api/visitors")
app.include_router(investor.router, prefix="/api/investor")
app.include_router(battle.router, prefix="/api/battle")
app.include_router(fight.router, prefix="/api/fight")
app.include_router(global_dashboard.router, prefix="/api/global")
app.include_router(prediction.router, prefix="/api/prediction")
app.include_router(translate.router, prefix="/api")
app.include_router(geo.router, prefix="/api")
app.include_router(activity.router, prefix="/api/activity")
app.include_router(admin.router, prefix="/api/admin")
app.include_router(admin_comments.router, prefix="/api/admin")
app.include_router(admin_db.router, prefix="/api/admin")
app.include_router(notify.router, prefix="/api/notify")


@app.on_event("startup")
def _warm_market_maps() -> None:
    # Pre-fetches both maps' Naver pages on boot so the first visitor after a deploy
    # doesn't pay the cold multi-page scrape (every page's cache starts empty then).
    # The frontend polls each map at three separate `limit` tiers (20 / 50 / full - see
    # tier1Limit/tier2Limit/fullLimit in KospiMapPage.tsx and KosdaqMapPage.tsx), and
    # each tier is cached under its own key (`realtime_quotes:{market}:{limit}`), so all
    # three need warming with the exact same limits - not just the full one, and not an
    # approximation - or the first visitor still pays a cold synchronous fetch for
    # whichever tier they hit first.
    for limit in (20, 50, 500):
        threading.Thread(target=lambda limit=limit: get_kospi_map(limit), daemon=True).start()
    for limit in (20, 50, 200):
        threading.Thread(target=lambda limit=limit: get_kosdaq_map(limit), daemon=True).start()
    # The S&P500/Nasdaq100 maps cache one full-list scrape per market (not per-limit
    # like the KRX maps above), so warming the full limit alone is enough to make
    # every frontend tier (20/50/full) hit a warm cache.
    threading.Thread(target=lambda: get_sp500_map(503), daemon=True).start()
    threading.Thread(target=lambda: get_nasdaq100_map(103), daemon=True).start()


@app.on_event("startup")
def _warm_investor_summary() -> None:
    threading.Thread(target=get_investor_summary, daemon=True).start()
    threading.Thread(target=get_weekly_foreign_top, daemon=True).start()


@app.on_event("startup")
def _warm_dashboard_default_stock() -> None:
    # The dashboard defaults to Samsung Electronics (005930, see DEFAULT_STOCK_CODE
    # in Dashboard.tsx) whenever it's landed on with no `?code=` in the URL - by far
    # the most common first request. Unlike the map endpoints above, these per-stock
    # routes and /investor/indices aren't warmed anywhere else, so a cold cache after
    # a restart means the first such visitor pays for all these scrapes synchronously
    # (summary/indicators share one history fetch; quote/news/overview/indices are
    # each their own). Calling the router functions directly (rather than duplicating
    # their cache keys here) keeps this in sync with however they cache internally.
    code = "005930"
    for fn, args in (
        (stock.summary, (code,)),
        (stock.indicators, (code, 3)),
        (stock.quote, (code,)),
        (stock.news, (code,)),
        (stock.overview, (code,)),
        (investor.indices, (False,)),
    ):
        threading.Thread(target=lambda fn=fn, args=args: fn(*args), daemon=True).start()


@app.on_event("startup")
def _warm_english_names() -> None:
    # English-name search matching needs ~2,700 names translated up front; kick that
    # off at boot so it's ready well before most real searches, instead of the first
    # search after a cold cache silently falling back to Korean-only matching.
    threading.Thread(target=warm_english_names, daemon=True).start()


@app.on_event("startup")
def _warm_us_korean_names() -> None:
    # Mirrors _warm_english_names for the reverse direction: S&P500/Nasdaq100 names
    # translated to Korean up front so "애플"-style search works without the first
    # such search paying for the translate batch.
    threading.Thread(target=warm_us_korean_names, daemon=True).start()


@app.on_event("startup")
def _warm_nasdaq_symbols() -> None:
    # The /global page's discussion board resolves each ticker's Nasdaq (.O) vs
    # other (.K) Naver suffix against this ~4,000-row listing on every request — a
    # multi-second FinanceDataReader fetch cold, warmed here so the first visitor's
    # discussion-board load after a deploy isn't the one who pays for it.
    threading.Thread(target=warm_nasdaq_symbols, daemon=True).start()


def _admin_retention_loop() -> None:
    while True:
        try:
            page_cutoff = (datetime.now(timezone.utc) - timedelta(days=page_view_store.RETENTION_DAYS)).isoformat()
            page_view_store.purge_older_than(page_cutoff)
        except Exception:
            # A failed purge just means one more day's worth of rows lingers —
            # not worth taking the process down over; the next run retries it.
            pass
        try:
            search_cutoff = (
                datetime.now(timezone.utc) - timedelta(days=stock_search_store.RETENTION_DAYS)
            ).isoformat()
            stock_search_store.purge_older_than(search_cutoff)
        except Exception:
            pass
        try:
            notify_cutoff = (
                datetime.now(timezone.utc) - timedelta(days=notify_stats_store.RETENTION_DAYS)
            ).isoformat()
            notify_stats_store.purge_older_than(notify_cutoff)
        except Exception:
            pass
        time.sleep(24 * 3600)


@app.on_event("startup")
def _start_admin_retention() -> None:
    # Keeps the admin dashboard's backing tables (page views, stock searches)
    # bounded to ~30 days of rows regardless of traffic, instead of growing
    # without limit — neither ever gets queried further back than that anyway
    # (see admin.py's pages_trend / stocks_top).
    threading.Thread(target=_admin_retention_loop, daemon=True).start()


def _seconds_until_next_hour() -> float:
    now = datetime.now(timezone.utc)
    next_hour = (now + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
    return (next_hour - now).total_seconds()


def _kakao_notify_loop() -> None:
    # Waits for the next hour boundary before its first run, rather than firing the
    # instant the process comes up. Every deploy/restart empties visitor_tracker's
    # in-memory session set, so an immediate run here would read (and could actually
    # send) "현재 접속자: 0명" even while real visitors are online — it just takes a
    # restart landing right before this loop's tick for the notification to capture
    # that momentary empty state. Waiting for the aligned hour gives the tracker
    # comfortably long — usually most of an hour — to refill from real heartbeats
    # first, the same way the GitHub Actions cron (which runs on its own clock,
    # independent of this process's restarts) naturally does.
    time.sleep(_seconds_until_next_hour())
    while True:
        try:
            kakao_notify.run_visitor_stats(triggered_by="in_process")
        except Exception:
            # A missed hour just means the next tick (or the GitHub Actions cron
            # covering the same job) tries again — not worth taking the process down
            # over a single failed KakaoTalk send.
            pass
        time.sleep(3600)


@app.on_event("startup")
def _start_kakao_notify_scheduler() -> None:
    # Secondary trigger for the hourly KakaoTalk visitor-stats notification, same
    # dual-trigger shape as _start_prediction_scheduler: GitHub Actions cron (see
    # .github/workflows/kakao-notify.yml) is primary, this thread covers the window
    # where Render's free-tier instance is asleep when that cron fires. kakao_notify's
    # own _MIN_INTERVAL guard is what stops both triggers landing in the same hour
    # from sending the admin two messages back to back.
    threading.Thread(target=_kakao_notify_loop, daemon=True).start()


@app.on_event("startup")
def _start_prediction_scheduler() -> None:
    # Secondary trigger for the AI 종목예측 batch. GitHub Actions cron is the primary
    # one (it survives restarts and leaves a log), but GitHub disables scheduled
    # workflows after 60 days with no commits — the same caveat keep-alive.yml already
    # carries — so this thread covers the window where cron has gone quiet. Both paths
    # call the same run_batch, which is idempotent per (수집일자, market), so whichever
    # fires first does the work and the other one no-ops.
    threading.Thread(target=prediction_batch.start_scheduler, daemon=True).start()


@app.get("/api/health")
def health():
    # RENDER_GIT_COMMIT is set automatically by Render at runtime for a git-connected
    # service — surfacing it here is the one reliable way to answer "is my latest push
    # actually live yet" from outside the dashboard, instead of guessing from how many
    # minutes have passed since the push (a multi-stage Docker build here easily takes
    # longer than that).
    return {"status": "ok", "commit": os.environ.get("RENDER_GIT_COMMIT")}


@app.get("/api/health/price-debug")
def price_debug(code: str = "GOOGL"):
    """Temporary: exposes exactly what this running container computes and receives
    for one ticker's price fetch, bypassing every cache. A US ticker's fetch has
    repeatedly come back a session short specifically in production despite the
    identical code returning correctly everywhere else it's been run — this answers
    "what is different about *this* container's environment" directly instead of by
    further guessing. Remove once that's actually understood; it's not something a
    long-lived endpoint should be, even though it only ever reveals public stock
    prices.
    """
    from app.data import price_fetcher

    now_utc = datetime.now(timezone.utc)
    end = now_utc.date() + timedelta(days=1)
    start = end - timedelta(days=int(2 * 365.25) + 10)

    def _try(host: str) -> dict:
        import requests

        start_ts = int(datetime(start.year, start.month, start.day, tzinfo=timezone.utc).timestamp())
        end_ts = int(datetime(end.year, end.month, end.day, tzinfo=timezone.utc).timestamp()) + 86400
        url = (
            f"https://{host}/v8/finance/chart/{code}"
            f"?period1={start_ts}&period2={end_ts}&interval=1d&includeAdjustedClose=true"
        )
        try:
            resp = requests.get(url, headers={"user-agent": "Mozilla/5.0 AppleWebKit/537.36"}, timeout=20)
            resp.raise_for_status()
            result = resp.json()["chart"]["result"][0]
            timestamps = result["timestamp"]
            closes = result["indicators"]["quote"][0]["close"]
            sample = [
                {"date": datetime.fromtimestamp(t, tz=timezone.utc).date().isoformat(), "close": c}
                for t, c in zip(timestamps[-5:], closes[-5:])
            ]
            # meta carries Yahoo's own top-line "what is the current/previous price"
            # fields, computed on a different path than the per-day quote array — worth
            # seeing whether it agrees with the array when the array's tail is null.
            meta = {
                k: result.get("meta", {}).get(k)
                for k in (
                    "regularMarketPrice",
                    "regularMarketTime",
                    "chartPreviousClose",
                    "previousClose",
                    "regularMarketDayHigh",
                    "regularMarketDayLow",
                )
            }
            return {"sample_tail": sample, "meta": meta, "error": None}
        except Exception as exc:  # noqa: BLE001 - this is a diagnostic, report don't hide
            return {"sample_tail": [], "meta": None, "error": f"{type(exc).__name__}: {exc}"}

    # Both Yahoo chart hosts, side by side — checking whether one host's response
    # disagrees with the other's is exactly what tells us if this is a single
    # backend/cache node behind one host lagging, versus something true of Yahoo's
    # data for this ticker across the board.
    return {
        "now_utc": now_utc.isoformat(),
        "computed_start": start.isoformat(),
        "computed_end": end.isoformat(),
        "code": code,
        "query2": _try("query2.finance.yahoo.com"),
        "query1": _try("query1.finance.yahoo.com"),
    }


# Populated by the Docker build (frontend build output copied here). Absent during
# local backend-only dev, where the Vite dev server serves the frontend instead.
STATIC_DIR = Path(__file__).resolve().parent / "static"

if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    # Vite hashes /assets filenames per build, so those can be cached forever. Everything
    # else under static/ (video, img, favicons) keeps its filename across deploys, so it
    # only gets a week-long cache instead of "immutable" to avoid serving stale content.
    ASSETS_CACHE_CONTROL = "public, max-age=31536000, immutable"
    STATIC_CACHE_CONTROL = "public, max-age=604800"

    @app.middleware("http")
    async def add_static_cache_headers(request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path.startswith("/assets/"):
            response.headers["Cache-Control"] = ASSETS_CACHE_CONTROL
        elif path.startswith(("/video/", "/img/", "/favicon", "/apple-touch-icon")):
            response.headers["Cache-Control"] = STATIC_CACHE_CONTROL
        elif not path.startswith("/api/"):
            # The SPA shell (index.html, served for "/" and every client route) must be
            # revalidated on every load. Without this it has no Cache-Control at all, so
            # browsers heuristically cache it and — after a deploy replaces the hashed
            # /assets chunks — keep serving a stale index.html that points at now-deleted
            # chunk filenames, which 404 and leave a blank white screen until a hard
            # reload. "no-cache" means "always revalidate via ETag", so a plain refresh
            # picks up the new index.html (and thus the new chunk names) immediately.
            response.headers["Cache-Control"] = "no-cache"
        return response

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        # Resolved and containment-checked before serving — unlike the /assets mount
        # above (Starlette's own StaticFiles, which already guards against this), this
        # is a hand-rolled file lookup, and a full_path like "../requirements.txt"
        # would otherwise resolve outside STATIC_DIR and let a request read arbitrary
        # files from the container's filesystem (source code, dependency list, etc.).
        candidate = (STATIC_DIR / full_path).resolve()
        if full_path and candidate.is_relative_to(STATIC_DIR) and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")
