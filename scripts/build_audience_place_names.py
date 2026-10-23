"""Build display-only Korean labels from public GeoNames data (CC BY 4.0)."""
import io
import json
import re
import unicodedata
import zipfile
from pathlib import Path

import requests


def normalize(value):
    return "".join(c for c in unicodedata.normalize("NFKD", value).lower() if c.isascii() and c.isalnum())


regions, cities, ranks = {}, {}, {}
for name, member in [("cities15000", "cities15000.txt"), ("KR", "KR.txt")]:
    response = requests.get(f"https://download.geonames.org/export/dump/{name}.zip", timeout=60)
    response.raise_for_status()
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    for line in archive.read(member).decode("utf-8").splitlines():
        row = line.split("\t")
        if len(row) < 15 or row[6] not in ("P", "A"):
            continue
        if row[6] == "A" and row[7] != "ADM1":
            continue
        aliases = [row[1], row[2], *row[3].split(",")]
        korean = [x for x in aliases if re.search(r"[\uac00-\ud7a3]", x) and not re.search("[A-Za-z]", x)]
        if not korean:
            continue
        plain = [x for x in korean if re.fullmatch(r"[\uac00-\ud7a3]{2,16}", x)]
        preferred = max(plain, key=len) if plain else korean[0]
        target = regions if row[7] == "ADM1" else cities
        # Canonical/ASCII names avoid bundling every transliteration in every
        # language. Prefer the populated city over same-name tiny settlements.
        for alias in aliases[:2]:
            if not alias.isascii() or not normalize(alias):
                continue
            normalized = normalize(alias)
            keys = {row[8] + "|" + normalized}
            if row[8] == "KR":
                keys.add(row[8] + "|" + re.sub(r"(si|gun)$", "", normalized))
            for key in keys:
                rank = int(row[14] or 0)
                if rank >= ranks.get((id(target), key), -1):
                    target[key] = preferred
                    ranks[(id(target), key)] = rank
output = {"source": "GeoNames cities15000 and KR, 2026-10-23; CC BY 4.0, https://www.geonames.org/",
          "regions": regions, "cities": cities}
path = Path(__file__).resolve().parents[1] / "frontend/src/data/audiencePlaces.ko.json"
path.parent.mkdir(exist_ok=True)
path.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("Korean display aliases:", len(regions), "regions,", len(cities), "cities")
