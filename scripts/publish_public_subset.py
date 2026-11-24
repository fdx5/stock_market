"""Publish part of frontend/public to the asset repository additively and record it in the manifest.

    python scripts/publish_public_subset.py <asset repository checkout> 3d/exchange-floor

Same layout and rules as publish_static_assets.py (content-addressed objects/<sha256>.<ext>,
never overwriting a different file, never removing anything), for when only static 3D files
changed and the JS build is served from the site origin. Push the asset repository and confirm
the files are live on GitHub Pages before deploying the updated manifest.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from publish_static_assets import MANIFEST, PUBLIC, digest  # noqa: E402


def publish(out: Path, prefix: str):
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    added = 0
    for path in sorted((PUBLIC / prefix).rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(PUBLIC).as_posix()
        source = path.read_bytes()
        if path.suffix.lower() in {".json", ".css", ".svg", ".txt", ".md", ".xml"}:
            source = source.replace(b"\r\n", b"\n")
        destination = "objects/" + digest(source, "sha256") + path.suffix.lower()
        target = out / destination
        if target.exists():
            existing = target.read_bytes()
            if path.suffix.lower() in {".json", ".css", ".svg", ".txt", ".md", ".xml"}:
                existing = existing.replace(b"\r\n", b"\n")   # Windows checkouts add CRLF to text objects
            if existing != source:
                raise RuntimeError(f"Refusing to overwrite existing asset: {destination}")
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source)
        if manifest["files"].get(rel) != digest(source):
            added += 1
        manifest["files"][rel] = digest(source)
        manifest["routes"][rel] = destination
        manifest["published_sha256"][rel] = digest(source, "sha256")
    MANIFEST.write_text(json.dumps(manifest, indent=0, sort_keys=True) + "\n", encoding="utf-8")
    print(f"{added} new or changed files under {prefix}")


if __name__ == "__main__":
    publish(Path(sys.argv[1]).resolve(), sys.argv[2].strip("/"))
