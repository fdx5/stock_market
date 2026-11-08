import hashlib
import importlib.util
import json
from pathlib import Path


def test_full_public_tree_and_build_are_published_without_overwriting(tmp_path):
    source = Path(__file__).resolve().parents[2] / "scripts/publish_static_assets.py"
    spec = importlib.util.spec_from_file_location("publisher", source)
    publisher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(publisher)
    public, dist, out = [tmp_path / name for name in ("public", "dist", "out")]
    for path in (public / "img/ticker", public / "bgm", dist / "assets", out / "img"):
        path.mkdir(parents=True)
    (out / "img/old.webp").write_bytes(b"preserve old version")
    (public / "img/old.webp").write_bytes(b"new version")
    (public / "img/ticker/note.webp").write_bytes(b"small image")
    (public / "bgm/credits.html").write_text('<!doctype html><head></head><a href="/">Home</a>')
    (dist / "assets/main.js").write_bytes(b'import "./dep.js"')
    (dist / "assets/dep.js").write_bytes(b"export const a=1")
    (dist / "assets/worker.js").write_bytes(b"self.onmessage=()=>{}")
    (dist / "worker-entries.json").write_text(json.dumps(["assets/worker.js"]))
    (dist / "index.html").write_bytes(b"origin HTML")
    manifest = tmp_path / "manifest.json"
    result = publisher.publish(out, manifest, public, dist)
    assert "img/ticker/note.webp" in result["files"]
    assert "index.html" not in result["files"]
    assert (out / "img/old.webp").read_bytes() == b"preserve old version"
    assert result["routes"]["img/old.webp"].startswith("objects/")
    html = (out / result["routes"]["bgm/credits.html"]).read_text()
    assert '<base href="https://kospimap.com/bgm/">' in html
    for rel, destination in result["routes"].items():
        assert hashlib.sha256((out / destination).read_bytes()).hexdigest() == result["published_sha256"][rel]
    assert publisher.publish(out, manifest, public, dist) == result
