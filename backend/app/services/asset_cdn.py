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

log = logging.getLogger(__name__)

MANIFEST = Path(__file__).resolve().parents[1] / "data" / "asset_cdn.json"
REDIRECT_CACHE_CONTROL = "public, max-age=3600"

_base = ""
_allowed: frozenset[str] = frozenset()
_lock = threading.Lock()


def _sha1(path: Path) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def verify(static_dir: Path, manifest: Path = MANIFEST) -> int:
    """Check the static files against the manifest; the identical ones become redirectable."""
    global _base, _allowed
    if os.environ.get("ASSET_CDN", "").lower() in {"0", "off", "false", "no"} or not manifest.exists():
        return 0
    data = json.loads(manifest.read_text(encoding="utf-8"))
    ok = set()
    for rel, digest in data.get("files", {}).items():
        p = static_dir / rel
        try:
            if p.is_file() and _sha1(p) == digest:
                ok.add(rel)
        except OSError:
            continue
    with _lock:
        _base = str(data.get("base", "")).rstrip("/")
        _allowed = frozenset(ok) if _base.startswith("https://") else frozenset()
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
    with _lock:
        return f"{_base}/{rel_path}" if rel_path in _allowed else None
