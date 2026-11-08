"""The large static files served from GitHub Pages instead of this server (outbound bandwidth).

The manifest (app/data/asset_cdn.json, written by scripts/build_asset_cdn.py) lists each file
copied to the asset repository with its SHA-1. At startup a background thread hashes this
server's own copies; a request is redirected only for a file whose copy is byte-identical to the
one published — a file changed or added since (by any later deploy) is served here as before, and
until the check has run nothing is redirected. ASSET_CDN=off turns it off.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from pathlib import Path
from fastapi.responses import RedirectResponse, Response
from starlette.staticfiles import StaticFiles

log = logging.getLogger(__name__)

MANIFEST = Path(__file__).resolve().parents[1] / "data" / "asset_cdn.json"
REDIRECT_CACHE_CONTROL = "public, max-age=3600"

_base = ""
_allowed: frozenset[str] = frozenset()
_routes: dict[str,str] = {}
_workers: frozenset[str] = frozenset()
_lock = threading.Lock()


def _sha1(path: Path) -> str:
    # Git may check text out with CRLF on Windows and LF in the Linux image.
    # Canonicalize only text line endings; binary assets remain byte-exact.
    if path.suffix.lower() in {".json", ".html", ".htm", ".css", ".svg", ".txt", ".md", ".xml"}:
        return hashlib.sha1(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
    h = hashlib.sha1()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def verify(static_dir: Path, manifest: Path = MANIFEST) -> int:
    """Check the static files against the manifest; the identical ones become redirectable."""
    global _base, _allowed, _routes, _workers
    if os.environ.get("ASSET_CDN", "").lower() in {"0", "off", "false", "no"} or not manifest.exists():
        with _lock:_base='';_allowed=frozenset();_routes={};_workers=frozenset()
        return 0
    data = json.loads(manifest.read_text(encoding="utf-8"))
    ok = set()
    for rel, digest in data.get("files", {}).items():
        p = static_dir / rel
        try:
            if p.resolve().is_relative_to(static_dir.resolve()) and p.is_file() and _sha1(p) == digest:
                ok.add(rel)
        except OSError:
            continue
    with _lock:
        _base = str(data.get("base", "")).rstrip("/")
        _allowed = frozenset(ok) if _base.startswith("https://") else frozenset()
        routes=data.get('routes',{})
        _routes={rel:routes.get(rel,rel) for rel in _allowed if not routes.get(rel,rel).startswith(('/', 'http')) and '..' not in routes.get(rel,rel).split('/')}
        _workers = frozenset(data.get("workers", ())) & _allowed
    log.info("asset cdn: %d of %d files redirected", len(_allowed), len(data.get("files", {})))
    return len(_allowed)


def start(static_dir: Path) -> None:
    threading.Thread(target=lambda: _safe_verify(static_dir), name="asset-cdn-verify", daemon=True).start()


def _safe_verify(static_dir: Path) -> None:
    try:
        verify(static_dir)
    except Exception as exc:  # (never let a bad manifest take the site down: serve locally)
        log.warning("asset cdn verify failed (%s)", type(exc).__name__)


def redirect_for(rel_path: str) -> str | None:
    """The published URL of a static file (path relative to the static root), or None."""
    # ES modules must have one canonical URL. Redirecting module graph nodes
    # between origins can instantiate React twice and break hook dispatch.
    if rel_path.startswith("assets/"):
        return None
    with _lock:
        return f"{_base}/{_routes[rel_path]}" if rel_path in _routes else None


class CDNStaticFiles(StaticFiles):
    """The /assets mount must participate in CDN delivery too.

    Worker constructors require a same-origin entry point. A static module import
    loads the remote implementation before queued messages are dispatched, retaining
    the site's worker origin for API calls and nested Workers.
    """
    async def get_response(self, path, scope):
        if scope["method"] not in {"GET", "HEAD"}:
            return await super().get_response(path, scope)
        rel = "assets/" + path
        url = redirect_for(rel)
        if url:
            if rel in _workers:
                return Response("import " + json.dumps(url) + ";\n", media_type="application/javascript",
                                headers={"Cache-Control": REDIRECT_CACHE_CONTROL})
            return RedirectResponse(url, status_code=302, headers={"Cache-Control": REDIRECT_CACHE_CONTROL})
        return await super().get_response(path, scope)
