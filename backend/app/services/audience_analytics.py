"""Append-only, pseudonymous audience observations. Never store raw IPs or IDs.

Request handlers do no DDL. The owner-authorized deployment adds the dedicated
table on startup; existing rows and tables are never altered. Server-only app
credentials may be used only when explicitly activated by the operator.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import os
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import unquote
from uuid import UUID

from app.services import audience_network, libsql_gate, turso

KST = timezone(timedelta(hours=9))
_gate = libsql_gate.Gate("audience_analytics", lock_timeout=0.25)
_conn = None
_schema_ready = False
_ip_source_counts = {"trusted_client_ip": 0, "proxy_ip_rejected": 0, "untrusted_proxy": 0}


def _settings():
    dedicated = (os.environ.get("AUDIENCE_DATABASE_URL"), os.environ.get("AUDIENCE_DATABASE_TOKEN"))
    if all(dedicated):
        return dedicated
    # Explicit production activation uses the server's existing app connection.
    # Credentials remain inside the deployed server; AI tooling never reads them.
    if os.environ.get("AUDIENCE_USE_APP_STORE") == "1":
        return os.environ.get("TURSO_DATABASE_URL"), os.environ.get("TURSO_AUTH_TOKEN")
    return None, None


def configured() -> bool:
    return len(os.environ.get("AUDIENCE_HMAC_KEY", "")) >= 32 and all(_settings())


def ready() -> bool:
    return configured() and _schema_ready


def initialize():
    """Owner-authorized operational activation: additive schema, no old changes."""
    global _schema_ready
    if not configured():
        return False
    try:
        with _gate.hold():
            conn = _connection()
            conn.execute("""CREATE TABLE IF NOT EXISTS audience_observations (
                day TEXT NOT NULL, browser TEXT NOT NULL, session TEXT NOT NULL,
                network TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '',
                region TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '',
                location_source TEXT NOT NULL DEFAULT 'unknown',
                PRIMARY KEY(day,browser,session,network,country,region,city,location_source))""")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_audience_browser_day ON audience_observations(browser,day)")
            conn.commit()
            _schema_ready = True
        return True
    except Exception:
        return False


def _digest(kind: str, value: str) -> str:
    return hmac.new(os.environ["AUDIENCE_HMAC_KEY"].encode(),
                    f"audience-v1:{kind}:{value}".encode(), hashlib.sha256).hexdigest()


def _uuid(value: str) -> str:
    return str(UUID(value))


def _text(value: str | None) -> str:
    value = unquote(value or "").strip()
    return "".join(c for c in value if c.isalnum() or c in " .-'()").strip()[:80]


def context(request, browser_id: str | None, session_id: str, is_bot: bool,
            now: datetime | None = None) -> dict | None:
    """Read IP/location only through an authenticated edge, never arbitrary XFF.

    DNT/GPC and old clients deliberately produce no new audience observation.
    The per-day network HMAC is a network count, never a substitute person ID.
    """
    if (not configured() or not browser_id or is_bot
            or request.headers.get("dnt") == "1" or request.headers.get("sec-gpc") == "1"):
        return None
    try:
        browser_id, session_id = _uuid(browser_id), _uuid(session_id)
    except (ValueError, AttributeError):
        return None
    day = (now or datetime.now(timezone.utc)).astimezone(KST).date().isoformat()
    country = region = city = network = ""
    geo = {}
    edge_key = os.environ.get("AUDIENCE_EDGE_SECRET", "")
    supplied = request.headers.get("x-audience-edge-key", "")
    secret_trusted = len(edge_key) >= 32 and hmac.compare_digest(edge_key.encode(), supplied.encode())
    trusted = secret_trusted or audience_network.render_proxy_trusted(request)
    if trusted:
        try:
            ip = ipaddress.ip_address(request.headers.get("cf-connecting-ip", ""))
            if ip.is_global and not audience_network.is_cloudflare_proxy(ip):
                network = _digest(f"network:{day}", ip.compressed)
                _ip_source_counts["trusted_client_ip"] += 1
            elif ip.is_global:
                _ip_source_counts["proxy_ip_rejected"] += 1
        except ValueError:
            pass
        geo = audience_network.lookup(ip.compressed) if network else {}
        code = str(geo.get("country") or request.headers.get("cf-ipcountry", "")).upper()
        if network and re.fullmatch("[A-Z]{2}", code) and code not in {"XX", "T1"}:
            country = code
            region = _text(geo.get("region"))
            city = _text(geo.get("city"))
            if secret_trusted and not geo:
                region = _text(request.headers.get("cf-region"))
                city = _text(request.headers.get("cf-ipcity"))
    if not trusted:
        _ip_source_counts["untrusted_proxy"] += 1
    observation = {"day": day, "browser": _digest("browser", browser_id),
            "session": _digest("session", session_id), "network": network,
            "country": country, "region": region, "city": city,
            "location_source": ("dbip_city_lite" if country and (region or city) and geo else "cloudflare_ip") if country else "unknown"}
    if geo.get("latitude") is not None and geo.get("longitude") is not None:
        observation["_map_location"] = {k: geo[k] for k in ("latitude", "longitude", "accuracy_m")}
    return observation


def _connection():
    global _conn
    if _conn is None:
        url, token = _settings()
        _conn = turso.connect(database=url, auth_token=token)
    return _conn


def record(observation: dict) -> bool:
    """Only INSERT OR IGNORE; all dimensions are retained when a visitor moves."""
    if not configured():
        return False
    try:
        with _gate.hold():
            conn = _connection()
            conn.execute("""INSERT OR IGNORE INTO audience_observations
                (day, browser, session, network, country, region, city, location_source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                tuple(observation[key] for key in (
                    "day", "browser", "session", "network", "country", "region", "city", "location_source")))
            conn.commit()
        return True
    except Exception:
        # No exception text: a database error can contain bound private values.
        return False


def overview(days: int = 30, now: datetime | None = None, country: str = "") -> dict:
    now = now or datetime.now(timezone.utc)
    end = now.astimezone(KST).date()
    start = (end - timedelta(days=days - 1)).isoformat()
    end = end.isoformat()
    result = {"enabled": ready(), "days": days, "start_date": start, "end_date": end,
              "edge_configured": len(os.environ.get("AUDIENCE_EDGE_SECRET", "")) >= 32 or os.environ.get("RENDER", "").lower() == "true",
              "geoip_available": audience_network.geoip_available(),
              "schema_ready": _schema_ready,
              "available_from": None, "browsers": 0, "sessions": 0, "repeat_browsers": 0,
              "regular_browsers": 0, "network_days": 0, "located_browser_days": 0,
              "browser_days": 0, "daily": [], "regions": [], "country": country, "countries": []}
    if not result["enabled"]:
        return result
    with _gate.hold():
        conn = _connection()
        result["available_from"] = conn.execute("SELECT MIN(day) FROM audience_observations").fetchone()[0]
        params = (start, end)
        result["browsers"], result["sessions"], result["network_days"] = conn.execute(
            """SELECT COUNT(DISTINCT browser), COUNT(DISTINCT session),
            COUNT(DISTINCT CASE WHEN network<>'' THEN network END)
            FROM audience_observations WHERE day BETWEEN ? AND ?""", params).fetchone()
        repeat = conn.execute("""SELECT COALESCE(SUM(n>=2),0), COALESCE(SUM(n>=3),0)
            FROM (SELECT COUNT(DISTINCT day) n FROM audience_observations
            WHERE day BETWEEN ? AND ? GROUP BY browser)""", params).fetchone()
        result["repeat_browsers"], result["regular_browsers"] = repeat
        daily = conn.execute("""SELECT day, COUNT(DISTINCT browser), COUNT(DISTINCT session),
            COUNT(DISTINCT CASE WHEN country<>'' THEN browser END)
            FROM audience_observations WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day""", params).fetchall()
        result["daily"] = [dict(zip(("date", "browsers", "sessions", "located_browsers"), row)) for row in daily]
        result["browser_days"] = sum(row[1] for row in daily)
        result["located_browser_days"] = sum(row[3] for row in daily)
        preferred = """FROM audience_observations AS current WHERE day BETWEEN ? AND ?
            AND (location_source='browser_location' OR NOT EXISTS (
                SELECT 1 FROM audience_observations AS precise
                WHERE precise.browser=current.browser AND precise.day=current.day
                AND precise.location_source='browser_location'))"""
        countries = conn.execute("""SELECT country, COUNT(DISTINCT day || ':' || browser) """ + preferred +
            " GROUP BY country ORDER BY country", params).fetchall()
        result["countries"] = [{"country": row[0], "browser_days": row[1]} for row in countries]
        country_clause = " AND country=?" if country else ""
        region_params = (*params, "" if country == "unknown" else country) if country else params
        regions = conn.execute("""SELECT country, region, city, location_source,
            COUNT(DISTINCT day || ':' || browser) AS n
            """ + preferred + country_clause + """
            GROUP BY country, region, city, location_source ORDER BY n DESC, country, region, city LIMIT 100""", region_params).fetchall()
        result["regions"] = [dict(zip(("country", "region", "city", "source", "browser_days"), row)) for row in regions]
    return result
