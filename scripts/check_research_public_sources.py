"""Read-only source smoke check against the isolated local preview server."""
import concurrent.futures
import json
import time
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
PATHS = [
    "asset/005930?market=kospi", "asset/AAPL?market=nasdaq", "asset/USDKRW?market=nasdaq",
    "asset/KOSPI?market=kospi", "finance/005930", "finance/AAPL", "profile/005930",
    "fund/069500?region=KR", "fund/102110?region=KR", "fund/VOO?region=US",
    "curve", "macro?indicator=growth", "crypto", "orderbook", "derivatives", "calendar", "sessions",
]

def check(path):
    start = time.monotonic()
    response = requests.get("http://127.0.0.1:8000/api/discovery/" + path, timeout=55)
    data = response.json()
    return {"path": path, "status": response.status_code, "items": len(data.get("items", [])), "source": data.get("source"), "seconds": round(time.monotonic() - start, 2)}

if __name__ == "__main__":
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(check, PATHS))
    output = ROOT / "tmp/local-discovery-preview/live-source-checks.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"checks": len(results), "successful": sum(r["status"] == 200 and r["items"] > 0 for r in results), "empty_or_failed": [r for r in results if r["status"] != 200 or not r["items"]]}, ensure_ascii=False))
