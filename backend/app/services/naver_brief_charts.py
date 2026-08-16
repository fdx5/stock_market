"""Chart images for the Naver blog post, drawn to match the site's 오늘 브리핑 sheet.

The blog post carries the same numbers the web report does, and until now carried them
as plain text only. These renders give the post the site's visual language so a reader
landing from Naver search sees the same thing a reader on kospi-predictor.onrender.com
sees.

Design parameters are taken from frontend/src/components/marketBrief.css rather than
invented, so the two surfaces cannot drift apart:

    상승/양수   #d9424e (text) · #ef6b75 (fill)
    하락/음수   #3467bd (text) · #5c83d6 (fill)
    강조 네이비  #183b68
    본문/보조   #172b4d · #78869a
    구분선      #d8dee7 · #edf0f4

Red-up / blue-down is the Korean market convention and is the inverse of the western
default; it is a diverging polarity encoding, and the pair validates clean on a white
surface (adjacent ΔE 17.8 protan, 29.9 normal-vision — both above the floors).

Everything is direct-labelled. A PNG has no hover layer, so the tooltip that would
normally carry the value has to be printed on the mark itself.

Rendered at 2x and downsampled, because Naver serves blog images at the width the reader
sees and unscaled text goes soft on high-DPI screens.
"""

from __future__ import annotations

import math
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SCALE = 2
WIDTH = 700

BG = "#ffffff"
INK = "#172b4d"
INK_SOFT = "#4d5d73"
INK_MUTED = "#78869a"
NAVY = "#183b68"
RULE = "#d8dee7"
RULE_SOFT = "#edf0f4"
TRACK = "#eef1f5"

UP_TEXT = "#d9424e"
UP_FILL = "#ef6b75"
DOWN_TEXT = "#3467bd"
DOWN_FILL = "#5c83d6"
FLAT_FILL = "#c9d3df"

FONT_CANDIDATES_BOLD = (
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "C:/Windows/Fonts/malgunbd.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "C:/Windows/Fonts/malgun.ttf",
)
FONT_CANDIDATES_REGULAR = (
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "C:/Windows/Fonts/malgun.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "C:/Windows/Fonts/malgunbd.ttf",
)


def _font(size: int, bold: bool = False):
    for candidate in (FONT_CANDIDATES_BOLD if bold else FONT_CANDIDATES_REGULAR):
        if Path(candidate).is_file():
            try:
                return ImageFont.truetype(candidate, size=size * SCALE)
            except OSError:
                continue
    return ImageFont.load_default()


def _num(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _flow_label(value: float) -> str:
    """억원 in, 조원 past 10,000 — same rule as market_brief._flow_money so the chart and
    the body text never disagree about the same number."""
    sign = "+" if value > 0 else "-" if value < 0 else ""
    amount = abs(value)
    if amount >= 10_000:
        return f"{sign}{amount / 10_000:,.2f}조원"
    return f"{sign}{amount:,.0f}억원"


def _text(draw, xy, text, font, fill, anchor="la"):
    draw.text((xy[0] * SCALE, xy[1] * SCALE), text, font=font, fill=fill, anchor=anchor)


def _bar(draw, x, y, w, h, fill, radius=4):
    """Rounded data-end. Zero-width bars are skipped rather than drawn as a sliver."""
    if w < 1:
        return
    r = min(radius, h / 2, w / 2) * SCALE
    draw.rounded_rectangle(
        [x * SCALE, y * SCALE, (x + w) * SCALE, (y + h) * SCALE], radius=r, fill=fill
    )


def _finish(image: Image.Image) -> bytes:
    image = image.resize((image.width // SCALE, image.height // SCALE), Image.LANCZOS)
    buf = BytesIO()
    image.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _canvas(height: int) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGB", (WIDTH * SCALE, height * SCALE), BG)
    draw = ImageDraw.Draw(image)
    # The 6px navy cap is the site's .brief-sheet border-top.
    draw.rectangle([0, 0, WIDTH * SCALE, 5 * SCALE], fill=NAVY)
    return image, draw


def _header(draw, title: str, subtitle: str = "") -> None:
    _text(draw, (28, 24), title, _font(15, True), NAVY)
    if subtitle:
        _text(draw, (WIDTH - 28, 27), subtitle, _font(10), INK_MUTED, anchor="ra")
    draw.line(
        [28 * SCALE, 50 * SCALE, (WIDTH - 28) * SCALE, 50 * SCALE], fill=RULE, width=SCALE
    )


def render_summary(brief: dict, meta: dict) -> bytes:
    """Headline numbers + investor flows, and market breadth for index reports.

    The hero number is a stat tile, not a chart: one value with no comparison to plot.
    The flows underneath are a diverging bar set — magnitude plus sign, three categories.
    """
    is_stock = meta.get("type") == "stock"
    index = brief.get("index") or {}
    investor = brief.get("investor") or {}
    breadth = brief.get("breadth") or {}
    show_breadth = (not is_stock) and bool(breadth)

    height = 348 if show_breadth else 296
    image, draw = _canvas(height)
    _header(draw, meta.get("name", ""), brief.get("date", ""))

    close = _num(index.get("close"))
    change = _num(index.get("change"))
    pct = _num(index.get("change_pct"))
    positive = pct >= 0
    tone = UP_TEXT if positive else DOWN_TEXT

    _text(draw, (28, 66), "종가", _font(10), INK_MUTED)
    close_str = f"{close:,.0f}" if is_stock else f"{close:,.2f}"
    _text(draw, (28, 80), close_str, _font(34, True), INK)
    unit = "원" if is_stock else "pt"
    _text(draw, (28 + _w(close_str, 34, True) + 5, 100), unit, _font(12), INK_MUTED)

    change_str = f"{change:+,.0f}" if is_stock else f"{change:+,.2f}"
    _text(draw, (28, 126), f"{change_str}  ({pct:+.2f}%)", _font(15, True), tone)

    turnover = _num(brief.get("turnover_estimate"))
    _text(draw, (WIDTH - 28, 66), "추정 거래대금", _font(10), INK_MUTED, anchor="ra")
    _text(draw, (WIDTH - 28, 80), f"{turnover / 1e12:,.2f}조원", _font(19, True), INK, anchor="ra")

    # --- investor flows: diverging bars around a shared zero ---
    # 186, not 168: at the tighter spacing the section label sat on top of the
    # change line above it.
    top = 190
    _text(draw, (28, top - 26), "투자자별 순매수", _font(11, True), INK_SOFT)

    rows = [
        ("외국인", _num(investor.get("foreign_amount"))),
        ("기관", _num(investor.get("institution_amount"))),
        ("개인", _num(investor.get("individual_amount"))),
    ]
    peak = max((abs(v) for _, v in rows), default=0) or 1

    label_w = 52
    plot_x = 28 + label_w
    plot_w = (WIDTH - 56 - label_w - 96) if not show_breadth else (WIDTH - 56 - label_w - 96 - 150)
    zero_x = plot_x + plot_w / 2
    half = plot_w / 2

    draw.line(
        [zero_x * SCALE, (top - 6) * SCALE, zero_x * SCALE, (top + 3 * 30 + 2) * SCALE],
        fill=RULE, width=SCALE,
    )

    for i, (name, value) in enumerate(rows):
        y = top + i * 30
        _text(draw, (28, y + 5), name, _font(11), INK_SOFT)
        width = abs(value) / peak * (half - 6)
        if value >= 0:
            _bar(draw, zero_x, y, width, 14, UP_FILL)
            _text(draw, (zero_x + width + 7, y + 3), _flow_label(value), _font(10, True), UP_TEXT)
        else:
            _bar(draw, zero_x - width, y, width, 14, DOWN_FILL)
            _text(draw, (zero_x - width - 7, y + 3), _flow_label(value), _font(10, True), DOWN_TEXT, anchor="ra")

    if show_breadth:
        _donut(draw, brief, cx=WIDTH - 96, cy=top + 40, r=52)

    _text(
        draw, (28, height - 26),
        "kospi-predictor.onrender.com · 공개 시장 데이터 자동 집계",
        _font(9), INK_MUTED,
    )
    return _finish(image)


def _w(text: str, size: int, bold: bool = False) -> float:
    """Rendered width in layout (pre-downsample) pixels."""
    font = _font(size, bold)
    try:
        return font.getbbox(text)[2] / SCALE
    except Exception:
        return len(text) * size * 0.55


def _donut(draw, brief: dict, cx: int, cy: int, r: int) -> None:
    """Advance/decline breadth, mirroring the site's .breadth-donut.

    A part-to-whole with three slices where one slice is the headline — the site already
    made this call, and matching it matters more than swapping in a bar chart.
    """
    breadth = brief.get("breadth") or {}
    advance = _num(breadth.get("advance"))
    decline = _num(breadth.get("decline"))
    flat = _num(breadth.get("flat"))
    total = advance + decline + flat or 1

    box = [(cx - r) * SCALE, (cy - r) * SCALE, (cx + r) * SCALE, (cy + r) * SCALE]
    start = -90.0
    for value, color in ((advance, UP_FILL), (decline, DOWN_FILL), (flat, FLAT_FILL)):
        if value <= 0:
            continue
        sweep = value / total * 360.0
        draw.pieslice(box, start=start, end=start + sweep, fill=color)
        start += sweep

    inner = r - 17
    draw.ellipse(
        [(cx - inner) * SCALE, (cy - inner) * SCALE, (cx + inner) * SCALE, (cy + inner) * SCALE],
        fill=BG,
    )
    ratio = _num(breadth.get("advance_ratio"), advance / total * 100)
    _text(draw, (cx, cy - 12), f"{ratio:.1f}%", _font(17, True), INK, anchor="ma")
    _text(draw, (cx, cy + 7), "상승 비중", _font(9), INK_MUTED, anchor="ma")

    legend_y = cy + r + 10
    parts = [("상승", int(advance), UP_FILL), ("하락", int(decline), DOWN_FILL)]
    x = cx - 52
    for name, count, color in parts:
        _bar(draw, x, legend_y + 3, 8, 8, color, radius=2)
        _text(draw, (x + 12, legend_y), f"{name} {count}", _font(9), INK_MUTED)
        x += 56


def render_movers(brief: dict, meta: dict) -> bytes | None:
    """Turnover leaders, bar length by turnover, colour by the day's direction.

    Colour is polarity here, not identity — it answers "did this one go up", which is
    the question a reader has about a name they recognise. Length stays on turnover so
    the ranking the bars imply is the ranking the title claims.
    """
    active = [x for x in (brief.get("active") or []) if x.get("name")][:8]
    if not active:
        return None

    row_h = 30
    height = 88 + len(active) * row_h + 34
    image, draw = _canvas(height)
    _header(draw, "거래대금 상위 종목", brief.get("date", ""))

    def turnover_of(item) -> float:
        return _num(item.get("close")) * _num(item.get("volume"))

    peak = max((turnover_of(x) for x in active), default=0) or 1

    name_w = 118
    value_w = 116
    plot_x = 28 + name_w
    plot_w = WIDTH - 56 - name_w - value_w

    _text(draw, (28, 66), "종목", _font(9), INK_MUTED)
    _text(draw, (plot_x, 66), "거래대금", _font(9), INK_MUTED)
    _text(draw, (WIDTH - 28, 66), "등락률", _font(9), INK_MUTED, anchor="ra")

    for i, item in enumerate(active):
        y = 88 + i * row_h
        pct = _num(item.get("change_pct"))
        fill = UP_FILL if pct >= 0 else DOWN_FILL
        tone = UP_TEXT if pct >= 0 else DOWN_TEXT

        name = str(item.get("name", ""))
        while _w(name, 11) > name_w - 8 and len(name) > 3:
            name = name[:-1]
        _text(draw, (28, y + 3), name, _font(11), INK)

        turnover = turnover_of(item)
        _bar(draw, plot_x, y + 2, plot_w, 13, TRACK, radius=4)
        _bar(draw, plot_x, y + 2, turnover / peak * plot_w, 13, fill)
        _text(draw, (plot_x + plot_w + 8, y + 3), f"{turnover / 1e8:,.0f}억", _font(10), INK_SOFT)
        _text(draw, (WIDTH - 28, y + 3), f"{pct:+.2f}%", _font(11, True), tone, anchor="ra")

        if i < len(active) - 1:
            draw.line(
                [28 * SCALE, (y + 23) * SCALE, (WIDTH - 28) * SCALE, (y + 23) * SCALE],
                fill=RULE_SOFT, width=SCALE,
            )

    _text(draw, (28, height - 24), "막대 길이 = 거래대금 · 색 = 당일 등락 방향", _font(9), INK_MUTED)
    return _finish(image)


def render_sectors(brief: dict, meta: dict) -> bytes | None:
    """Sector performance, diverging around zero. Index reports only — a single stock's
    `sectors` block is a peer list, which render_movers already covers better."""
    if meta.get("type") == "stock":
        return None
    sectors = [s for s in (brief.get("sectors") or []) if s.get("name")][:8]
    if not sectors:
        return None

    row_h = 28
    height = 78 + len(sectors) * row_h + 30
    image, draw = _canvas(height)
    _header(draw, "업종별 등락률", brief.get("date", ""))

    peak = max((abs(_num(s.get("change_pct"))) for s in sectors), default=0) or 1
    label_w = 132
    plot_x = 28 + label_w
    plot_w = WIDTH - 56 - label_w - 68
    zero_x = plot_x + plot_w / 2
    half = plot_w / 2

    draw.line(
        [zero_x * SCALE, 70 * SCALE, zero_x * SCALE, (78 + len(sectors) * row_h) * SCALE],
        fill=RULE, width=SCALE,
    )

    for i, sector in enumerate(sectors):
        y = 78 + i * row_h
        pct = _num(sector.get("change_pct"))
        name = str(sector.get("name", ""))
        while _w(name, 11) > label_w - 10 and len(name) > 3:
            name = name[:-1]
        _text(draw, (28, y + 2), name, _font(11), INK)

        width = abs(pct) / peak * (half - 6)
        if pct >= 0:
            _bar(draw, zero_x, y, width, 13, UP_FILL)
        else:
            _bar(draw, zero_x - width, y, width, 13, DOWN_FILL)
        _text(
            draw, (WIDTH - 28, y + 1), f"{pct:+.2f}%", _font(11, True),
            UP_TEXT if pct >= 0 else DOWN_TEXT, anchor="ra",
        )

    _text(draw, (28, height - 22), "시가총액 가중 평균 등락률", _font(9), INK_MUTED)
    return _finish(image)


def render_all(brief: dict, meta: dict) -> list[tuple[str, bytes]]:
    """Every chart for one post, as (slug, png_bytes), in body order."""
    out: list[tuple[str, bytes]] = []
    market = str(brief.get("market", "post")).lower()
    date = str(brief.get("date", ""))

    for slug, fn in (("summary", render_summary), ("movers", render_movers), ("sectors", render_sectors)):
        try:
            data = fn(brief, meta)
        except Exception:
            continue
        if data:
            out.append((f"{date}_{market}_{slug}.png", data))
    return out
