"""Builds the boundaries the 부동산 맵's 3D region map draws (frontend/public/geo/realestate).

    python scripts/build_realestate_geo.py [work_dir]

Sources (downloaded into work_dir, default ./.geo-work):
  - 시·도 and 시·군·구: vuski/admdongkor 행정동 boundaries (ver20260701), dissolved by
    their sido / sgg codes. That version already has 전남광주통합특별시 and the 2026
    인천·화성 구, and its codes match the 법정동코드 table the map uses.
  - 읍·면·동: the 법정동 (EMD) boundaries of 2023-07 from juso, via gisdeveloper.co.kr,
    in GRS80 UTM-K. The trade data is filed under 법정동, so these are the shapes its
    동 names belong to. Each is assigned to the 시·군·구 its inner point lies in today,
    which follows every later 구 reorganisation; the few 읍 승격·renames since are
    applied by name.

Needs npx (mapshaper) and Python 3. Output: sido.json, sgg/<sido>.json,
emd/<sgg>.json — GeoJSON with code, name, lx/ly (a label point inside the shape)
and area (km²). The region list is read from the live /api/realestate/regions.
"""

from __future__ import annotations

import json
import subprocess
import sys
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "public" / "geo" / "realestate"
HJD_URL = "https://raw.githubusercontent.com/vuski/admdongkor/master/ver20260701/HangJeongDong_ver20260701.geojson"
EMD_URL = "http://www.gisdeveloper.co.kr/download/admin_shp/emd_20230729.zip"
REGIONS_URL = "https://kospimap.com/api/realestate/regions"
UTMK = "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs"
LABEL = "lx=this.innerX==null?null:+this.innerX.toFixed(5), ly=this.innerY==null?null:+this.innerY.toFixed(5), area=+(this.area/1e6).toFixed(2)"
# 읍 승격 and renames after the 2023-07 법정동 boundaries were drawn.
RENAMED = {"양지면": "양지읍", "대소면": "대소읍", "호명면": "호명읍", "금수면": "금수강산면"}


def mapshaper(*args: str) -> None:
    subprocess.run(["npx", "--yes", "mapshaper", *args], check=True, shell=sys.platform == "win32")


def fetch(url: str, dest: Path) -> Path:
    if not dest.exists():
        print("download", url)
        urllib.request.urlretrieve(url, dest)
    return dest


def rings(geom: dict) -> list:
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    return geom["coordinates"] if geom["type"] == "MultiPolygon" else []


def inside(x: float, y: float, polygon: list) -> bool:
    hit = False
    for ring in polygon:
        j = len(ring) - 1
        for i in range(len(ring)):
            (xi, yi), (xj, yj) = ring[i], ring[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                hit = not hit
            j = i
    return hit


def bbox(geom: dict) -> tuple[float, float, float, float]:
    pts = [p for poly in rings(geom) for ring in poly for p in ring]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def feature(f: dict) -> dict:
    p = f["properties"]
    keep = {k: p[k] for k in ("code", "name", "lx", "ly", "area") if k in p}
    return {"type": "Feature", "properties": keep, "geometry": f["geometry"]}


def dump(path: Path, feats: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = {"type": "FeatureCollection", "features": feats}
    path.write_text(json.dumps(body, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    work = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / ".geo-work")
    work.mkdir(parents=True, exist_ok=True)
    hjd = fetch(HJD_URL, work / "hjd.geojson")
    emd_zip = fetch(EMD_URL, work / "emd.zip")
    with zipfile.ZipFile(emd_zip) as z:
        z.extractall(work / "emd")
    shp = next((work / "emd").glob("*.shp"))

    mapshaper(str(hjd), "-dissolve2", "sido", "copy-fields=sidonm", "-simplify", "1.2%", "keep-shapes",
              "-filter-islands", "min-area=4km2", "-each", f"code=sido, name=sidonm, {LABEL}",
              "-o", str(work / "sido.json"), "format=geojson", "precision=0.0005")
    mapshaper(str(hjd), "-dissolve2", "sgg", "copy-fields=sido,sggnm", "-simplify", "2.5%", "keep-shapes",
              "-filter-islands", "min-area=1km2", "-each", f"code=sgg, name=sggnm, {LABEL}",
              "-o", str(work / "sgg.json"), "format=geojson", "precision=0.0003")
    mapshaper(str(hjd), "-dissolve2", "sgg", "-simplify", "20%", "-o", str(work / "sgg_join.json"),
              "format=geojson", "precision=0.00005")
    mapshaper("-i", str(shp), "encoding=cp949", "-proj", f"from={UTMK}", "crs=wgs84", "-clean",
              "-simplify", "6%", "keep-shapes", "-clean", "-filter-islands", "min-area=0.02km2",
              "-filter", "!this.isNull", "-each", f"code=EMD_CD, name=EMD_KOR_NM, {LABEL}",
              "-o", str(work / "emd_all.json"), "format=geojson", "precision=0.0001")

    regions = json.loads(urllib.request.urlopen(REGIONS_URL, timeout=30).read())
    ours = {g["code"]: g for s in regions["sido"] for g in s["sgg"]}

    dump(OUT / "sido.json", [feature(f) for f in load(work / "sido.json")["features"]])
    by_sido = defaultdict(list)
    for f in load(work / "sgg.json")["features"]:
        by_sido[f["properties"]["sido"]].append(feature(f))
    for sido, feats in by_sido.items():
        dump(OUT / "sgg" / f"{sido}.json", feats)

    districts = [(f["properties"]["sgg"], bbox(f["geometry"]), rings(f["geometry"]))
                 for f in load(work / "sgg_join.json")["features"]]
    per_sgg = defaultdict(list)
    for f in load(work / "emd_all.json")["features"]:
        p = f["properties"]
        if p.get("lx") is None:
            continue
        x, y = p["lx"], p["ly"]
        code = next((c for c, (a, b, c2, d), polys in districts
                     if a <= x <= c2 and b <= y <= d and any(inside(x, y, poly) for poly in polys)), None)
        if code is None and p["code"][:5] in ours:  # a coastal sliver outside every 시·군·구
            code = p["code"][:5]
        if code is None:
            continue
        p["name"] = RENAMED.get(p["name"], p["name"])
        per_sgg[code].append(feature(f))
    for code, feats in per_sgg.items():
        dump(OUT / "emd" / f"{code}.json", feats)

    unmatched = {code: sorted(set(g.get("dongs", [])) - {f["properties"]["name"] for f in per_sgg.get(code, [])})
                 for code, g in ours.items()}
    unmatched = {k: v for k, v in unmatched.items() if v}
    print(f"wrote {OUT}; 동 names without a shape: {sum(map(len, unmatched.values()))}")
    for code, names in unmatched.items():
        print(" ", code, ours[code]["name"], names)


if __name__ == "__main__":
    main()
