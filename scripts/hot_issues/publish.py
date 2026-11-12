"""Manual backup for 오늘의 핫이슈. The server writes editions itself (hot_issue_writer).

    python scripts/hot_issues/publish.py --slot 2026-11-12T2200 --dry-run   # preview to tmp/
    python scripts/hot_issues/publish.py --slot 2026-11-12T2200             # append to editorial-editions

Without --dry-run the edition is appended to the public editorial-editions branch,
which the server reads only when it has no edition of its own for that slot. An
existing file is never overwritten or deleted. No database access.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("HOT_ISSUES_SCHEDULER", "0")
from app.services import hot_issues as hi, hot_issue_writer as writer  # noqa: E402

REPO_API = "https://api.github.com/repos/fdx5/stock_market"
BRANCH = "editorial-editions"


def _token() -> str:
    if os.environ.get("GITHUB_TOKEN"):
        return os.environ["GITHUB_TOKEN"]
    fill = subprocess.run(["git", "credential", "fill"], input="protocol=https\nhost=github.com\n\n", capture_output=True, text=True, timeout=30)
    for line in fill.stdout.splitlines():
        if line.startswith("password="):
            return line.removeprefix("password=")
    raise RuntimeError("GitHub credential is missing")


def archive(payload: dict, slot) -> bool:
    headers = {"Authorization": "Bearer " + _token(), "Accept": "application/vnd.github+json"}
    path = "/contents/" + hi.archive_path(slot)
    for _ in range(4):
        existing = requests.get(REPO_API + path, params={"ref": BRANCH}, headers=headers, timeout=30)
        if existing.status_code == 200:
            return False
        if existing.status_code != 404:
            existing.raise_for_status()
        response = requests.put(REPO_API + path, headers=headers, timeout=30, json={
            "branch": BRANCH, "message": f"Hot issues {slot:%Y-%m-%d %H:%M} KST",
            "content": base64.b64encode(json.dumps(payload, ensure_ascii=False, allow_nan=False, indent=1).encode()).decode()})
        if response.status_code == 201:
            return True
        if response.status_code not in (409, 422):
            response.raise_for_status()
        time.sleep(3)
    raise RuntimeError("archive append did not complete")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--slot", required=True, help="YYYY-MM-DDTHHMM, e.g. 2026-11-12T2200")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    slot = hi.parse_slot(args.slot[:10], args.slot[11:15])
    if slot is None:
        parser.error("unknown slot")
    raw, usage = writer.generate(slot)
    out = ROOT / "tmp" / "hot-issues" / f"{slot:%Y-%m-%d-%H%M}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(raw, ensure_ascii=False, indent=1), encoding="utf-8")
    result = {"slot": slot.isoformat(), "file": str(out), "stories": len(raw["stories"]), **usage}
    if not args.dry_run:
        result["archived"] = archive(raw, slot)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
