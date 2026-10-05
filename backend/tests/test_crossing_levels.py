import unittest
from unittest.mock import patch
from app.services import realestate_water as water


class CrossingLevelsTests(unittest.TestCase):
    def test_signal_identity_and_level_survive_without_inventing_a_live_phase(self):
        elements = [
            {"type": "node", "id": 42, "lon": 127, "lat": 37, "tags": {"highway": "traffic_signals", "layer": "1", "traffic_signals:direction": "forward"}},
            {"type": "way", "id": 43, "tags": {"footway": "crossing", "crossing": "traffic_signals", "layer": "-1"}, "geometry": [{"lon": 127, "lat": 37}, {"lon": 127.0001, "lat": 37}]},
        ]
        with patch.object(water, "_overpass", return_value=elements):
            result = water._crossings_lookup(37, 127)
        self.assertEqual(result["signal_details"][0]["id"], "node/42")
        self.assertEqual(result["signal_details"][0]["layer"], 1)
        self.assertEqual(result["signal_details"][0]["direction"], "forward")
        self.assertIsNone(result["signal_details"][0]["state"])
        self.assertIsNone(result["signal_state_source"])
        self.assertEqual(result["crossings"][0]["layer"], -1)
        self.assertEqual(result["signals"][0], result["signal_details"][0]["at"])

    def test_transport_failure_does_not_claim_an_empty_verified_signal_survey(self):
        with patch.object(water, "_overpass", side_effect=water.BuildingsError("offline")):
            result = water._crossings_lookup(37, 127)
        self.assertIsNone(result["source"])
        self.assertEqual(result["signal_details"], [])
