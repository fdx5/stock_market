import hashlib
import json

from app.services import asset_cdn


def test_only_identical_files_are_redirected(tmp_path):
    static = tmp_path / "static"
    (static / "3d").mkdir(parents=True)
    (static / "3d" / "a.bin").write_bytes(b"same")
    (static / "3d" / "b.bin").write_bytes(b"changed locally")
    manifest = tmp_path / "m.json"
    manifest.write_text(json.dumps({"base": "https://example.github.io/assets", "files": {
        "3d/a.bin": hashlib.sha1(b"same").hexdigest(),
        "3d/b.bin": hashlib.sha1(b"published").hexdigest(),
        "3d/gone.bin": hashlib.sha1(b"x").hexdigest(),
    }}))
    assert asset_cdn.verify(static, manifest) == 1
    assert asset_cdn.redirect_for("3d/a.bin") == "https://example.github.io/assets/3d/a.bin"
    assert asset_cdn.redirect_for("3d/b.bin") is None
    assert asset_cdn.redirect_for("3d/gone.bin") is None
    assert asset_cdn.redirect_for("index.html") is None


def test_switched_off(tmp_path, monkeypatch):
    monkeypatch.setenv("ASSET_CDN", "off")
    manifest = tmp_path / "m.json"
    manifest.write_text(json.dumps({"base": "https://example.github.io/a", "files": {}}))
    assert asset_cdn.verify(tmp_path, manifest) == 0
