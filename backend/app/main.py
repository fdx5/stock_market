import threading
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.data.universe import warm_english_names
from app.routers import battle, geo, investor, market_map, search, stock, translate, visitors
from app.services.investor_summary import get_investor_summary, get_weekly_foreign_top
from app.services.market_map import get_kosdaq_map, get_kospi_map

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
app.include_router(translate.router, prefix="/api")
app.include_router(geo.router, prefix="/api")


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


@app.on_event("startup")
def _warm_investor_summary() -> None:
    threading.Thread(target=get_investor_summary, daemon=True).start()
    threading.Thread(target=get_weekly_foreign_top, daemon=True).start()


@app.on_event("startup")
def _warm_english_names() -> None:
    # English-name search matching needs ~2,700 names translated up front; kick that
    # off at boot so it's ready well before most real searches, instead of the first
    # search after a cold cache silently falling back to Korean-only matching.
    threading.Thread(target=warm_english_names, daemon=True).start()


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
        candidate = STATIC_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")
