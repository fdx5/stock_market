"""Builds the drone's metropolitan subway station table (a NEW versioned file each run).

The Seoul real-time subway API (swopenapi.seoul.go.kr) names a train's station and line only;
placing it needs each station's position and each line's station order. Both come from a
read-only OpenStreetMap Overpass query of the route relations (ODbL; attribution in the file).

  python scripts/build-subway-stations.py frontend/public/live/subway-20261017-v1.json
"""
from __future__ import annotations

import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request

OVERPASS = "https://overpass-api.de/api/interpreter"
QUERY = """[out:json][timeout:240];
rel["route"~"^(subway|light_rail|train|monorail)$"](36.75,126.25,38.05,127.85)->.r;
.r out body;
(node(r.r:"stop");node(r.r:"stop_entry_only");node(r.r:"stop_exit_only");)->.s;
.s out body;
"""

# The lines the real-time API answers for, and how OpenStreetMap's route names name them.
LINES = {
    "1호선": ("#0052A4", [r"(수도권|서울).*1호선", r"^1호선", r"경부선.*전철|경인선.*전철|경원선.*전철|장항선.*전철"]),
    "2호선": ("#00A84D", [r"(수도권|서울).*2호선", r"^2호선"]),
    "3호선": ("#EF7C1C", [r"(수도권|서울).*3호선", r"^3호선", r"일산선"]),
    "4호선": ("#00A5DE", [r"(수도권|서울).*4호선", r"^4호선", r"안산선|과천선"]),
    "5호선": ("#996CAC", [r"(수도권|서울).*5호선", r"^5호선"]),
    "6호선": ("#CD7C2F", [r"(수도권|서울).*6호선", r"^6호선"]),
    "7호선": ("#747F00", [r"(수도권|서울).*7호선", r"^7호선"]),
    "8호선": ("#E6186C", [r"(수도권|서울).*8호선", r"^8호선"]),
    "9호선": ("#BDB092", [r"(수도권|서울).*9호선", r"^9호선"]),
    "경의중앙선": ("#77C4A3", [r"경의.?중앙선", r"경의선", r"중앙선"]),
    "공항철도": ("#0090D2", [r"공항철도", r"AREX"]),
    "경춘선": ("#0C8E72", [r"경춘선"]),
    "수인분당선": ("#FABE00", [r"수인.?분당선", r"분당선", r"수인선"]),
    "신분당선": ("#D4003B", [r"신분당선"]),
    "우이신설선": ("#B0CE18", [r"우이신설"]),
    "서해선": ("#8FC31F", [r"서해선", r"대곡소사"]),
    "경강선": ("#0054A6", [r"경강선"]),
    "GTX-A": ("#9A6292", [r"GTX.?A", r"수도권 광역급행철도 A"]),
    "신림선": ("#6789CA", [r"신림선"]),
}
EXCLUDE = re.compile(r"KTX|SRT|ITX|무궁화|새마을|누리로|관광|급행 전용|화물|공항철도 직통|직통열차")


def norm(name: str) -> str:
    """A station's name as both sources can agree on it: no 역, no bracketed alias, no spaces."""
    n = re.sub(r"\(.*?\)", "", name or "")
    n = re.sub(r"\s+", "", n)
    return n[:-1] if n.endswith("역") and len(n) > 2 else n


def line_of(tags: dict) -> str | None:
    text = " ".join(str(tags.get(k, "")) for k in ("name", "name:ko", "ref", "network", "official_name"))
    if EXCLUDE.search(text):
        return None
    # (the most specific names first: 신분당선 is not 분당선, 경의중앙선 not 중앙선)
    for line in sorted(LINES, key=lambda l: l not in ("신분당선", "우이신설선", "GTX-A", "신림선", "공항철도")):
        if any(re.search(p, text) for p in LINES[line][1]):
            return line
    return None


def main(out_path: str) -> None:
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    req = urllib.request.Request(OVERPASS, data=body, headers={"User-Agent": "kospimap-subway-build/1"})
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.load(r)
    nodes = {e["id"]: e for e in data["elements"] if e["type"] == "node"}
    rels = [e for e in data["elements"] if e["type"] == "relation"]
    stations: list[dict] = []

    def station_for(node: dict) -> int | None:
        name = (node.get("tags") or {}).get("name:ko") or (node.get("tags") or {}).get("name")
        if not name:
            return None
        key = norm(name)
        for i, s in enumerate(stations):
            if s["key"] == key and math.hypot((s["lat"] - node["lat"]) * 110540, (s["lon"] - node["lon"]) * 88000) < 700:
                s["_pts"].append((node["lat"], node["lon"]))
                return i
        stations.append({"key": key, "name": re.sub(r"역$", "", name.split("(")[0].strip()) or name,
                         "lat": node["lat"], "lon": node["lon"], "lines": [], "_pts": [(node["lat"], node["lon"])]})
        return len(stations) - 1

    routes: dict[str, list[dict]] = {}
    for rel in rels:
        tags = rel.get("tags") or {}
        line = line_of(tags)
        if not line:
            continue
        order: list[int] = []
        for m in rel.get("members", []):
            if m["type"] != "node" or not m.get("role", "").startswith("stop") or m["ref"] not in nodes:
                continue
            i = station_for(nodes[m["ref"]])
            if i is not None and (not order or order[-1] != i):
                order.append(i)
        if len(order) < 2:
            continue
        for i in order:
            if line not in stations[i]["lines"]:
                stations[i]["lines"].append(line)
        name = str(tags.get("name") or "")
        loop = "내선" if "내선" in name else "외선" if "외선" in name else None
        routes.setdefault(line, []).append({"stops": order, "loop": loop, "name": name[:80]})

    # (each station at the mean of its stops: the platforms of its lines)
    used = sorted({i for rs in routes.values() for r in rs for i in r["stops"]})
    remap = {old: new for new, old in enumerate(used)}
    out_stations = []
    for old in used:
        s = stations[old]
        lat = sum(p[0] for p in s["_pts"]) / len(s["_pts"])
        lon = sum(p[1] for p in s["_pts"]) / len(s["_pts"])
        out_stations.append({"name": s["name"], "key": s["key"], "lat": round(lat, 6), "lon": round(lon, 6), "lines": s["lines"]})
    out_lines = {}
    for line, rs in routes.items():
        # (distinct stop sequences only; the longest first)
        seen, keep = set(), []
        for r in sorted(rs, key=lambda r: -len(r["stops"])):
            sig = tuple(r["stops"])
            if sig in seen:
                continue
            seen.add(sig)
            keep.append({"stops": [remap[i] for i in r["stops"]], **({"loop": r["loop"]} if r["loop"] else {})})
        out_lines[line] = {"colour": LINES[line][0], "routes": keep[:12]}
    result = {
        "version": 1,
        "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "attribution": "© OpenStreetMap contributors · ODbL 1.0",
        "sourceUrl": "https://www.openstreetmap.org/copyright",
        "lines": out_lines,
        "stations": out_stations,
    }
    with open(out_path, "x", encoding="utf-8") as f:  # (a new file: never over an earlier build)
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(out_stations)} stations, " + ", ".join(f"{k}:{len(v['routes'])}" for k, v in out_lines.items()))


if __name__ == "__main__":
    main(sys.argv[1])
