"""Compose the /pulse-board share card (1200x630) from the pulse-sea capture and the ship render.

    python frontend/scripts/compose-pulse-board-card.py <sea.png> <ship.png>

Writes frontend/public/img/social/pulse-board-<hash>.png and prints its path. The artwork is the
page's own sea and the Blender ship with decorative placards: no logos, quotes or numbers.
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

sea = Image.open(sys.argv[1]).convert("RGBA").resize((W, H), Image.LANCZOS)
ship = Image.open(sys.argv[2]).convert("RGBA")
ship = ship.crop(ship.getchannel("A").getbbox())
scale = W * .74 / ship.width
ship = ship.resize((int(ship.width * scale), int(ship.height * scale)), Image.LANCZOS)
x, y = W - ship.width - 40, H - ship.height - 150

card = sea.copy()
# soft mood glow under the hull and a faint mirrored reflection on the sea
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((x - 60, y + ship.height - 90, x + ship.width + 60, y + ship.height + 110), fill=(190, 130, 255, 120))
card.alpha_composite(glow.filter(ImageFilter.GaussianBlur(60)))
mirror = ship.transpose(Image.FLIP_TOP_BOTTOM)
alpha = mirror.getchannel("A").point(lambda v: v * .18)
fade = Image.linear_gradient("L").resize(mirror.size).transpose(Image.FLIP_TOP_BOTTOM)
mirror.putalpha(Image.composite(alpha, Image.new("L", mirror.size, 0), fade))
card.alpha_composite(mirror.filter(ImageFilter.GaussianBlur(3)), (x, y + ship.height - 6))
card.alpha_composite(ship, (x, y))

# legibility veil behind the title, upper left
veil = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(veil).rectangle((0, 0, 1300, 560), fill=(11, 7, 16, 200))
card.alpha_composite(veil.filter(ImageFilter.GaussianBlur(120)))

draw = ImageDraw.Draw(card)
kicker = ImageFont.truetype(str(BOLD), 34)
title = ImageFont.truetype(str(BOLD), 150)
sub = ImageFont.truetype(str(REGULAR), 52)
brand = ImageFont.truetype(str(BOLD), 40)
draw.text((96, 92), "PULSE BOARD", font=kicker, fill=(206, 176, 255))
for radius, alpha in ((18, 70), (8, 120)):
    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(halo).text((90, 140), "증시 전광판", font=title, fill=(191, 133, 255, alpha))
    card.alpha_composite(halo.filter(ImageFilter.GaussianBlur(radius)))
draw.text((90, 140), "증시 전광판", font=title, fill=(250, 246, 255))
draw.text((96, 340), "코스피 · 코스닥 · 나스닥100 상위 종목이", font=sub, fill=(226, 214, 240))
draw.text((96, 410), "지수 흐름에 따라 물드는 펄스 바다 위로", font=sub, fill=(226, 214, 240))
draw.rounded_rectangle((96, 1110, 452, 1172), radius=31, fill=(191, 133, 255, 40), outline=(191, 133, 255, 160), width=2)
draw.text((126, 1118), "K STOCK HUB", font=brand, fill=(244, 236, 255))

final = card.convert("RGB").resize((1200, 630), Image.LANCZOS)
tmp = OUT / "pulse-board.tmp.png"
final.save(tmp, optimize=True)
digest = hashlib.sha1(tmp.read_bytes()).hexdigest()[:10]
target = OUT / f"pulse-board-{digest}.png"
tmp.replace(target)
print(target.relative_to(ROOT).as_posix())
