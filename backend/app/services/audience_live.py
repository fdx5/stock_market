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
import unicodedata
from functools import lru_cache
from pathlib import Path
from uuid import uuid4

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.services import audience_analytics as audience, libsql_gate

_ready = False
_gate = libsql_gate.Gate("audience_live", lock_timeout=1.5)
_recent = {}
_recent_lock = threading.Lock()
_counts = {"received": 0, "stored": 0, "failed": 0}
_last_write = {"received_at": None, "stored_at": None, "failed_at": None, "failure": None}
ONLINE_SECONDS = 24 * 60 * 60
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


def collection_status():
    if not audience.configured():
        return "audience_not_configured"
    if not audience.ready():
        return "audience_store_not_ready"
    if not configured():
        return "location_key_unavailable"
    if not _ready:
        return "location_store_not_ready"
    return "ready"


def _failed(now, reason):
    with _recent_lock:
        _counts["failed"] += 1
        _last_write.update(failed_at=now, failure=reason)
    return False


def record(observation, coordinates=None, now=None):
    now = time.time() if now is None else now
    source = "browser_location" if coordinates is not None else "ip_estimate"
    key = (observation["session"], source)
    with _recent_lock:
        _counts["received"] += 1
        _last_write["received_at"] = now
        if not ready():
            _counts["failed"] += 1
            _last_write.update(failed_at=now, failure=collection_status())
            return False
        if now - _recent.get(key, 0) < (10 if coordinates is not None else 25):
            return True
    location = coordinates or observation.get("_map_location")
    payload = {k: observation.get(k, "") for k in ("country", "region", "city")}
    if location:
        lat, lon, accuracy = (location.get(k) for k in ("latitude", "longitude", "accuracy_m"))
        valid = (all(isinstance(n, (int, float)) and not isinstance(n, bool) and math.isfinite(n)
                     for n in (lat, lon, accuracy))
                 and -90 <= lat <= 90 and -180 <= lon <= 180 and accuracy > 0)
        if not valid and coordinates is not None:
            return _failed(now, "invalid_coordinates")
        # A bad GeoIP entry must not discard a valid visit. Keep its presence,
        # with no coordinates, rather than silently losing the entire session.
        if valid:
            payload.update(latitude=lat, longitude=lon, accuracy_m=accuracy)
        else:
            source = "unknown"
    else:
        source = "unknown"
    identifier, nonce = uuid4().hex, secrets.token_bytes(12)
    associated = f"audience-location-v1:{identifier}:{observation['session']}:{source}".encode()
    try:
        ciphertext = _cipher().encrypt(nonce, json.dumps(payload, ensure_ascii=False).encode(), associated)
        with _gate.hold():
            conn = audience._connection()
            conn.execute("INSERT INTO audience_location_observations (id,session,seen_at,source,nonce,ciphertext) VALUES (?,?,?,?,?,?)",
                         (identifier, observation["session"], now, source, nonce, ciphertext))
            conn.commit()
        with _recent_lock:
            _recent[key] = now
            _counts["stored"] += 1
            _last_write["stored_at"] = now
        return True
    except Exception:
        return _failed(now, "location_write_failed")


def overview(now=None, country=""):
    now = time.time() if now is None else now
    result = {"enabled": ready(), "online_window_seconds": ONLINE_SECONDS,
              "updated_at": now, "sessions": [], "located": 0, "unlocated": 0,
              "total": 0, "all_total": 0, "truncated": False, "unreadable": 0, "country": country,
              "collection_status": collection_status(),
              "geoip_available": audience.audience_network.geoip_available(),
              "diagnostics": {**_counts, **_last_write}}
    if not ready():
        return result
    # All reads: online filtering does not delete expired observations. Last
    # explicitly shared position is eligible for 15 minutes, with its own time.
    with _gate.hold():
        rows = audience._connection().execute("""WITH ranked AS (
            SELECT *, ROW_NUMBER() OVER(PARTITION BY session ORDER BY seen_at DESC,id DESC) AS n
            FROM audience_location_observations WHERE seen_at BETWEEN ? AND ?)
            SELECT id,session,seen_at,source,nonce,ciphertext FROM ranked WHERE n=1
            ORDER BY seen_at DESC""", (now - ONLINE_SECONDS, now)).fetchall()
        precise = audience._connection().execute("""WITH ranked AS (
            SELECT *, ROW_NUMBER() OVER(PARTITION BY session ORDER BY seen_at DESC,id DESC) AS n
            FROM audience_location_observations WHERE source='browser_location' AND seen_at BETWEEN ? AND ?)
            SELECT id,session,seen_at,source,nonce,ciphertext FROM ranked WHERE n=1""",
            (now - PRECISE_SECONDS, now)).fetchall()
    shared = {row[1]: row for row in precise}
    result["all_total"] = len(rows)
    cipher = _cipher()
    for current in rows:
        row = shared.get(current[1], current)
        identifier, session, captured, source, nonce, ciphertext = row
        try:
            associated = f"audience-location-v1:{identifier}:{session}:{source}".encode()
            payload = json.loads(cipher.decrypt(nonce, ciphertext, associated))
        except Exception:
            # A failed location decode must not erase an observed visit from the
            # session list. Preserve the presence, without exposing old ciphertext.
            result["unreadable"] += 1
            payload = {"country": "", "region": "", "city": ""}
            source = "unknown"
        if source == "browser_location" and captured < now - PRECISE_SECONDS:
            payload = {k: payload.get(k, "") for k in ("country", "region", "city")}
            source = "unknown"
        if country and payload.get("country", "") != ("" if country == "unknown" else country):
            continue
        item = {"id": session[:16], "seen_at": current[2], "captured_at": captured,
                "source": source, **payload}
        result["sessions"].append(item)
        result["located" if "latitude" in payload else "unlocated"] += 1
    result["total"] = len(result["sessions"])
    result["truncated"] = result["total"] > 500
    result["sessions"] = result["sessions"][:500]
    return result


@lru_cache(maxsize=1)
def _place_centres():
    return json.loads((Path(__file__).resolve().parents[1] / "data/audience_place_centres.json").read_text(encoding="utf-8"))["centres"]


def region_history(days=30, country=""):
    """Display old regional aggregates at public city centres; no invented visits."""
    data = audience.overview(days, country=country)
    items = []
    for index, row in enumerate(data["regions"]):
        normalized = "".join(c for c in unicodedata.normalize("NFKD", row["city"]).lower() if c.isascii() and c.isalnum())
        point = _place_centres().get(row["country"] + "|" + normalized)
        item = {"id": f"region-{index}", "source": "historical_region", "seen_at": 0, "captured_at": 0,
                "country": row["country"], "region": row["region"], "city": row["city"], "browser_days": row["browser_days"]}
        if point:
            item.update(latitude=point[0], longitude=point[1], accuracy_m=50000)
        items.append(item)
    return {"enabled": data["enabled"], "updated_at": time.time(), "sessions": items, "country": country, "total": len(items),
            "located": sum("latitude" in item for item in items), "unlocated": sum("latitude" not in item for item in items),
            "diagnostics": {"received": 0, "stored": 0, "failed": 0}}
