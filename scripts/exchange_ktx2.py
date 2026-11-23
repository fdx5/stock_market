"""Build GPU-compressed copies of the v5 hall and its two lightmaps with Khronos toktx."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory

from PIL import Image

from glb_webp import read_glb, write_glb


WEBP = "EXT_texture_webp"
BASIS = "KHR_texture_basisu"
MESHOPT = "EXT_meshopt_compression"


def encode(picture, work, name, srgb, uastc, toktx):
    source, output = work / f"{name}.png", work / f"{name}.ktx2"
    picture.save(source)
    codec = (["--encode", "uastc", "--uastc_quality", "2", "--zcmp", "12", "--uastc_rdo_l", "0.75", "--uastc_rdo_m"]
             if uastc else ["--encode", "etc1s", "--qlevel", "255", "--clevel", "2"])
    subprocess.run([str(toktx), *codec,
                    "--genmipmap", "--threads", "2", "--assign_oetf", "srgb" if srgb else "linear",
                    str(output), str(source)], check=True)
    return output.read_bytes()


def build(assets, toktx, version="v6"):
    gltf, binary = read_glb(assets / f"trading-hall-{version}.glb")
    textures = gltf["textures"]
    color_sources, normal_sources = set(), set()
    for material in gltf["materials"]:
        pbr = material.get("pbrMetallicRoughness", {})
        for info in (pbr.get("baseColorTexture"), material.get("emissiveTexture")):
            if info:
                color_sources.add(textures[info["index"]]["extensions"][WEBP]["source"])
        if info := material.get("normalTexture"):
            normal_sources.add(textures[info["index"]]["extensions"][WEBP]["source"])

    def contents(view):
        offset = view.get("byteOffset", 0)
        return binary[offset:offset + view["byteLength"]]

    views = gltf["bufferViews"]
    with TemporaryDirectory() as directory, ThreadPoolExecutor(max_workers=5) as pool:
        work = Path(directory)

        def convert_image(item):
            index, image = item
            with Image.open(BytesIO(contents(views[image["bufferView"]]))) as picture:
                alpha = "A" in picture.getbands() and picture.getchannel("A").getextrema()[0] < 255
                return encode(picture, work, str(index), index in color_sources, alpha or index in normal_sources, toktx)

        lightmaps = {}
        for group in ("shell", "fixtures"):
            name = f"lightmap-{group}-{version}"
            with Image.open(assets / f"{name}.webp") as picture:
                lightmaps[name] = pool.submit(encode, picture.copy(), work, name, True, True, toktx)
        images = dict(zip((im["bufferView"] for im in gltf["images"]),
                          pool.map(convert_image, enumerate(gltf["images"]))))
        for name, future in lightmaps.items():
            (assets / f"{name}.ktx2").write_bytes(future.result())

    # Copy the meshopt payload bytes verbatim, moving only their offsets in buffer 0.
    packed = bytearray()
    for index, view in enumerate(views):
        physical = view.get("extensions", {}).get(MESHOPT, view)
        assert physical["buffer"] == 0
        data = images[index] if index in images else contents(physical)
        packed.extend(b"\0" * (-len(packed) % 4))
        physical.update(byteOffset=len(packed), byteLength=len(data))
        packed.extend(data)
    for image in gltf["images"]:
        image["mimeType"] = "image/ktx2"
    for texture in textures:
        extensions = texture["extensions"]
        extensions[BASIS] = extensions.pop(WEBP)
    for key in ("extensionsUsed", "extensionsRequired"):
        gltf[key] = [BASIS if ext == WEBP else ext for ext in gltf[key]]
    gltf["buffers"][0]["byteLength"] = len(packed)
    write_glb(assets / f"trading-hall-{version}-ktx2.glb", gltf, bytes(packed))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("assets", type=Path)
    parser.add_argument("--toktx", default="toktx")
    parser.add_argument("--version", default="v6")
    args = parser.parse_args()
    build(args.assets, args.toktx, args.version)
