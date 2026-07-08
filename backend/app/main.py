import threading
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.routers import market_map, predictions, search, stock
from app.services.market_map import get_kospi_map
from app.services.market_predictions import get_today_top100_predictions

app = FastAPI(title="KOSPI 종목 예측")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(search.router, prefix="/api")
app.include_router(stock.router, prefix="/api/stock")
app.include_router(predictions.router, prefix="/api/predictions")
app.include_router(market_map.router, prefix="/api/market")


@app.on_event("startup")
def _warm_top100_predictions() -> None:
    # Pre-computes the top-100 direction calls in the background on boot so the first
    # visitor of the day isn't stuck waiting on ~100 sequential price-history fetches.
    threading.Thread(target=get_today_top100_predictions, daemon=True).start()


@app.on_event("startup")
def _warm_kospi_map() -> None:
    # Pre-fetches the map's Naver pages on boot so the first visitor after a deploy
    # doesn't pay the cold multi-page scrape (every page's cache starts empty then).
    threading.Thread(target=lambda: get_kospi_map(500), daemon=True).start()


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
