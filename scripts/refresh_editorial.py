"""Collect verified public videos outside the web host and append via its batch API.

No database access, dotenv loading, stored credentials or replacement of old editions.
"""
import base64
import json
import os
from pathlib import Path
import sys
import time

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.data import editorial_sources as source


def archive(payload: dict) -> dict:
    """Create one public file per market/slot on a data branch, never overwrite it."""
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("Archive credential is missing")
    base = "https://api.github.com/repos/fdx5/stock_market"
    headers = {"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json"}
    branch = "editorial-editions"
    response = requests.get(base + "/git/ref/heads/" + branch, headers=headers, timeout=30)
    if response.status_code == 404:
        response = requests.post(base + "/git/refs", headers=headers, timeout=30,
                                 json={"ref": "refs/heads/" + branch, "sha": os.environ["GITHUB_SHA"]})
        if response.status_code != 422:  # The other market may have just created it.
            response.raise_for_status()
    else:
        response.raise_for_status()
    cutoff = source._iso(payload["window_end"])
    path = "/contents/" + source.video_archive_path(payload["market"], cutoff)
    for attempt in range(4):
        existing = requests.get(base + path, params={"ref": branch}, headers=headers, timeout=30)
        if existing.status_code == 200:
            return json.loads(base64.b64decode(existing.json()["content"]))
        if existing.status_code != 404:
            existing.raise_for_status()
        response = requests.put(base + path, headers=headers, timeout=30, json={
            "branch": branch, "message": f'Archive {payload["market"]} videos for {payload["edition"]}',
            "content": base64.b64encode(json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()).decode()})
        if response.status_code == 201:
            return payload
        if response.status_code not in (409, 422):
            response.raise_for_status()
        time.sleep(2)
    raise RuntimeError("Archive append did not complete")


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
            collected = source.fetch_videos(market, use_archive=False)
            print(json.dumps({"market": market, "source": collected["source"],
                              "verified_items": len(collected["items"])}), flush=True)
            payload = archive(collected)
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
            if (current.get("edition") != payload["edition"] or current.get("window_end") != payload["window_end"]
                    or current.get("stale") or not current.get("items")):
                raise RuntimeError("Server edition has not become current")
            print(json.dumps({"market": market, "edition": current["edition"], "window_end": current["window_end"], "count": len(current["items"]),
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
