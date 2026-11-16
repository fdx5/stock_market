"""Compose the /pulse-board share card (1200x630) from a capture of the page's deep-dive scene.

    python frontend/scripts/compose-pulse-board-deep-card.py <scene.png> [crop_x]

<scene.png> is the scene rendered wide (e.g. 4000x1260: the diver under the ring tunnel), cropped
to 2400x1260 from crop_x so the figure sits on the right third and the title has the dark left.
Writes frontend/public/img/social/pulse-board-<hash>.png and prints its path. Only the page's own
artwork and words: no logos, quotes or numbers.
"""
import hashlib
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend/public/img/social"
BOLD = Path(os.getenv("SOCIAL_BOLD_FONT", "C:/Windows/Fonts/malgunbd.ttf"))
REGULAR = Path(os.getenv("SOCIAL_FONT", "C:/Windows/Fonts/malgun.ttf"))
W, H = 2400, 1260
GLOW = (110, 180, 255)

scene = Image.open(sys.argv[1]).convert("RGBA")
cx = int(sys.argv[2]) if len(sys.argv) > 2 else max(0, (scene.width - W) // 2)
scale = H / scene.height
if scale != 1:
    scene = scene.resize((int(scene.width * scale), H), Image.LANCZOS)
card = scene.crop((cx, 0, cx + W, H))

# a veil on the left for the title, fading out toward the figure
veil = Image.new("L", (W, H), 0)
ImageDraw.Draw(veil).rectangle((0, 0, 1250, H), fill=215)
veil = veil.filter(ImageFilter.GaussianBlur(170))
card.alpha_composite(Image.merge("RGBA", (*Image.new("RGB", (W, H), (2, 4, 12)).split(), veil)))

draw = ImageDraw.Draw(card)
kicker = ImageFont.truetype(str(BOLD), 36)
title = ImageFont.truetype(str(BOLD), 156)
sub = ImageFont.truetype(str(REGULAR), 50)
brand = ImageFont.truetype(str(BOLD), 40)
draw.text((100, 300), "PULSE BOARD · DEEP DIVE", font=kicker, fill=(150, 205, 255))
for radius, alpha in ((22, 80), (9, 130)):
    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(halo).text((92, 350), "증시 전광판", font=title, fill=(*GLOW, alpha))
    card.alpha_composite(halo.filter(ImageFilter.GaussianBlur(radius)))
draw = ImageDraw.Draw(card)
draw.text((92, 350), "증시 전광판", font=title, fill=(244, 249, 255))
draw.text((100, 570), "코스피 · 코스닥 · 나스닥100 상위 종목과", font=sub, fill=(205, 222, 242))
draw.text((100, 640), "음악에 맞춰 흐르는 빛의 끝없는 다이브", font=sub, fill=(205, 222, 242))
# a thin rule of light under the words
rule = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(rule).rectangle((100, 760, 620, 764), fill=(*GLOW, 220))
card.alpha_composite(rule.filter(ImageFilter.GaussianBlur(3)))
card.alpha_composite(rule)
chip = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(chip).rounded_rectangle((100, 1110, 456, 1172), radius=31, fill=(*GLOW, 36), outline=(*GLOW, 170), width=2)
card.alpha_composite(chip)
draw = ImageDraw.Draw(card)
draw.text((130, 1118), "K STOCK HUB", font=brand, fill=(236, 244, 255))

final = card.convert("RGB").resize((1200, 630), Image.LANCZOS)
data = final.tobytes()
digest = hashlib.sha1(data).hexdigest()[:10]
OUT.mkdir(parents=True, exist_ok=True)
path = OUT / f"pulse-board-{digest}.png"
final.save(path, optimize=True)
print(path.relative_to(ROOT).as_posix())
