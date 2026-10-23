"""Append-only encrypted location observations; admin reads active sessions only.

Credentials and encryption keys never leave the server. No pruning, replacement,
or mutation of stored observations is performed here.
"""
import base64
import json
import math
import os
import secrets
import threading
import time
from uuid import uuid4

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.services import audience_analytics as audience, libsql_gate

_ready = False
_gate = libsql_gate.Gate("audience_live", lock_timeout=1.5)
_recent = {}
_recent_lock = threading.Lock()
_counts = {"received": 0, "stored": 0, "failed": 0}
ONLINE_SECONDS = 120
PRECISE_SECONDS = 900


def _cipher():
    raw = os.environ.get("AUDIENCE_LOCATION_KEY", "")
    key = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
    if len(key) != 32:
        raise ValueError("Location key must contain 256 random bits")
    return AESGCM(key)


def configured():
    try:
        _cipher()
        return audience.ready()
    except (ValueError, TypeError):
        return False


def initialize():
    global _ready
    if not configured():
        return False
    try:
        with _gate.hold():
            conn = audience._connection()
            conn.execute("""CREATE TABLE IF NOT EXISTS audience_location_observations (
                id TEXT PRIMARY KEY, session TEXT NOT NULL, seen_at REAL NOT NULL,
                source TEXT NOT NULL, nonce BLOB NOT NULL, ciphertext BLOB NOT NULL)""")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_audience_live_time ON audience_location_observations(seen_at,session)")
            conn.commit()
        _ready = True
        return True
    except Exception:
        return False


def ready():
    return _ready and configured()


def record(observation, coordinates=None, now=None):
    if not ready():
        return False
    now = time.time() if now is None else now
    source = "browser_location" if coordinates is not None else "ip_estimate"
    key = (observation["session"], source)
    with _recent_lock:
        _counts["received"] += 1
        if now - _recent.get(key, 0) < (10 if coordinates is not None else 25):
            return True
    location = coordinates or observation.get("_map_location")
    payload = {k: observation.get(k, "") for k in ("country", "region", "city")}
    if location:
        lat, lon, accuracy = (location.get(k) for k in ("latitude", "longitude", "accuracy_m"))
        if not all(isinstance(n, (int, float)) and math.isfinite(n) for n in (lat, lon, accuracy)):
            return False
        if not (-90 <= lat <= 90 and -180 <= lon <= 180 and accuracy > 0):
            return False
        payload.update(latitude=lat, longitude=lon, accuracy_m=accuracy)
    else:
        source = "unknown"
    identifier, nonce = uuid4().hex, secrets.token_bytes(12)
    associated = f"audience-location-v1:{identifier}:{observation['session']}:{source}".encode()
    ciphertext = _cipher().encrypt(nonce, json.dumps(payload, ensure_ascii=False).encode(), associated)
    try:
        with _gate.hold():
            conn = audience._connection()
            conn.execute("INSERT INTO audience_location_observations (id,session,seen_at,source,nonce,ciphertext) VALUES (?,?,?,?,?,?)",
                         (identifier, observation["session"], now, source, nonce, ciphertext))
            conn.commit()
        with _recent_lock:
            _recent[key] = now
            _counts["stored"] += 1
        return True
    except Exception:
        with _recent_lock:
            _counts["failed"] += 1
        return False


def overview(now=None):
    now = time.time() if now is None else now
    result = {"enabled": ready(), "online_window_seconds": ONLINE_SECONDS,
              "updated_at": now, "sessions": [], "located": 0, "unlocated": 0,
              "diagnostics": dict(_counts)}
    if not ready():
        return result
    # All reads: online filtering does not delete expired observations. Last
    # explicitly shared position is eligible for 15 minutes, with its own time.
    with _gate.hold():
        rows = audience._connection().execute("""WITH ranked AS (
            SELECT *, ROW_NUMBER() OVER(PARTITION BY session ORDER BY seen_at DESC,id DESC) AS n
            FROM audience_location_observations WHERE seen_at BETWEEN ? AND ?)
            SELECT id,session,seen_at,source,nonce,ciphertext FROM ranked WHERE n=1
            ORDER BY seen_at DESC LIMIT 500""", (now - ONLINE_SECONDS, now)).fetchall()
        precise = audience._connection().execute("""WITH ranked AS (
            SELECT *, ROW_NUMBER() OVER(PARTITION BY session ORDER BY seen_at DESC,id DESC) AS n
            FROM audience_location_observations WHERE source='browser_location' AND seen_at BETWEEN ? AND ?)
            SELECT id,session,seen_at,source,nonce,ciphertext FROM ranked WHERE n=1 LIMIT 500""",
            (now - PRECISE_SECONDS, now)).fetchall()
    shared = {row[1]: row for row in precise}
    for current in rows:
        row = shared.get(current[1], current)
        identifier, session, captured, source, nonce, ciphertext = row
        try:
            associated = f"audience-location-v1:{identifier}:{session}:{source}".encode()
            payload = json.loads(_cipher().decrypt(nonce, ciphertext, associated))
        except Exception:
            result["unlocated"] += 1
            continue
        item = {"id": session[:16], "seen_at": current[2], "captured_at": captured,
                "source": source, **payload}
        result["sessions"].append(item)
        result["located" if "latitude" in payload else "unlocated"] += 1
    return result
