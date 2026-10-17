"""Builds the drone's public-facility table for South Korea (a NEW versioned directory each run).

Fire stations, police, public health centres, post offices, AEDs, shelters and subway entrances
from a read-only OpenStreetMap Overpass query (ODbL; attribution in the manifest), cut into
0.05-degree cells so the drone loads only the cells round it. Shipped as static files: the
hosting network cannot reach the public Overpass servers at run time.

  python scripts/build-public-facilities.py frontend/public/live/facilities-20261017-v1
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request

OVERPASS = ("https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter")
FILTERS = ('["amenity"="fire_station"]', '["amenity"="police"]', '["amenity"~"clinic|doctors|hospital"]["name"~"보건(소|지소|분소)"]',
           '["amenity"="post_office"]', '["emergency"="defibrillator"]', '["emergency"~"assembly_point|shelter"]', '["railway"="subway_entrance"]')
CELL = 0.05


def kind_of(t: dict) -> str | None:
    a, e, n = t.get("amenity", ""), t.get("emergency", ""), t.get("name", "")
    if t.get("railway") == "subway_entrance":
        return "exit"
    if a == "fire_station":
        return "fire"
    if a == "police":
        return "police"
    if a in ("clinic", "doctors", "hospital") and "보건" in n:
        return "health"
    if a == "post_office":
        return "post"
    if e == "defibrillator":
        return "aed"
    if e in ("assembly_point", "shelter"):
        return "shelter"
    return None


NAMES = {"fire": "소방서·119안전센터", "police": "경찰서·지구대", "health": "보건소", "post": "우체국", "aed": "자동심장충격기(AED)", "shelter": "대피소", "exit": "지하철 출입구"}


def main(out_dir: str) -> None:
    parts = "".join(f"nwr{f}(area.kr);" for f in FILTERS)
    query = f'[out:json][timeout:600];area["ISO3166-1"="KR"][admin_level=2]->.kr;({parts});out center tags;'
    data = None
    for url in OVERPASS:
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": query}).encode(), headers={"User-Agent": "kospimap-facilities-build/1"})
            with urllib.request.urlopen(req, timeout=900) as r:
                data = json.load(r)
            break
        except Exception as e:  # noqa: BLE001 - the next server
            print(url, e)
    if not data:
        raise SystemExit("no Overpass server answered")
    cells: dict[str, list] = {}
    counts: dict[str, int] = {}
    for el in data["elements"]:
        t = el.get("tags") or {}
        k = kind_of(t)
        lat, lon = (el.get("lat"), el.get("lon")) if "lat" in el else ((el.get("center") or {}).get("lat"), (el.get("center") or {}).get("lon"))
        if not k or lat is None:
            continue
        address = " ".join(v for v in (t.get("addr:city"), t.get("addr:district"), t.get("addr:street"), t.get("addr:housenumber")) if v) or t.get("addr:full", "")
        row = {"id": f"{el['type'][0]}{el['id']}", "kind": k, "name": (t.get("name:ko") or t.get("name") or NAMES[k])[:80],
               "lat": round(lat, 6), "lon": round(lon, 6)}
        for key, value in (("address", address[:120]), ("phone", (t.get("phone") or t.get("contact:phone") or "")[:40]),
                           ("hours", (t.get("opening_hours") or "")[:80]), ("access", t.get("access", "")),
                           ("description", (t.get("defibrillator:location") or t.get("description") or "")[:160]),
                           ("ref", (t.get("ref") or "")[:12]), ("wheelchair", t.get("wheelchair", ""))):
            if value:
                row[key] = value
        if t.get("indoor") == "yes" or t.get("location") == "indoor":
            row["indoor"] = True
        cell = f"{int(lat // CELL)}_{int(lon // CELL)}"
        cells.setdefault(cell, []).append(row)
        counts[k] = counts.get(k, 0) + 1
    os.makedirs(out_dir, exist_ok=False)  # (a new directory: never over an earlier build)
    for cell, rows in cells.items():
        with open(os.path.join(out_dir, cell + ".json"), "x", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(out_dir, "manifest.json"), "x", encoding="utf-8") as f:
        json.dump({"version": 1, "cell": CELL, "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "osmBase": data.get("osm3s", {}).get("timestamp_osm_base"),
                   "attribution": "© OpenStreetMap contributors · ODbL 1.0", "sourceUrl": "https://www.openstreetmap.org/copyright",
                   "counts": counts, "cells": sorted(cells)}, f, ensure_ascii=False, separators=(",", ":"))
    print(len(cells), "cells", counts)


if __name__ == "__main__":
    main(sys.argv[1])
