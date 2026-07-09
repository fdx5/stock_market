import threading
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.routers import battle, investor, market_map, search, stock, translate, visitors
from app.services.investor_summary import get_investor_summary
from app.services.market_map import get_kospi_map

app = FastAPI(title="KOSPI 종목 예측")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(search.router, prefix="/api")
app.include_router(stock.router, prefix="/api/stock")
app.include_router(market_map.router, prefix="/api/market")
app.include_router(visitors.router, prefix="/api/visitors")
app.include_router(investor.router, prefix="/api/investor")
app.include_router(battle.router, prefix="/api/battle")
app.include_router(translate.router, prefix="/api")


@app.on_event("startup")
def _warm_kospi_map() -> None:
    # Pre-fetches the map's Naver pages on boot so the first visitor after a deploy
    # doesn't pay the cold multi-page scrape (every page's cache starts empty then).
    threading.Thread(target=lambda: get_kospi_map(500), daemon=True).start()


@app.on_event("startup")
def _warm_investor_summary() -> None:
    threading.Thread(target=get_investor_summary, daemon=True).start()


@app.get("/api/health")
def health():
    return {"status": "ok"}


# Populated by the Docker build (frontend build output copied here). Absent during
# local backend-only dev, where the Vite dev server serves the frontend instead.
STATIC_DIR = Path(__file__).resolve().parent / "static"

if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        candidate = STATIC_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")
