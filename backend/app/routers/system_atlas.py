from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.services import system_atlas
from app.services.admin_auth import require_admin

router = APIRouter(prefix="/atlas", dependencies=[Depends(require_admin)])


@router.get("/architecture")
def architecture(request: Request):
    return JSONResponse(system_atlas.architecture(request.app.routes), headers={"Cache-Control": "no-store"})


@router.get("/snapshot")
def snapshot(request: Request):
    return JSONResponse(system_atlas.live_snapshot(request.app.routes), headers={"Cache-Control": "no-store"})


@router.get("/health")
def health():
    from app.services import system_health
    return JSONResponse(system_health.snapshot(), headers={"Cache-Control": "no-store"})
