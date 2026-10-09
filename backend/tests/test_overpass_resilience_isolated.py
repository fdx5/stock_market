"""Execute only transport/parser AST nodes with mocked requests. No app or DB imports."""
import ast
import datetime as dt
import logging
import math
import threading
import time
import unittest
from email.utils import format_datetime, parsedate_to_datetime
from pathlib import Path
from types import SimpleNamespace

SERVICES = Path(__file__).resolve().parents[1] / "app" / "services"


def load_nodes(filename, names, namespace):
    tree = ast.parse((SERVICES / filename).read_text(encoding="utf-8"))
    selected = []
    for node in tree.body:
        name = getattr(node, "name", None)
        if isinstance(node, ast.Assign):
            name = getattr(node.targets[0], "id", None)
        elif isinstance(node, ast.AnnAssign):
            name = getattr(node.target, "id", None)
        if name in names:
            selected.append(node)
    assert len(selected) == len(names), names
    exec(compile(ast.Module(body=selected, type_ignores=[]), filename, "exec"), namespace)


class RequestFailure(Exception):
    pass


class Response:
    def __init__(self, body=None, status=200, headers=None):
        self.body, self.status_code, self.headers = body, status, headers or {}
        self.ok = 200 <= status < 400

    def json(self):
        if isinstance(self.body, Exception):
            raise self.body
        return self.body


class OverpassResilience(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.respond = lambda url: Response({"elements": []})
        def post(url, **kwargs):
            self.calls.append((url, kwargs))
            return self.respond(url)
        self.ns = {"dt": dt, "math": math, "threading": threading, "time": time,
                   "log": logging.getLogger("isolated-overpass-test"),
                   "parsedate_to_datetime": parsedate_to_datetime,
                   "requests": SimpleNamespace(post=post, RequestException=RequestFailure)}
        load_nodes("realestate_buildings.py", {
            "UA", "OVERPASS", "_overpass_gate", "_overpass_health_lock", "_overpass_retry_at",
            "BuildingsError", "_overpass_ready", "_overpass_pause", "_overpass_retry_delay",
            "_overpass_elements", "_overpass", "_projector"}, self.ns)
        load_nodes("realestate_water.py", {"_crossings_lookup", "_parse_crossings"}, self.ns)

    def test_independent_mirrors_only(self):
        self.assertEqual(len(self.ns["OVERPASS"]), 2)
        self.assertTrue(all("kumi.systems" not in url for url in self.ns["OVERPASS"]))

    def test_external_500_becomes_unavailable_and_pauses_both_mirrors(self):
        self.respond = lambda url: Response(status=500)
        result = self.ns["_crossings_lookup"](37.5, 127)
        self.assertIsNone(result["source"])
        self.assertEqual(len(self.calls), 2)
        self.ns["_crossings_lookup"](37.5, 127)
        self.assertEqual(len(self.calls), 2)
        resume_at = max(self.ns["_overpass_retry_at"].values()) + 1
        self.ns["time"] = SimpleNamespace(monotonic=lambda: resume_at)
        self.respond = lambda url: Response({"elements": []})
        self.assertEqual(self.ns["_crossings_lookup"](37.5, 127)["source"], "OpenStreetMap")
        self.assertEqual(len(self.calls), 3)

    def test_fallback_preserves_valid_elements_and_query(self):
        elements = [{"type": "way", "id": 10, "tags": {"name": "bridge"}}]
        first = self.ns["OVERPASS"][0]
        self.respond = lambda url: Response(status=503) if url == first else Response({"elements": elements})
        self.assertIs(self.ns["_overpass"]("safe query", deadline_s=4), elements)
        self.assertEqual(len(self.calls), 2)
        self.assertTrue(all(k["data"] == {"data": "safe query"} for _, k in self.calls))

    def test_429_retry_after_and_406_wait_at_least_30_seconds(self):
        before = time.monotonic()
        self.respond = lambda url: Response(status=429, headers={"Retry-After": "90"})
        self.ns["_crossings_lookup"](37.5, 127)
        self.assertTrue(all(at >= before + 90 for at in self.ns["_overpass_retry_at"].values()))
        delay = self.ns["_overpass_retry_delay"]
        self.assertEqual(delay(Response(status=406, headers={"Retry-After": "2"})), 30)
        self.assertEqual(delay(Response(headers={"Retry-After": "nan"})), 30)
        future = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=120)
        self.assertGreater(delay(Response(headers={"Retry-After": format_datetime(future)})), 118)

    def test_malformed_json_never_becomes_verified_empty(self):
        invalid = [[], {}, {"elements": None}, {"elements": [None]},
                   {"elements": [], "remark": "runtime error: Query timed out"},
                   {"elements": [{"tags": None}]},
                   {"elements": [{"geometry": [{"lat": 37.5}]}]},
                   {"elements": [{"members": [None]}]},
                   {"elements": [{"lat": float("nan"), "lon": 127}]},
                   ValueError("invalid json")]
        for body in invalid:
            with self.subTest(body=body):
                self.setUp()
                self.respond = lambda url: Response(body)
                result = self.ns["_crossings_lookup"](37.5, 127)
                self.assertIsNone(result["source"])
                self.assertEqual(len(self.calls), 2)

    def test_missing_node_coordinates_cannot_raise_internal_500(self):
        self.respond = lambda url: Response({"elements": [{"type": "node", "id": 1, "tags": {"highway": "crossing"}}]})
        self.assertIsNone(self.ns["_crossings_lookup"](37.5, 127)["source"])

    def test_successful_empty_response_is_verified(self):
        result = self.ns["_crossings_lookup"](37.5, 127)
        self.assertEqual(result["source"], "OpenStreetMap")
        self.assertEqual(result["crossings"], [])
        self.assertIn("fetched_at", result)

    def test_levels_signals_and_projection_remain_exact(self):
        elements = [
            {"type": "way", "id": 42, "tags": {"layer": "2", "crossing": "traffic_signals"},
             "geometry": [{"lat": 37.5, "lon": 127}, {"lat": 37.5001, "lon": 127.0001}]},
            {"type": "node", "id": 7, "lat": 37.5, "lon": 127, "tags": {"highway": "traffic_signals", "layer": "-1", "traffic_signals:direction": "forward"}},
            {"type": "node", "id": 8, "lat": 37.5, "lon": 127, "tags": {"highway": "crossing", "crossing": "zebra"}}]
        self.respond = lambda url: Response({"elements": elements})
        result = self.ns["_crossings_lookup"](37.5, 127)
        line = result["crossings"][0]
        self.assertEqual(line["layer"], 2)
        self.assertTrue(line["signals"])
        self.assertEqual(line["line"], [(0, 0), self.ns["_projector"](37.5, 127)(127.0001, 37.5001)])
        self.assertEqual(result["signal_details"][0]["layer"], -1)
        self.assertTrue(result["points"][0]["marked"])
        self.assertIsNone(result["signal_details"][0]["state"])

    def test_network_exception_releases_capacity(self):
        def fail(url):
            raise RequestFailure()
        self.respond = fail
        self.assertIsNone(self.ns["_crossings_lookup"](37.5, 127)["source"])
        gate = self.ns["_overpass_gate"]
        self.assertTrue(gate.acquire(blocking=False))
        self.assertTrue(gate.acquire(blocking=False))
        self.assertFalse(gate.acquire(blocking=False))
        gate.release()
        gate.release()

    def test_all_foreground_calls_share_two_slots_and_apply_backpressure(self):
        release = threading.Event()
        entered = threading.Event()
        guard = threading.Lock()
        active = 0
        peak = 0
        def blocked(url):
            nonlocal active, peak
            with guard:
                active += 1
                peak = max(peak, active)
                if active == 2:
                    entered.set()
            if not release.wait(2):
                raise AssertionError("mock request did not finish")
            with guard:
                active -= 1
            return Response({"elements": []})
        self.respond = blocked
        results = []
        workers = [threading.Thread(target=lambda: results.append(self.ns["_crossings_lookup"](37.5, 127))) for _ in range(2)]
        for worker in workers:
            worker.start()
        try:
            self.assertTrue(entered.wait(1))
            self.assertIsNone(self.ns["_crossings_lookup"](37.5, 127)["source"])
            self.assertEqual(len(self.calls), 2)
        finally:
            release.set()
            for worker in workers:
                worker.join(2)
        self.assertEqual(peak, 2)
        self.assertEqual(len(results), 2)


if __name__ == "__main__":
    unittest.main()
