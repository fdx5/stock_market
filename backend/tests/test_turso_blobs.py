"""Hrana wire-format regression: fake HTTP transport, new temporary SQLite only."""
import base64
import sqlite3
from uuid import uuid4

import pytest

from app.services import turso


@pytest.mark.parametrize("value", [b"", b"\x00\xff\x80", bytearray(b"nonce"), memoryview(b"ciphertext")])
def test_binary_parameters_use_hrana_base64_field(value):
    # Official Hrana Value contract: blob has `base64`, other scalar types `value`.
    encoded = turso._encode(value)
    assert encoded == {"type": "blob", "base64": base64.b64encode(bytes(value)).decode("ascii")}


@pytest.mark.parametrize("encoded,expected", [("", b""), ("AP+A", b"\x00\xff\x80"), ("YQ", b"a"), ("YQ==", b"a")])
def test_binary_results_decode_padded_and_unpadded_hrana_base64(encoded, expected):
    assert turso._decode({"type": "blob", "base64": encoded}) == expected


def test_encrypted_map_roundtrip_through_real_http_codec(tmp_path, monkeypatch):
    from app.services import audience_analytics as audience, audience_live as live

    db = sqlite3.connect(tmp_path / "brand-new-hrana-test.sqlite")
    statements = []
    db.set_trace_callback(statements.append)
    remote = turso.Connection("libsql://fake-hrana.invalid", "test-only-token")
    monkeypatch.setenv("AUDIENCE_HMAC_KEY", "test-only-hmac-" * 4)
    monkeypatch.setenv("AUDIENCE_DATABASE_URL", "libsql://fake-hrana.invalid")
    monkeypatch.setenv("AUDIENCE_DATABASE_TOKEN", "test-only-token")
    monkeypatch.setenv("AUDIENCE_LOCATION_KEY", base64.urlsafe_b64encode(bytes(range(32))).decode())
    monkeypatch.setattr(audience, "_conn", remote)
    monkeypatch.setattr(audience, "_schema_ready", False)
    monkeypatch.setattr(live, "_ready", False)
    monkeypatch.setattr(live, "_recent", {})
    monkeypatch.setattr(live, "_counts", {"received": 0, "stored": 0, "failed": 0})
    monkeypatch.setattr(live, "_last_write", {"received_at": None, "stored_at": None, "failed_at": None, "failure": None})

    # Deliberately independent of turso._encode/_decode: a mock that reused them
    # would accept the same invalid field on both sides and miss this incident.
    def server_decode(value):
        if value["type"] == "blob":
            assert "base64" in value and "value" not in value
            return base64.b64decode(value["base64"])
        if value["type"] == "null":
            return None
        if value["type"] == "integer":
            return int(value["value"])
        return value["value"]

    def server_encode(value):
        if value is None:
            return {"type": "null"}
        if isinstance(value, bytes):
            return {"type": "blob", "base64": base64.b64encode(value).decode().rstrip("=")}
        if isinstance(value, int):
            return {"type": "integer", "value": str(value)}
        return {"type": "float" if isinstance(value, float) else "text", "value": value}

    def post(endpoint, *, json, timeout):
        assert endpoint == "https://fake-hrana.invalid/v2/pipeline"
        results = []
        for request in json["requests"]:
            if request["type"] == "close":
                results.append({"type": "ok", "response": {"type": "close"}})
                continue
            stmt = request["stmt"]
            assert stmt["sql"].lstrip().split()[0].upper() in {"CREATE", "INSERT", "SELECT", "WITH"}
            cursor = db.execute(stmt["sql"], [server_decode(value) for value in stmt["args"]])
            cols = [{"name": col[0]} for col in cursor.description or ()]
            rows = [[server_encode(value) for value in row] for row in cursor.fetchall()]
            results.append({"type": "ok", "response": {"type": "execute", "result": {
                "cols": cols, "rows": rows, "affected_row_count": max(0, cursor.rowcount)}}})
            db.commit()

        class Response:
            status_code = 200
            def json(self):
                return {"results": results}
        return Response()

    monkeypatch.setattr(remote._session, "post", post)
    try:
        assert audience.initialize()
        assert live.initialize()
        obs = {"session": audience._digest("session", str(uuid4())), "country": "KR", "region": "Seoul", "city": "Seoul",
               "_map_location": {"latitude": 37.5, "longitude": 127.0, "accuracy_m": 50000}}
        assert live.record(obs, now=1000)
        result = live.overview(now=1010)
        assert result["total"] == result["located"] == 1
        assert result["diagnostics"]["failed"] == 0
        assert result["sessions"][0]["latitude"] == 37.5
        nonce, ciphertext = db.execute("SELECT nonce,ciphertext FROM audience_location_observations").fetchone()
        assert isinstance(nonce, bytes) and len(nonce) == 12
        assert isinstance(ciphertext, bytes) and b"Seoul" not in ciphertext
        assert not any(sql.lstrip().upper().startswith(("DELETE", "UPDATE", "REPLACE", "DROP", "TRUNCATE")) for sql in statements)
    finally:
        remote.close()
        db.close()
