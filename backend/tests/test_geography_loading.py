import datetime as dt
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock, patch
from app.services import geography_cache as cache, realestate_buildings as buildings


class GeographyLoadingTests(unittest.TestCase):
    def setUp(self):
        cache._memory.clear()
        self.saved = {}
        self.read = patch.object(cache.store, "load_facts", side_effect=lambda k: self.saved.get(k))
        self.write = patch.object(cache.store, "save_facts", side_effect=lambda k, b, t: self.saved.update({k: (t, b)}))
        self.read.start(); self.write.start()
        self.addCleanup(self.read.stop); self.addCleanup(self.write.stop)

    def test_verified_empty_result_survives_process_memory_reset(self):
        load = Mock(return_value={"rings": [], "source": "OpenStreetMap"})
        first = cache.cached_geography("water", 37.481, 127.0909, 680, load)
        cache._memory.clear()
        second = cache.cached_geography("water", 37.481, 127.0909, 680, load)
        self.assertEqual(first, second); self.assertEqual(load.call_count, 1)

    def test_error_does_not_replace_verified_stale_lake(self):
        body = {"rings": [{"ring": [[1, 2], [3, 4], [5, 6]]}], "source": "OpenStreetMap"}
        stamp = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=35)).isoformat()
        self.saved["geography-v1:water:37.4810:127.0909:680"] = (stamp, body)
        got = cache.cached_geography("water", 37.481, 127.0909, 680, lambda: {"rings": [], "source": None})
        self.assertEqual(got, body); self.assertEqual(next(iter(self.saved.values()))[0], stamp)

    def test_unavailable_is_not_saved_as_a_verified_empty_survey(self):
        got = cache.cached_geography("water", 37.481, 127.0909, 680, lambda: {"rings": [], "source": None})
        self.assertIsNone(got["source"]); self.assertEqual(self.saved, {})

    def test_identical_concurrent_readers_issue_one_lookup(self):
        started, release = threading.Event(), threading.Event()
        def lookup():
            started.set(); self.assertTrue(release.wait(2)); return {"rings": [], "source": "OpenStreetMap"}
        load = Mock(side_effect=lookup)
        with ThreadPoolExecutor(2) as pool:
            a = pool.submit(cache.cached_geography, "water", 37.481, 127.0909, 680, load)
            self.assertTrue(started.wait(2))
            b = pool.submit(cache.cached_geography, "water", 37.481, 127.0909, 680, load)
            release.set(); self.assertEqual(a.result(), b.result())
        self.assertEqual(load.call_count, 1)

    def test_radius_and_four_decimal_centres_are_independent(self):
        load = Mock(return_value={"rings": [], "source": "OpenStreetMap"})
        for lat, radius in [(37.481, 680), (37.4811, 680), (37.481, 700)]:
            cache.cached_geography("water", lat, 127.0909, radius, load)
        self.assertEqual(load.call_count, 3)

    def test_geography_transport_budget_stops_sequential_twenty_second_retries(self):
        clock = [0.]
        def fail(*args, **kw):
            clock[0] += sum(kw["timeout"])
            raise buildings.requests.Timeout()
        with patch.object(buildings.time, "monotonic", side_effect=lambda: clock[0]), patch.object(buildings.requests, "post", side_effect=fail) as post:
            with self.assertRaises(buildings.BuildingsError): buildings._overpass("query", deadline_s=4)
        self.assertEqual(post.call_count, 2); self.assertLessEqual(clock[0], 4.0001)

    def test_building_queries_keep_their_existing_transport_timeout(self):
        response = Mock(ok=True); response.json.return_value = {"elements": [{"id": 1}]}
        with patch.object(buildings.requests, "post", return_value=response) as post:
            self.assertEqual(buildings._overpass("query"), [{"id": 1}])
            self.assertEqual(post.call_args.kwargs["timeout"], (5, 20))


if __name__ == "__main__": unittest.main()
