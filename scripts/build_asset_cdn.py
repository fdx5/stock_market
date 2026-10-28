"""Copy the site's large static files (frontend/public) into the public asset repository served by
GitHub Pages, and write the manifest the backend redirects by (backend/app/data/asset_cdn.json).

Only files of 32 KB and up in the listed folders, never HTML; the backend redirects a file only
while its own copy's SHA-1 equals the manifest's, so a file changed or added later without running
this is simply served by the site as before.

    python scripts/build_asset_cdn.py <asset repo working copy>
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "frontend" / "public"
MANIFEST = ROOT / "backend" / "app" / "data" / "asset_cdn.json"
BASE = "https://fdx5.github.io/kospimap-assets"
FOLDERS = ["3d", "making/video", "video", "img", "bgm", "geo", "rail", "live"]
# (drawn into canvases without crossOrigin: kept same-origin)
EXCLUDE = ["img/ticker/"]
MIN_BYTES = 32 * 1024


def sha1(path: Path) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    out = Path(sys.argv[1]).resolve()
    files: dict[str, str] = {}
    total = 0
    for folder in FOLDERS:
        for p in sorted((PUBLIC / folder).rglob("*")):
            if not p.is_file() or p.suffix.lower() in {".html", ".htm"} or p.stat().st_size < MIN_BYTES:
                continue
            rel = p.relative_to(PUBLIC).as_posix()
            if any(rel.startswith(x) for x in EXCLUDE):
                continue
            files[rel] = sha1(p)
            total += p.stat().st_size
            dest = out / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            if not dest.exists() or dest.stat().st_size != p.stat().st_size or sha1(dest) != files[rel]:
                shutil.copy2(p, dest)
    (out / ".nojekyll").write_text("")
    MANIFEST.write_text(json.dumps({"base": BASE, "files": files}, indent=0, sort_keys=True) + "\n", encoding="utf-8")
    print(f"{len(files)} files, {total / 1048576:.1f} MB -> {out}; manifest {MANIFEST}")


if __name__ == "__main__":
    main()
