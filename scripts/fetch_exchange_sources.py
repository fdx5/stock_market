"""Fetch CC0 production sources for the trading floor into a scratch directory."""
from concurrent.futures import ThreadPoolExecutor
from hashlib import md5
from io import BytesIO
from pathlib import Path
import argparse
import json
from urllib.request import Request, urlopen
from zipfile import ZipFile

from PIL import Image, ImageEnhance, ImageOps

MATERIALS = {
    "marble": ("Marble012", "#777685"),
    "walnut": ("Wood067", "#bb977f"),
    "steel": ("Metal032", "#777b8c"),
    "leather": ("Leather037", "#85778b"),
    "carpet": ("Carpet006", "#9b92ae"),
    "plaster": ("Concrete034", "#8393b1"),
}
MODELS = ("modern_arm_chair_01", "industrial_coffee_table", "potted_plant_04")
HDRI = "events_hall_interior"
AGENT = "KOSPIMAP Exchange Floor (https://kospimap.com)"


def download(url):
    with urlopen(Request(url, headers={"User-Agent": AGENT}), timeout=45) as response:
        return response.read()


def ambient(output, entry):
    name, (asset_id, tint) = entry
    payload = download(f"https://ambientcg.com/get?file={asset_id}_2K-JPG.zip")
    target = output / "materials"
    target.mkdir(parents=True, exist_ok=True)
    with ZipFile(BytesIO(payload)) as bundle:
        for source, channel in (("Color", "color"), ("NormalGL", "normal"), ("Roughness", "roughness")):
            item = next(path for path in bundle.namelist() if path.endswith(f"_{source}.jpg"))
            image = Image.open(BytesIO(bundle.read(item))).convert("RGB" if channel != "roughness" else "L")
            image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
            if channel == "color":
                color = tuple(bytes.fromhex(tint[1:]))
                tinted = ImageOps.colorize(ImageOps.grayscale(image), (4, 4, 7), color)
                image = ImageEnhance.Contrast(tinted).enhance(1.14)
            elif channel == "roughness" and name == "marble":
                image = image.point(lambda value: 62 + value * .69)
            quality = 83 if channel == "color" else 80
            image.save(target / f"{name}-{channel}.jpg", quality=quality, optimize=True)
    print(f"{name}: {asset_id}", flush=True)


def polyhaven(output, identifier):
    entries = json.loads(download(f"https://api.polyhaven.com/files/{identifier}"))
    hdr = identifier == HDRI
    info = entries["hdri"]["1k"]["hdr"] if hdr else entries["gltf"]["1k"]["gltf"]
    target = output if hdr else output / identifier
    files = {("lighting.hdr" if hdr else f"{identifier}.gltf"): info, **info.get("include", {})}
    for path, spec in files.items():
        file = (target / path).resolve()
        if not file.is_relative_to(target.resolve()):
            raise ValueError(path)
        body = download(spec["url"])
        if md5(body).hexdigest() != spec["md5"]:
            raise ValueError(f"Checksum mismatch: {identifier}/{path}")
        file.parent.mkdir(parents=True, exist_ok=True)
        if file.suffix in (".jpg", ".jpeg"):
            img = Image.open(BytesIO(body)).convert("RGB")
            img.thumbnail((768, 768), Image.Resampling.LANCZOS)
            img.save(file, quality=82, optimize=True)
        else:
            file.write_bytes(body)
    print(identifier, flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(6) as pool:
        tasks = [pool.submit(ambient, args.output, item) for item in MATERIALS.items()]
        tasks += [pool.submit(polyhaven, args.output, key) for key in (*MODELS, HDRI)]
        for task in tasks:
            task.result()
