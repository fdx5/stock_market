"""Mobile-readable Open Graph cards for permanent market-close reports."""

from __future__ import annotations

from functools import lru_cache
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.services import market_brief_store

WIDTH, HEIGHT = 1200, 630
FONT_CANDIDATES = (
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "C:/Windows/Fonts/malgunbd.ttf",
    "C:/Windows/Fonts/malgun.ttf",
)


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = FONT_CANDIDATES if bold else tuple(reversed(FONT_CANDIDATES))
    for candidate in candidates:
        if Path(candidate).is_file():
            try:
                return ImageFont.truetype(candidate, size=size)
            except OSError:
                pass
    return ImageFont.load_default()


def _number(value: object, decimals: int = 2) -> str:
    try:
        return f"{float(value):,.{decimals}f}"
    except (TypeError, ValueError):
        return "-"


def _signed(value: object) -> str:
    try:
        number = float(value)
        return f"{number:+.2f}%"
    except (TypeError, ValueError):
        return "-"


def _flow(value: object) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "-"
    sign = "+" if number > 0 else "" if number == 0 else "−"
    amount = abs(number)
    if amount >= 10_000:
        return f"{sign}{amount / 10_000:.1f}조"
    return f"{sign}{amount:,.0f}억"


def _rounded_rectangle(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], fill: str, outline: str | None = None) -> None:
    draw.rounded_rectangle(box, radius=24, fill=fill, outline=outline, width=2 if outline else 1)


@lru_cache(maxsize=400)
def render(day: str, market: str) -> bytes | None:
    report = market_brief_store.get(day, market.upper())
    if not report:
        return None

    change = float(report.get("index", {}).get("change_pct") or 0)
    positive = change >= 0
    accent = "#ff667a" if positive else "#69a2ff"
    accent_dim = "#4d2637" if positive else "#243c63"

    image = Image.new("RGB", (WIDTH, HEIGHT), "#07101f")
    pixels = image.load()
    # Subtle deterministic gradient: compression-friendly and legible behind
    # small KakaoTalk previews, with no detailed texture competing with type.
    for y in range(HEIGHT):
        for x in range(WIDTH):
            glow = max(0.0, 1.0 - (((x - 1040) / 720) ** 2 + ((y - 40) / 500) ** 2))
            band = max(0.0, 1.0 - abs(y - 300) / 520)
            pixels[x, y] = (
                int(7 + glow * (36 if positive else 18) + band * 3),
                int(16 + glow * (10 if positive else 31) + band * 4),
                int(31 + glow * (20 if positive else 58) + band * 7),
            )

    draw = ImageDraw.Draw(image)
    f_brand = _font(25, True)
    f_date = _font(27, False)
    f_market = _font(54, True)
    f_index = _font(72, True)
    f_change = _font(48, True)
    f_label = _font(22, False)
    f_metric = _font(31, True)
    f_sector = _font(24, True)

    # 64px outer safe area survives common messenger thumbnail crops.
    draw.ellipse((66, 57, 84, 75), fill=accent)
    draw.text((98, 51), "K-STOCK HUB  ·  CLOSE REPORT", font=f_brand, fill="#dce9fb")
    draw.text((1135, 53), day, font=f_date, fill="#91a7c2", anchor="ra")

    draw.text((66, 123), market.upper(), font=f_market, fill="#ffffff")
    draw.text((66, 190), "장 마감 데이터 브리핑", font=f_date, fill="#a9bbcf")

    index = report.get("index", {})
    draw.text((66, 254), _number(index.get("close")), font=f_index, fill="#ffffff")
    change_text = _signed(index.get("change_pct"))
    change_width = draw.textbbox((0, 0), change_text, font=f_change)[2]
    _rounded_rectangle(draw, (1130 - change_width - 42, 269, 1150, 334), accent_dim, accent)
    draw.text((1129, 278), change_text, font=f_change, fill=accent, anchor="ra")

    breadth = report.get("breadth", {})
    investor = report.get("investor", {})
    sectors = report.get("sectors") or []
    top_sector = sectors[0] if sectors else {}
    cards = (
        ("상승 종목 비중", f"{float(breadth.get('advance_ratio') or 0):.1f}%"),
        ("외국인 순매수", _flow(investor.get("foreign_amount"))),
        ("기관 순매수", _flow(investor.get("institution_amount"))),
    )
    card_y = 384
    card_w = 335
    for i, (label, value) in enumerate(cards):
        left = 66 + i * 359
        _rounded_rectangle(draw, (left, card_y, left + card_w, card_y + 126), "#101d31", "#253b57")
        draw.text((left + 22, card_y + 19), label, font=f_label, fill="#8fa6c0")
        draw.text((left + 22, card_y + 59), value, font=f_metric, fill="#f4f8ff")

    sector_name = str(top_sector.get("name") or "시장 데이터 분석")[:16]
    sector_change = _signed(top_sector.get("change_pct")) if top_sector else ""
    draw.text((66, 551), "강세 업종", font=f_label, fill="#8096b1")
    draw.text((185, 547), f"{sector_name}  {sector_change}", font=f_sector, fill="#d9e7f8")
    draw.text((1135, 551), "kospi-predictor.onrender.com", font=f_label, fill="#7188a5", anchor="ra")

    output = BytesIO()
    image.save(output, "PNG", optimize=True)
    return output.getvalue()
