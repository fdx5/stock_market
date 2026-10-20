"""Collect verified public videos outside the web host and append via its batch API.

No database access, dotenv loading, stored credentials or replacement of old editions.
"""
import json
import os
from pathlib import Path
import sys
import time

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.data import editorial_sources as source


def main():
    market = sys.argv[1]
    if market not in ("kr", "us"):
        raise SystemExit("Expected kr or us")
    token = os.environ.get("EDITORIAL_REFRESH_TOKEN")
    if not token:
        raise SystemExit("Editorial batch secret is missing")
    base = "https://kospimap.com/api/editorial"
    headers = {"Authorization": "Bearer " + token}
    for attempt in range(3):
        try:
            payload = source.fetch_videos(market)
            # Retry only the handoff while a deployment is still starting.
            for handoff in range(20):
                response = requests.post(base + "/videos/edition", json=payload, headers=headers, timeout=30)
                if response.status_code not in (404, 502, 503, 504):
                    break
                if handoff < 19:
                    time.sleep(30)
            response.raise_for_status()
            result = requests.get(base + "/videos", params={"market": market}, timeout=30)
            result.raise_for_status()
            current = result.json()
            if current.get("edition") != payload["edition"] or current.get("stale") or not current.get("items"):
                raise RuntimeError("Server edition has not become current")
            print(json.dumps({"market": market, "edition": current["edition"], "count": len(current["items"]),
                              "handoff": response.json().get("status")}))
            return
        except Exception as exc:
            # Never print requests exceptions: their URL may contain a provider API key.
            print(json.dumps({"market": market, "attempt": attempt + 1, "error": type(exc).__name__,
                              **getattr(exc, "diagnostics", {})}), flush=True)
            if attempt < 2:
                time.sleep(30)
    raise SystemExit("Editorial collection or handoff failed")


if __name__ == "__main__":
    main()
