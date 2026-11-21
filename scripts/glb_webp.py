"""Re-encode every embedded PNG/JPEG image of an uncompressed GLB as WebP (EXT_texture_webp).

    python scripts/glb_webp.py <in.glb> <out.glb> [--quality 88]

Run before gltfpack: buffer views are rebuilt, so the input must not use EXT_meshopt_compression.
Images that carry alpha (opacity) are encoded with alpha; normal maps get a higher quality.
"""
import argparse
from io import BytesIO
import json
import struct

from PIL import Image


def read_glb(path):
    data = open(path, "rb").read()
    magic, version, _ = struct.unpack("<III", data[:12])
    assert magic == 0x46546C67 and version == 2
    offset, chunks = 12, {}
    while offset < len(data):
        length, kind = struct.unpack("<II", data[offset:offset + 8])
        chunks[kind] = data[offset + 8:offset + 8 + length]
        offset += 8 + length
    return json.loads(chunks[0x4E4F534A]), chunks.get(0x004E4942, b"")


def write_glb(path, gltf, binary):
    text = json.dumps(gltf, separators=(",", ":")).encode()
    text += b" " * (-len(text) % 4)
    binary += b"\0" * (-len(binary) % 4)
    total = 12 + 8 + len(text) + 8 + len(binary)
    with open(path, "wb") as out:
        out.write(struct.pack("<III", 0x46546C67, 2, total))
        out.write(struct.pack("<II", len(text), 0x4E4F534A) + text)
        out.write(struct.pack("<II", len(binary), 0x004E4942) + binary)


def convert(src, dst, quality):
    gltf, binary = read_glb(src)
    if "EXT_meshopt_compression" in gltf.get("extensionsUsed", []):
        raise SystemExit("Input already meshopt-compressed; convert before gltfpack")
    views = gltf["bufferViews"]
    replaced = {}
    normal_images = set()
    for material in gltf.get("materials", []):
        if "normalTexture" in material:
            normal_images.add(material["normalTexture"]["index"])
    texture_source = {}
    for i, texture in enumerate(gltf.get("textures", [])):
        source = texture.get("source", texture.get("extensions", {}).get("EXT_texture_webp", {}).get("source"))
        texture_source[i] = source
    normal_sources = {texture_source[i] for i in normal_images}
    for index, image in enumerate(gltf.get("images", [])):
        view = views[image["bufferView"]]
        raw = binary[view.get("byteOffset", 0):view.get("byteOffset", 0) + view["byteLength"]]
        if image.get("mimeType") == "image/webp":
            replaced[index] = raw
            continue
        picture = Image.open(BytesIO(raw))
        has_alpha = picture.mode in ("RGBA", "LA") or "transparency" in picture.info
        picture = picture.convert("RGBA" if has_alpha else "RGB")
        buffer = BytesIO()
        picture.save(buffer, "WEBP", quality=95 if index in normal_sources else quality, method=6)
        replaced[index] = buffer.getvalue()
        image["mimeType"] = "image/webp"
    image_views = {image["bufferView"]: i for i, image in enumerate(gltf.get("images", []))}
    out = bytearray()
    for vi, view in enumerate(views):
        chunk = replaced[image_views[vi]] if vi in image_views else \
            binary[view.get("byteOffset", 0):view.get("byteOffset", 0) + view["byteLength"]]
        out += b"\0" * (-len(out) % 4)
        view["byteOffset"] = len(out)
        view["byteLength"] = len(chunk)
        out += chunk
    gltf["buffers"][0]["byteLength"] = len(out)
    for i, texture in enumerate(gltf.get("textures", [])):
        source = texture_source[i]
        texture.pop("source", None)
        texture.setdefault("extensions", {})["EXT_texture_webp"] = {"source": source}
    for key in ("extensionsUsed", "extensionsRequired"):
        names = set(gltf.get(key, []))
        names.add("EXT_texture_webp")
        gltf[key] = sorted(names)
    write_glb(dst, gltf, bytes(out))
    before, after = len(binary), len(out)
    print(f"{len(replaced)} images; binary {before / 1e6:.1f} MB -> {after / 1e6:.1f} MB")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("src")
    parser.add_argument("dst")
    parser.add_argument("--quality", type=int, default=88)
    args = parser.parse_args()
    convert(args.src, args.dst, args.quality)
