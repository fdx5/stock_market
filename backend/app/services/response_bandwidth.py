"""Bounded, in-memory response-byte counters. No bodies, queries, IPs or identities."""
import json
import logging
import threading
import time

log = logging.getLogger("uvicorn.error")
MAX_ROUTES = 256


class Counters:
    def __init__(self):
        self.lock = threading.Lock()
        self.started = self.window_started = time.time()
        self.total = {}
        self.window = {}

    @staticmethod
    def rows(values):
        return sorted(({"route": key, **value} for key, value in values.items()),
                      key=lambda row: row["bytes"], reverse=True)

    def record(self, route, size, *, response=True):
        now = time.time()
        report = None
        with self.lock:
            if route not in self.total and len(self.total) >= MAX_ROUTES:
                route = "other"
            for values in (self.total, self.window):
                row = values.setdefault(route, {"bytes": 0, "responses": 0})
                row["bytes"] += size
                row["responses"] += int(response)
            if now - self.window_started >= 60:
                report = {"seconds": round(now - self.window_started),
                          "bytes": sum(row["bytes"] for row in self.window.values()),
                          "routes": self.rows(self.window)[:20]}
                self.window = {}
                self.window_started = now
        if report:
            log.info("egress-window %s", json.dumps(report, separators=(",", ":")))

    def snapshot(self):
        with self.lock:
            return {"since": self.started, "bytes": sum(row["bytes"] for row in self.total.values()),
                    "routes": self.rows(self.total)[:40],
                    "scope": "HTTP compressed response bodies and WebSocket payloads; excludes network headers and service-initiated traffic"}


counters = Counters()


def route_key(scope, *, websocket=False):
    path = scope.get("path", "")
    route = getattr(scope.get("route"), "path", "")
    if websocket:
        return "ws:" + (route or "unknown")
    if path.startswith("/api/"):
        return route or "/api/unknown"
    # Static groups have bounded cardinality even with arbitrary caller input.
    for prefix in ("/assets/", "/img/ticker/", "/img/", "/3d/", "/video/", "/making/", "/bgm/", "/geo/", "/rail/", "/live/", "/neo/"):
        if path.startswith(prefix):
            suffix = path.rsplit(".", 1)[-1].lower()
            return prefix + "*." + (suffix if suffix in {"js", "css", "json", "webp", "png", "svg", "bin", "mp4", "gz", "wav", "mp3", "html"} else "other")
    return "document" if route else "unmatched"


class ResponseBandwidthMiddleware:
    def __init__(self, app, observer=None):
        self.app = app
        self.observer = observer if observer is not None else counters

    async def __call__(self, scope, receive, send):
        if scope["type"] not in {"http", "websocket"}:
            return await self.app(scope, receive, send)
        size = 0
        completed = False

        async def counted_send(message):
            nonlocal size, completed
            await send(message)
            if message["type"] == "http.response.body":
                size += len(message.get("body", b""))
                completed = not message.get("more_body", False)
            elif message["type"] == "websocket.send":
                payload = message.get("bytes")
                amount = len(payload) if payload is not None else len(message.get("text", "").encode("utf-8"))
                self.observer.record(route_key(scope, websocket=True), amount, response=False)

        try:
            await self.app(scope, receive, counted_send)
        finally:
            if scope["type"] == "http":
                self.observer.record(route_key(scope), size, response=completed)
