"""GPU-compressed copies of the plant atlas: public/3d/plants.bc7.gz and plants.etc2.gz.

  python frontend/scripts/plants-bc7.py        (after every change to plants.webp)

BC7 (8 bits a texel instead of 32): the WebGPU view keeps the atlas in a quarter of the
memory (35 MB -> 9 MB with mips) where the GPU reads BC textures (desktops); elsewhere
plants.webp is used as before. The same levels as ETC2 RGBA (plants.etc2.gz) for the GPUs
of phones and tablets (texture-compression-etc2), which read no BC: the same quarter of the
memory instead of the full RGBA (43 MB with mips) — what KTX2 / Basis would transcode to there. Every mip level is made here from the full-size texels,
the same 2x2 box filter the renderer would use, then encoded. Blocks that are fully
transparent and at least a block away from anything visible are cleared to one value
(no filtering reaches them), so the gzipped file stays small.

File: 'BC7A', u32 header length, JSON header { width, height, flipY, levels: [[w, h, offset, length]] },
then the levels' blocks. Rows run bottom-up (flipY), as the renderer uploads plants.webp.
"""
import gzip
import json
import struct
from pathlib import Path

import etcpak
import texture2ddecoder
import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[1] / 'public' / '3d'
img = np.asarray(Image.open(root / 'plants.webp').convert('RGBA'))[::-1].astype(np.float32)  # flipY

levels = [img]
while max(levels[-1].shape[:2]) > 1:
    a = levels[-1]
    h, w = a.shape[:2]
    h2, w2 = max(1, h // 2), max(1, w // 2)
    a = a[: h2 * 2 if h > 1 else 1, : w2 * 2 if w > 1 else 1]
    if h > 1: a = (a[0::2] + a[1::2]) / 2
    if w > 1: a = (a[:, 0::2] + a[:, 1::2]) / 2
    levels.append(a)


def encode(a):
    h, w = a.shape[:2]
    H, W = -(-h // 4) * 4, -(-w // 4) * 4
    px = np.pad(np.clip(np.round(a), 0, 255).astype(np.uint8), ((0, H - h), (0, W - w), (0, 0)), mode='edge')
    # Blocks with nothing visible in them or their 8 neighbours: one constant value.
    vis = (px[..., 3] > 0).reshape(H // 4, 4, W // 4, 4).any(axis=(1, 3))
    near = vis.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            near |= np.roll(np.roll(vis, dy, 0), dx, 1)
    blank = np.repeat(np.repeat(~near, 4, 0), 4, 1)
    px[blank] = 0
    # (the decoder used to check below gives BGRA)
    return etcpak.compress_bc7(np.ascontiguousarray(px).tobytes(), W, H), px  # RGBA in


def encode_etc2(px):
    H, W = px.shape[:2]
    return etcpak.compress_etc2_rgba(np.ascontiguousarray(px).tobytes(), W, H)


data, header, errs = bytearray(), [], []
etc, etc_header = bytearray(), []
for a in levels:
    h, w = a.shape[:2]
    blocks, px = encode(a)
    header.append([w, h, len(data), len(blocks)])
    data += blocks
    e = encode_etc2(px)
    etc_header.append([w, h, len(etc), len(e)])
    etc += e
    if w >= 64:
        H, W = px.shape[:2]
        back = np.frombuffer(texture2ddecoder.decode_bc7(blocks, W, H), np.uint8).reshape(H, W, 4)[..., [2, 1, 0, 3]]
        ref = px.astype(np.float32)
        vis = ref[..., 3] > 127
        rgb = ((back[..., :3].astype(np.float32) - ref[..., :3]) ** 2)[vis].mean()
        cut = ((back[..., 3] > 127) != vis).mean()
        errs.append(f'{w}px: colour PSNR {10 * np.log10(255 ** 2 / max(rgb, 1e-9)):.1f} dB on visible texels, alpha-test mismatch {cut * 100:.3f}%')

head = json.dumps({'width': img.shape[1], 'height': img.shape[0], 'flipY': True, 'levels': header}).encode()
raw = b'BC7A' + struct.pack('<I', len(head)) + head + bytes(data)
(root / 'plants.bc7.gz').write_bytes(gzip.compress(raw, 9))
head = json.dumps({'width': img.shape[1], 'height': img.shape[0], 'flipY': True, 'levels': etc_header}).encode()
raw_etc = b'ETC2' + struct.pack('<I', len(head)) + head + bytes(etc)
(root / 'plants.etc2.gz').write_bytes(gzip.compress(raw_etc, 9))
print(f'ETC2: {len(raw_etc) / 1e6:.2f} MB raw, {(root / "plants.etc2.gz").stat().st_size / 1e6:.2f} MB gzipped')
print('\n'.join(errs))
print(f'{len(raw) / 1e6:.2f} MB raw, {(root / "plants.bc7.gz").stat().st_size / 1e6:.2f} MB gzipped, {len(header)} levels')
