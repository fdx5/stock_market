"""Additively publish v6 exchange floor assets into kospimap-assets/objects/<sha256>.<ext>
and register them in backend/app/data/asset_cdn.json (never overwrites or deletes existing files).
"""
from hashlib import sha1, sha256
import json
from pathlib import Path
import sys

V6_FILES = [
    "3d/exchange-floor/floor-preview-v6.webp",
    "3d/exchange-floor/hall-env-v6.hdr",
    "3d/exchange-floor/lightmap-shell-v6.webp",
    "3d/exchange-floor/lightmap-shell-v6.ktx2",
    "3d/exchange-floor/lightmap-fixtures-v6.webp",
    "3d/exchange-floor/lightmap-fixtures-v6.ktx2",
    "3d/exchange-floor/trading-hall-v6.glb",
    "3d/exchange-floor/trading-hall-v6-ktx2.glb",
    "3d/exchange-floor/skyline-day-v6.webp",
    "3d/exchange-floor/skyline-golden-v6.webp",
    "3d/exchange-floor/skyline-night-v6.webp",
]


def main():
    repo = Path(sys.argv[1]).resolve()
    assets_repo = Path(sys.argv[2]).resolve()
    public = repo / "frontend/public"
    manifest_path = repo / "backend/app/data/asset_cdn.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    published = 0
    for rel in V6_FILES:
        src = public / rel
        if not src.is_file():
            raise FileNotFoundError(f"Missing v6 asset: {src}")
        data = src.read_bytes()
        h1 = sha1(data).hexdigest()
        h256 = sha256(data).hexdigest()
        dest_rel = f"objects/{h256}{src.suffix.lower()}"
        dest = assets_repo / dest_rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.exists():
            dest.write_bytes(data)
            published += 1
        elif dest.read_bytes() != data:
            raise RuntimeError(f"Hash collision at {dest_rel}")
        manifest["files"][rel] = h1
        manifest["routes"][rel] = dest_rel
        manifest["published_sha256"][rel] = h256
        print(f"registered {rel} -> {dest_rel} ({len(data) / 1e6:.2f} MB)", flush=True)

    manifest_path.write_text(json.dumps(manifest, indent=0, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Done: {published} new files written to {assets_repo}, manifest updated.", flush=True)


if __name__ == "__main__":
    main()
