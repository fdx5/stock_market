"""Fetch CC0 production sources for the trading floor into a scratch directory.

PBR surfaces come from ambientCG and furniture from Poly Haven (both CC0). Checksums from
the Poly Haven API are verified; nothing outside the output directory is written.
"""
from concurrent.futures import ThreadPoolExecutor
from hashlib import md5
from io import BytesIO
from pathlib import Path
import argparse
import json
from urllib.request import Request, urlopen
from zipfile import ZipFile

from PIL import Image

# name: (ambientCG id, colour size, data-map size)
MATERIALS = {
    "floor": ("Marble016", 2048, 1024),      # deep green-black veined marble
    "wallstone": ("Marble020", 2048, 1024),  # warm beige marble
    "cream": ("Marble014", 2048, 1024),      # cream pilaster marble
    "gold": ("Metal048A", 1024, 1024),       # gold leaf
    "brass": ("Metal042A", 1024, 1024),      # brushed brass
    "walnut": ("Wood066", 2048, 1024),
    "carpet": ("Carpet012", 1024, 1024),
    "leather": ("Leather026", 1024, 1024),
    "plaster": ("PaintedPlaster017", 1024, 1024),
    "steel": ("Metal032", 1024, 1024),
}
# Roughness remap (scale, bias) baked into the texture, since glTF has no roughness offset.
ROUGHNESS = {"floor": (.55, .02), "wallstone": (.8, .12), "cream": (.7, .08), "gold": (.9, .04), "brass": (.8, .05),
             "walnut": (.55, .06), "leather": (.9, .05), "steel": (.7, .06)}
MODELS = ("Chandelier_03", "bull_head", "sofa_02", "mid_century_lounge_chair", "potted_plant_02",
          "marble_bust_01", "vintage_grandfather_clock_01", "modern_coffee_table_01")
AGENT = "KOSPIMAP Exchange Floor (https://kospimap.com)"


def download(url):
    with urlopen(Request(url, headers={"User-Agent": AGENT}), timeout=90) as response:
        return response.read()


def ambient(output, entry):
    name, (asset_id, color_size, data_size) = entry
    payload = download(f"https://ambientcg.com/get?file={asset_id}_2K-JPG.zip")
    target = output / "materials"
    target.mkdir(parents=True, exist_ok=True)
    with ZipFile(BytesIO(payload)) as bundle:
        for source, channel in (("Color", "color"), ("NormalGL", "normal"), ("Roughness", "roughness")):
            item = next(path for path in bundle.namelist() if path.endswith(f"_{source}.jpg"))
            image = Image.open(BytesIO(bundle.read(item))).convert("L" if channel == "roughness" else "RGB")
            size = color_size if channel == "color" else data_size
            if image.width > size:
                image = image.resize((size, size), Image.Resampling.LANCZOS)
            image.save(target / f"{name}-{channel}{'-raw' if channel == 'roughness' else ''}.jpg", quality=90, optimize=True)
    remap_roughness(target, name)
    print(f"{name}: {asset_id}", flush=True)


def remap_roughness(target, name):
    scale, bias = ROUGHNESS.get(name, (1, 0))
    image = Image.open(target / f"{name}-roughness-raw.jpg").convert("L")
    image.point(lambda v: max(0, min(255, round(v * scale + bias * 255)))).save(
        target / f"{name}-roughness.jpg", quality=92, optimize=True)


def polyhaven(output, identifier):
    entries = json.loads(download(f"https://api.polyhaven.com/files/{identifier}"))
    info = entries["gltf"]["1k"]["gltf"]
    target = output / identifier
    files = {f"{identifier}.gltf": info, **info.get("include", {})}
    for path, spec in files.items():
        file = (target / path).resolve()
        if not file.is_relative_to(target.resolve()):
            raise ValueError(path)
        body = download(spec["url"])
        if md5(body).hexdigest() != spec["md5"]:
            raise ValueError(f"Checksum mismatch: {identifier}/{path}")
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(body)
    print(identifier, flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(6) as pool:
        tasks = [pool.submit(ambient, args.output, item) for item in MATERIALS.items()]
        tasks += [pool.submit(polyhaven, args.output, key) for key in MODELS]
        for task in tasks:
            task.result()
