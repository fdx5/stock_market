"""Local real-estate review API without the site's publishers or schedulers.

Run from backend/: python -m scripts.serve_realestate_review
Only reads existing trade data; collection keys are deliberately disabled here.
"""
import os

os.environ["MOLIT_API_KEY"] = ""
os.environ["DATA_GO_KR_API_KEY"] = ""

from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from app.routers.realestate import router

app = FastAPI(title="Local real estate review", docs_url=None, redoc_url=None)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.include_router(router, prefix="/api/realestate")


@app.get("/health")
def health():
    return {"status": "ok", "mode": "local-review", "collectors": False}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("REALESTATE_REVIEW_PORT", "8002")))
