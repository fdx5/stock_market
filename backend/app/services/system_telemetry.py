"""Bounded, credential-free transport observations for the system atlas.

Only hosts, methods, status and timings are retained. Requests headers, URL paths,
queries, SQL, bodies and exception messages never enter this buffer. This observes
requests' HTTP adapter, including Turso; SDK httpx, SMTP and browser traffic are
explicitly outside its coverage. It does not claim end-to-end distributed tracing.
"""
from __future__ import annotations

import functools
import contextvars
import itertools
import math
import threading
import time
from collections import deque
from urllib.parse import urlsplit

import requests.adapters

_lock = threading.Lock()
_events: deque[dict] = deque(maxlen=2400)
_sequence = 0
_installed = False
_started = time.time()
_request_ids = itertools.count(1)
_request_context: contextvars.ContextVar = contextvars.ContextVar("atlas_request", default=None)


def begin_request(scope: dict):
    """ASGI scope is populated with the matched route before its handler runs.
    AnyIO copies this context into sync handlers; detached jobs have no request.
    Only the matched route template is retained, never the concrete request URL.
    """
    return _request_context.set({"scope": scope, "trace_id": next(_request_ids)})


def end_request(token) -> None:
    _request_context.reset(token)


def request_id() -> int | None:
    context = _request_context.get()
    return context["trace_id"] if context else None


def record(host: str, method: str, status: int, ms: float) -> None:
    global _sequence
    with _lock:
        _sequence += 1
        event = {"id": _sequence, "ts": time.time(), "host": host[:160],
                 "method": method[:12], "status": status, "ms": round(ms, 1)}
        context = _request_context.get()
        if context:
            route = getattr(context["scope"].get("route"), "path", "")
            if route.startswith("/api/"):
                event.update(route=route, trace_id=context["trace_id"])
        _events.append(event)


def install() -> None:
    global _installed
    if _installed:
        return
    original = requests.adapters.HTTPAdapter.send

    @functools.wraps(original)
    def observed(self, request, *args, **kwargs):
        started = time.perf_counter()
        status = 0
        try:
            response = original(self, request, *args, **kwargs)
            status = response.status_code
            return response
        finally:
            try:
                record(urlsplit(request.url).hostname or "unknown", request.method,
                       status, (time.perf_counter() - started) * 1000)
            except Exception:  # observability must never affect a request
                pass

    requests.adapters.HTTPAdapter.send = observed
    _installed = True


def stats(events: list[dict]) -> dict:
    values = sorted(e["ms"] for e in events)
    return {"count": len(events), "errors": sum(e["status"] == 0 or e["status"] >= 500 for e in events),
            "client_errors": sum(400 <= e["status"] < 500 for e in events),
            "avg_ms": round(sum(values) / len(values), 1) if values else None,
            "p95_ms": values[max(0, math.ceil(len(values) * .95) - 1)] if values else None,
            "last_at": max((e["ts"] for e in events), default=None)}


def snapshot() -> dict:
    now = time.time()
    with _lock:
        retained = list(_events)
    events = [e for e in retained if e["ts"] >= now - 60]
    hosts = sorted({e["host"] for e in events})
    return {"started_at": _started, "window_s": 60, "capacity": _events.maxlen,
            "window_truncated": len(retained) == _events.maxlen and retained[0]["ts"] > now - 60,
            "hosts": [{"host": host, **stats([e for e in events if e["host"] == host])} for host in hosts],
            "flows": [{"route": route, "host": host, **stats([e for e in events if e.get("route") == route and e["host"] == host])}
                      for route, host in sorted({(e["route"], e["host"]) for e in events if e.get("route")})],
            "recent": retained[-60:][::-1], **stats(events)}
