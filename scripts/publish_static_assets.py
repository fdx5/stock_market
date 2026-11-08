"""Publish all public/build assets additively, then write the server's verified map.

Run npm ci && npm run build first, then:
    python scripts/publish_static_assets.py <asset repository checkout>
Publish/verify that repository BEFORE deploying this manifest. Never removes files.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "frontend/public"
DIST = ROOT / "frontend/dist"
MANIFEST = ROOT / "backend/app/data/asset_cdn.json"
BASE = "https://fdx5.github.io/kospimap-assets"
ORIGIN = "https://kospimap.com"


def digest(data: bytes, algorithm="sha1") -> str:
    return hashlib.new(algorithm, data).hexdigest()


def publish(out: Path, manifest: Path = MANIFEST, public: Path = PUBLIC, dist: Path = DIST):
    if not (dist / "worker-entries.json").is_file():
        raise RuntimeError("Build the frontend with worker-entries.json before publishing")
    files, routes, published_hashes = {}, {}, {}
    total = 0

    def put(rel, source, destination, payload=None):
        nonlocal total
        data = source if payload is None else payload
        target = out / destination
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if target.read_bytes() != data:
                raise RuntimeError(f"Refusing to overwrite existing asset: {destination}")
        else:
            target.write_bytes(data)
        files[rel] = digest(source)
        routes[rel] = destination
        published_hashes[rel] = digest(data, "sha256")
        total += len(data)

    public_paths = set()
    for path in sorted(public.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(public).as_posix()
        public_paths.add(rel)
        source = path.read_bytes()
        if path.suffix.lower() in {".json", ".html", ".htm", ".css", ".svg", ".txt", ".md", ".xml"}:
            source = source.replace(b"\r\n", b"\n")
        payload = source
        if path.suffix.lower() in {".html", ".htm"}:
            parent = rel.rsplit("/", 1)[0] + "/" if "/" in rel else ""
            base = f'<base href="{ORIGIN}/{parent}">'
            html = source.decode("utf-8")
            payload = (html.replace("<head>", "<head>" + base, 1) if "<head>" in html
                       else re.sub(r"(<!doctype[^>]*>)", lambda m: m[0] + base, html, count=1, flags=re.I)).encode()
        legacy = out / rel
        destination = rel if legacy.is_file() and legacy.read_bytes() == payload else "objects/" + digest(payload, "sha256") + path.suffix.lower()
        put(rel, source, destination, payload)
        if rel == "robots.txt":
            files.pop(rel); routes.pop(rel); published_hashes.pop(rel)

    built = {p.relative_to(dist).as_posix(): p.read_bytes() for p in sorted(dist.rglob("*"))
             if p.is_file() and p.relative_to(dist).as_posix() not in public_paths and p.name != "index.html"}
    identity = hashlib.sha256()
    for rel, data in built.items():
        identity.update(rel.encode() + b"\0" + data + b"\0")
    release = "builds/" + identity.hexdigest()[:24]
    for rel, data in built.items():
        put(rel, data, release + "/" + rel)
    (out / ".nojekyll").write_text("")
    workers = json.loads((dist / "worker-entries.json").read_text(encoding="utf-8"))
    if not set(workers) <= set(built):
        raise RuntimeError("Missing compiled Worker entries")
    result = {"base": BASE, "files": files, "routes": routes, "workers": workers,
              "published_sha256": published_hashes, "build": release}
    manifest.write_text(json.dumps(result, indent=0, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Published {len(files)} files, {total / 1048576:.2f} MiB, {len(workers)} worker payloads; {release}")
    return result


if __name__ == "__main__":
    publish(Path(sys.argv[1]).resolve())
