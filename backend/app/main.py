import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.data.universe import warm_english_names
from app.routers import activity, admin, battle, fight, geo, investor, market_map, search, stock, translate, visitors
from app.services import page_view_store
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
app.include_router(market_map.router, prefix="/api/market")
app.include_router(visitors.router, prefix="/api/visitors")
app.include_router(investor.router, prefix="/api/investor")
app.include_router(battle.router, prefix="/api/battle")
app.include_router(fight.router, prefix="/api/fight")
app.include_router(translate.router, prefix="/api")
app.include_router(geo.router, prefix="/api")
app.include_router(activity.router, prefix="/api/activity")
app.include_router(admin.router, prefix="/api/admin")


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


def _page_view_retention_loop() -> None:
    while True:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=page_view_store.RETENTION_DAYS)).isoformat()
        try:
            page_view_store.purge_older_than(cutoff)
        except Exception:
            # A failed purge just means one more day's worth of rows lingers —
            # not worth taking the process down over; the next run retries it.
            pass
        time.sleep(24 * 3600)


@app.on_event("startup")
def _start_page_view_retention() -> None:
    # Keeps the admin trend chart's backing table bounded to ~30 days of rows
    # regardless of traffic, instead of growing without limit — the chart never
    # queries further back than that anyway (see admin.py's pages_trend).
    threading.Thread(target=_page_view_retention_loop, daemon=True).start()


@app.get("/api/health")
def health():
    return {"status": "ok"}


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
