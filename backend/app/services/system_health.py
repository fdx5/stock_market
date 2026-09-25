"""What the admin dashboard's 개요 shows about the server itself.

- the last warnings and errors logged anywhere in the process (a ring buffer fed by a
  logging handler installed at startup), so a failing batch or a timing-out store is
  on the dashboard rather than only in the platform's log stream;
- each store gate's load: calls, "busy" rejections, errors, average wait and work
  time, and whether its breaker is open;
- a round trip to the shared database, timed;
- the background threads alive, by name;
- memory, uptime and the deployed commit;
- the 부동산 collectors' progress.
"""

from __future__ import annotations

import collections
import datetime as dt
import logging
import os
import threading
import time
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
_started = time.time()

_RING = 300
_records: collections.deque = collections.deque(maxlen=_RING)
_ring_lock = threading.Lock()
_installed = False


class _RingHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = record.getMessage()
        except Exception:  # noqa: BLE001
            msg = str(record.msg)
        if record.exc_info and record.exc_info[1] is not None:
            msg = f"{msg} — {type(record.exc_info[1]).__name__}: {record.exc_info[1]}"
        with _ring_lock:
            _records.append(
                {
                    "at": dt.datetime.fromtimestamp(record.created, KST).isoformat(timespec="seconds"),
                    "level": record.levelname,
                    "logger": record.name,
                    "message": msg[:500],
                }
            )


def install() -> None:
    """Starts keeping warnings and errors; called once at startup."""
    global _installed
    if _installed:
        return
    handler = _RingHandler(level=logging.WARNING)
    logging.getLogger().addHandler(handler)
    # uvicorn's error logger does not propagate to the root logger.
    logging.getLogger("uvicorn.error").addHandler(handler)
    _installed = True


def recent_logs(limit: int = 120) -> list[dict]:
    with _ring_lock:
        return list(_records)[-limit:][::-1]


def _memory_mb() -> float | None:
    try:
        with open("/proc/self/status", encoding="utf-8") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return round(int(line.split()[1]) / 1024, 1)
    except OSError:
        pass
    try:
        import psutil  # type: ignore

        return round(psutil.Process().memory_info().rss / 1024 / 1024, 1)
    except Exception:  # noqa: BLE001
        return None


def _db_ping() -> dict:
    """A trivial query on the shared database, timed from asking to answer."""
    from app.services import page_view_store

    t = time.monotonic()
    try:
        page_view_store._with_connection(lambda c: c.execute("SELECT 1").fetchone())
        return {"ok": True, "ms": round((time.monotonic() - t) * 1000)}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "ms": round((time.monotonic() - t) * 1000), "error": f"{type(exc).__name__}: {exc}"[:200]}


def _threads() -> list[dict]:
    counts: dict[str, int] = collections.Counter()
    for t in threading.enumerate():
        name = t.name
        # Pools and one-off workers are numbered; group them by what they are.
        base = name.split("_")[0] if name.startswith(("ThreadPoolExecutor", "AnyIO")) else name.rsplit("-", 1)[0] if name.rsplit("-", 1)[-1].isdigit() else name
        counts[base] += 1
    return [{"name": k, "count": v} for k, v in sorted(counts.items())]


def _realestate() -> dict:
    from app.services import realestate_map as rm
    from app.services import realestate_rent as rr
    from app.services import realestate_store as st
    from app.services import realestate_summary as rs

    deep = rm._deep_months()
    districts = [g["code"] for s in rm.regions()["sido"] for g in s["sgg"]]
    index = dict(rm._index)
    deep_have = sum(1 for code in districts for ym in deep if (code, ym) in index)
    recent = rm._months_back(rm.MONTHS_KEPT)
    recent_have = sum(1 for code in districts for ym in recent if (code, ym) in index)
    with rm._queue_lock:
        queued = len(rm._queued)
        in_flight = rm._in_flight
    with rm._rebuild_lock:
        rebuilding = len(rm._rebuild_queue)
    return {
        "configured": rm.is_configured(),
        "calls_today": rm.calls_today("trade"),
        "calls_today_rent": rm.calls_today("rent"),
        "calls_today_kapt": rm.calls_today("kapt"),
        "daily_limit": rm.DAILY_CALL_LIMIT,
        "last_error": rm._last_error,
        "collecting": in_flight,
        "queued_districts": queued,
        "recent_coverage": round(recent_have / max(1, len(districts) * len(recent)), 4),
        "history_coverage": round(deep_have / max(1, len(districts) * len(deep)), 4),
        "history_from": rm.HISTORY_FROM,
        "districts_in_memory": len(rm._districts),
        "maps_cached": len(rm._map_cache),
        "maps_rebuild_queue": rebuilding,
        "summaries_cached": len(rs._cache),
        "summaries_pending": len(rs._pending),
        "rent_districts_cached": len(rr._cache),
        "rent_queue": len(rr._wanted),
        "rent_error": rr._error,
        "separate_db": st.SEPARATE,
        "migration": dict(st.migration_state),
    }


def snapshot() -> dict:
    from app.services import admin_query_cache, libsql_gate

    try:
        realestate = _realestate()
    except Exception as exc:  # noqa: BLE001
        realestate = {"error": f"{type(exc).__name__}: {exc}"[:200]}
    logs = recent_logs()
    since = time.time() - 3600
    last_hour = [r for r in logs if dt.datetime.fromisoformat(r["at"]).timestamp() >= since]
    return {
        "at": dt.datetime.now(KST).isoformat(timespec="seconds"),
        "uptime_s": round(time.time() - _started),
        "commit": os.environ.get("RENDER_GIT_COMMIT", "dev")[:12],
        "memory_mb": _memory_mb(),
        "db": _db_ping(),
        "gates": libsql_gate.all_gates(),
        "threads": _threads(),
        "errors_last_hour": sum(1 for r in last_hour if r["level"] in ("ERROR", "CRITICAL")),
        "warnings_last_hour": sum(1 for r in last_hour if r["level"] == "WARNING"),
        "logs": logs,
        "admin_cache": admin_query_cache.status(),
        "realestate": realestate,
    }
