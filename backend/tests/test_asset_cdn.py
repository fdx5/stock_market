import hashlib
import json

from app.services import asset_cdn
from fastapi import FastAPI
from fastapi.testclient import TestClient


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



def test_content_objects_keep_the_original_source_path_and_reset_when_disabled(tmp_path,monkeypatch):
    static=tmp_path/'static';(static/'3d').mkdir(parents=True);(static/'3d'/'a.bin').write_bytes(b'original pixels')
    manifest=tmp_path/'m.json';manifest.write_text(json.dumps({'base':'https://example.github.io/assets','files':{'3d/a.bin':hashlib.sha1(b'original pixels').hexdigest()},'routes':{'3d/a.bin':'objects/content-hash.bin'}}))
    assert asset_cdn.verify(static,manifest)==1
    assert asset_cdn.redirect_for('3d/a.bin')=='https://example.github.io/assets/objects/content-hash.bin'
    monkeypatch.setenv('ASSET_CDN','off');assert asset_cdn.verify(static,manifest)==0
    assert asset_cdn.redirect_for('3d/a.bin') is None


def test_compiled_assets_redirect_but_worker_entry_stays_same_origin(tmp_path):
    static = tmp_path / "static"
    assets = static / "assets"
    assets.mkdir(parents=True)
    for name in ("main.js", "geometryWorker.js", "unpublished.js"):
        (assets / name).write_bytes(b"payload")
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"base": "https://example.github.io/cdn", "files": {
        "assets/main.js": hashlib.sha1(b"payload").hexdigest(),
        "assets/geometryWorker.js": hashlib.sha1(b"payload").hexdigest()},
        "routes": {"assets/main.js": "builds/v1/assets/main.js", "assets/geometryWorker.js": "builds/v1/assets/geometryWorker.js"},
        "workers": ["assets/geometryWorker.js"]}))
    asset_cdn.verify(static, manifest)
    app = FastAPI()
    app.mount("/assets", asset_cdn.CDNStaticFiles(directory=assets))
    client = TestClient(app)
    response = client.get("/assets/main.js", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "https://example.github.io/cdn/builds/v1/assets/main.js"
    response = client.get("/assets/geometryWorker.js")
    assert response.status_code == 200
    assert response.text == 'import "https://example.github.io/cdn/builds/v1/assets/geometryWorker.js";\n'
    assert client.get("/assets/unpublished.js").content == b"payload"
    assert client.get("/assets/missing.js").status_code == 404


def test_manifest_cannot_redirect_file_outside_static_root(tmp_path):
    static = tmp_path / "static"
    static.mkdir()
    (tmp_path / "private.txt").write_bytes(b"secret")
    manifest = tmp_path / "m.json"
    manifest.write_text(json.dumps({"base": "https://example.github.io/cdn", "files": {
        "../private.txt": hashlib.sha1(b"secret").hexdigest()}}))
    assert asset_cdn.verify(static, manifest) == 0


def test_text_line_endings_are_portable_but_data_changes_are_not(tmp_path):
    (tmp_path / "settings.json").write_bytes(b'{"a":1}\r\n')
    manifest = tmp_path / "m.json"
    manifest.write_text(json.dumps({"base": "https://example.github.io/cdn", "files": {
        "settings.json": hashlib.sha1(b'{"a":1}\n').hexdigest()}}))
    assert asset_cdn.verify(tmp_path, manifest) == 1
    (tmp_path / "settings.json").write_bytes(b'{"a":2}\r\n')
    assert asset_cdn.verify(tmp_path, manifest) == 0
