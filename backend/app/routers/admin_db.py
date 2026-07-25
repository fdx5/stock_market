"""The admin DB 조회 console's API.

Every route here is admin-only and read-only. The `dependencies=[Depends(require_admin)]`
on each one is the whole access control story — there is no unauthenticated variant of any
of these, so a request without a valid admin session gets 401 before it reaches a database.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.services import db_browser
from app.services.admin_auth import require_admin

router = APIRouter(prefix="/db", dependencies=[Depends(require_admin)])


class QueryPayload(BaseModel):
    sql: str
    source: str | None = None
    limit: int = Field(default=db_browser.DEFAULT_ROW_LIMIT, ge=1, le=db_browser.MAX_ROW_LIMIT)


@router.get("/sources")
def sources():
    """The databases this deployment can browse — one on Turso, one per local store file
    in dev (see db_browser's module docstring)."""
    return {"sources": db_browser.list_sources()}


@router.get("/tables")
def tables(source: str | None = Query(default=None)):
    try:
        return {"source": source, "tables": db_browser.list_tables(source)}
    except db_browser.QueryError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/tables/{table}/columns")
def table_columns(table: str, source: str | None = Query(default=None)):
    try:
        return {"table": table, "columns": db_browser.table_columns(table, source)}
    except db_browser.QueryError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/tables/{table}/preview")
def table_preview(
    table: str,
    source: str | None = Query(default=None),
    limit: int = Query(default=db_browser.DEFAULT_ROW_LIMIT, ge=1, le=db_browser.MAX_ROW_LIMIT),
):
    """What a double-click on a table in the sidebar runs: the newest-first default query,
    executed and returned together with its SQL so the editor can show what ran."""
    try:
        sql = db_browser.default_query(table, source, limit)
        return db_browser.run_query(sql, source, limit)
    except db_browser.QueryError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/query")
def run_query(payload: QueryPayload):
    try:
        return db_browser.run_query(payload.sql, payload.source, payload.limit)
    except db_browser.QueryError as exc:
        # 400, not 500: a rejected or malformed query is the admin's input being wrong,
        # and the message is written to be shown to them verbatim.
        raise HTTPException(status_code=400, detail=str(exc))
