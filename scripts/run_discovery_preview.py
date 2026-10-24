"""Local review server: new adapters + allowlisted production GETs, no DB startup.

Does not import app.main, load dotenv, run background jobs, or use DB credentials.
Public snapshots made by the explicit UI action use a separate append-only archive.
Run: python scripts/run_discovery_preview.py
"""
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.environ["DISCOVERY_PREVIEW_MODE"] = "1"
os.environ["DISCOVERY_SNAPSHOT_PATH"] = str(ROOT / "tmp" / "local-discovery-preview" / "public-snapshots.jsonl")

import requests
import uvicorn
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, Response
from app.routers import discovery

app = FastAPI(title="K-Stock Hub Local Review")
app.include_router(discovery.router, prefix="/api/discovery")

ALLOW = re.compile(r"^(market/(board|map|kosdaq-map|sp500-map|nasdaq100-map|stock-list|returns|ticker|futures|sector|sector-map|us-sector|us-sector-map|weather|dram-price)(/history)?|market/index/(KOSPI|KOSDAQ)/history|stock/[A-Za-z0-9.-]+/(summary|quote|history|indicators|news|overview|orderbook|balance|daily|company|board|discussions)|us-stock/[A-Za-z0-9.-]+/(quote|history|indicators|news|overview|daily|enrichment|board)|etfs(/[A-Za-z0-9.-]+/quote)?|global/(indices|sentiment|news|enrichment|top20|commodities)|global-top100|search|search/popular|investor/[^/]+|market-brief(/[^/]+){0,3}|prediction/(dates|results|accuracy|history|grading))$")


@app.get("/api/{path:path}")
def public_proxy(path: str, request: Request):
    if path in {"activity/audience-config", "geo/country"}:
        return {"enabled": False, "country": "KR"}
    if path in {"visitors/count", "popular"}:
        return {"items": [], "count": None, "total": None, "enabled": False}
    additional_read = path in {"battle/global-top20", "etfs/discussions", "market/sparklines", "fight/news"} or bool(re.fullmatch(r"prediction/stock/[A-Za-z0-9.-]{1,16}", path))
    if not ALLOW.fullmatch(path) and not additional_read:
        raise HTTPException(404, "이 로컬 검토 서버에서 제공하지 않는 경로입니다.")
    params = dict(request.query_params)
    params.pop("fresh", None)
    try:
        response = requests.get(f"https://kospimap.com/api/{path}", params=params, timeout=(5, 22), headers={"User-Agent": "KStockHub-LocalReview/1.0"})
        if not response.ok:
            return JSONResponse({"detail": "운영의 공개 읽기 API가 잠시 응답하지 않습니다."}, status_code=502)
        return Response(response.content, media_type="application/json")
    except requests.RequestException:
        raise HTTPException(502, "공개 자료를 불러오지 못했습니다.") from None


@app.post("/api/activity/event")
def discard_preview_telemetry():
    return {"recorded": False, "preview": True}


@app.post("/api/visitors/count")
def no_visitor_registration():
    return {"recorded": False, "preview": True}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")
