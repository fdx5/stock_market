"""Fetch CC0 production sources for the trading atrium (v5) into a scratch directory.

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

# name: (ambientCG id, colour size, data-map size) — v5 atrium palette after the concept boards
MATERIALS = {
    "stone": ("Marble012", 2048, 1024),      # light grey honed stone: plaza floor and gallery floors
    "trav": ("Travertine009", 2048, 1024),   # warm light travertine: columns, fascias, ribs
    "oak": ("WoodFloor051", 2048, 1024),     # oak floorboards: lounge decks
    "veneer": ("Wood095", 2048, 2048),       # continuous light oak veneer: glulam columns/ribs, slats, desks, rails
    "carpet": ("Fabric030", 1024, 1024),     # charcoal woven carpet tiles under the desks
    "weave": ("Carpet014", 1024, 1024),      # light woven fabric: sofas, desk privacy screens
    "plaster": ("Plaster001", 1024, 1024),   # soffits and office back walls
    "leather": ("Leather030", 1024, 1024),   # dark leather: lounge chairs
    "steel": ("Metal032", 1024, 1024),       # brushed metal: monitor arms, mullions
}
# Roughness remap (scale, bias) baked into the texture, since glTF has no roughness offset.
ROUGHNESS = {"stone": (.45, .05), "trav": (.8, .1), "oak": (.6, .08), "veneer": (.55, .1), "leather": (.9, .05), "steel": (.6, .05)}
MODELS = ("sofa_02", "sofa_03", "modern_arm_chair_01", "mid_century_lounge_chair", "Ottoman_01",
          "coffee_table_round_01", "modern_coffee_table_02", "side_table_01", "potted_plant_01", "potted_plant_02",
          "potted_plant_04", "pachira_aquatica_01", "fern_02", "desk_lamp_arm_01")
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
    tone(target, name)
    print(f"{name}: {asset_id}", flush=True)


# Re-tone after download (mean sRGB, saturation kept): the concept's warm light stone and linen.
TONE = {"stone": ((200, 196, 189), .35), "trav": ((208, 200, 187), .45), "weave": ((204, 194, 178), .55),
        "plaster": ((226, 222, 215), .3)}


def tone(target, name):
    if name not in TONE:
        return
    import numpy as np
    mean, keep = TONE[name]
    path = target / f"{name}-color.jpg"
    image = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)
    grey = (image @ np.array([.2126, .7152, .0722], dtype=np.float32))[..., None]
    out = grey + (image - grey) * keep
    out += np.array(mean, dtype=np.float32) - out.reshape(-1, 3).mean(axis=0)
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(path, quality=92, optimize=True)


# Poly Haven models re-toned for the concept's light upholstery: (source, copy, mean sRGB).
PROP_TONES = [("sofa_03", "sofa_03_linen", (198, 187, 170))]


def rotate_veneer(target):
    """veneerv: the veneer turned 90 degrees, for vertical grain on columns and wall slats."""
    for channel in ("color", "roughness", "normal"):
        image = Image.open(target / f"veneer-{channel}.jpg")
        image = image.transpose(Image.Transpose.ROTATE_90)
        if channel == "normal":   # a 90 deg counter-clockwise turn maps tangent (x, y) to (-y, x)
            import numpy as np
            a = np.asarray(image.convert("RGB")).astype(np.int16)
            a = np.stack([255 - a[..., 1], a[..., 0], a[..., 2]], axis=-1).astype(np.uint8)
            image = Image.fromarray(a)
        image.save(target / f"veneerv-{channel}.jpg", quality=92, optimize=True)
    print("veneerv", flush=True)


def tone_props(output):
    import shutil
    import numpy as np
    for source, copy, mean in PROP_TONES:
        src, dst = output / source, output / copy
        if not dst.exists():
            shutil.copytree(src, dst)
            (dst / f"{source}.gltf").rename(dst / f"{copy}.gltf")
        for diff in (src / "textures").glob("*diff*"):
            image = np.asarray(Image.open(diff).convert("RGB"), dtype=np.float32)
            lum = image @ np.array([.2126, .7152, .0722], dtype=np.float32)
            shade = np.clip((lum / max(lum.mean(), 1)) ** .7, .35, 1.6)[..., None]
            Image.fromarray(np.clip(np.array(mean, dtype=np.float32) * shade, 0, 255).astype(np.uint8)).save(
                dst / "textures" / diff.name, quality=92)
        print(copy, flush=True)


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
    tone_props(args.output)
    rotate_veneer(args.output / "materials")
