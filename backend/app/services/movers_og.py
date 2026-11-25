"""1200x630 share image for a 급등·급락 이유 edition, drawn from the stored edition."""
from __future__ import annotations

import io
import threading

from PIL import Image, ImageChops, ImageDraw, ImageFilter

from app.services.hot_issues_og import _wrap
from app.services.market_brief_og import _font

W, H = 1200, 630
S = 2  # drawn at 2x and downsampled: smooth rounded corners, circles and text edges
BG, INK, SUB, LINE = (7, 9, 18), (244, 246, 255), (156, 164, 192), (52, 46, 78)
UP, DOWN, CYAN, GOLD = (255, 72, 102), (72, 152, 255), (0, 230, 255), (255, 209, 102)
_cache: dict[str, bytes] = {}
_lock = threading.Lock()


def _mix(color, other, amount):
    return tuple(int(c * amount + o * (1 - amount)) for c, o in zip(color, other))


def _glow(img, box, color, radius):
    layer = Image.new("RGB", img.size, (0, 0, 0))
    ImageDraw.Draw(layer).ellipse(box, fill=color)
    layer = layer.filter(ImageFilter.GaussianBlur(radius))
    return ImageChops.add(img, layer)


def _background():
    img = Image.new("RGB", (W * S, H * S), BG)
    d = ImageDraw.Draw(img)
    for x in range(0, W * S, 48 * S):
        d.line((x, 0, x, H * S), fill=(13, 15, 28), width=S)
    for y in range(0, H * S, 48 * S):
        d.line((0, y, W * S, y), fill=(13, 15, 28), width=S)
    img = _glow(img, (-260 * S, -300 * S, 520 * S, 330 * S), (70, 14, 30), 90 * S)
    img = _glow(img, (760 * S, 330 * S, 1500 * S, 900 * S), (12, 34, 78), 100 * S)
    return img


def _pill(d, xy, text, font, fg, bg, outline, dot=None):
    x, y = xy
    w = d.textlength(text, font=font)
    h = font.size + 18 * S
    lead = 26 * S if dot else 0
    d.rounded_rectangle((x, y, x + w + 30 * S + lead, y + h), radius=h // 2, fill=bg, outline=outline, width=2 * S)
    if dot:
        cx, cy, r = x + 15 * S + 6 * S, y + h / 2, 6 * S
        d.ellipse((cx - r - 4 * S, cy - r - 4 * S, cx + r + 4 * S, cy + r + 4 * S), fill=_mix(dot, bg, 0.35))
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=dot)
    d.text((x + 15 * S + lead, y + h / 2), text, font=font, fill=fg, anchor="lm")
    return x + w + 30 * S + lead

def _fit(d, text, font_size, width, bold=True):
    size = font_size
    while size > 12 * S and d.textlength(text, font=_font(size, bold)) > width:
        size -= S
    return _font(size, bold)


def _column(d, box, title, stocks, tone, peak):
    x0, y0, x1, y1 = box
    d.rounded_rectangle(box, radius=18 * S, fill=_mix(tone, BG, 0.07), outline=_mix(tone, BG, 0.45), width=2 * S)
    d.rounded_rectangle((x0, y0 + 22 * S, x0 + 5 * S, y0 + 62 * S), radius=3 * S, fill=tone)
    d.text((x0 + 24 * S, y0 + 42 * S), title, font=_font(22 * S, True), fill=tone, anchor="lm")
    if not stocks:
        d.text((x0 + 24 * S, y0 + 110 * S), "해당 종목 없음", font=_font(22 * S), fill=SUB, anchor="lm")
        return
    row_h = (y1 - y0 - 78 * S) / len(stocks)
    for i, s in enumerate(stocks):
        top = y0 + 74 * S + i * row_h
        mid = top + row_h * 0.38
        pct = f"{s['change_pct']:+.2f}%"
        pct_font = _font(30 * S, True)
        pct_w = d.textlength(pct, font=pct_font)
        d.text((x1 - 22 * S, mid), pct, font=pct_font, fill=tone, anchor="rm")
        room = x1 - x0 - 48 * S - pct_w - 24 * S
        name_font = _fit(d, s["name"], 27 * S, room)
        d.text((x0 + 24 * S, mid), s["name"], font=name_font, fill=INK, anchor="lm")
        theme = s.get("theme") or ""
        theme_x = x0 + 24 * S + d.textlength(s["name"], font=name_font) + 12 * S
        theme_font = _font(17 * S)
        while theme and theme_x + d.textlength(theme, font=theme_font) > x0 + 24 * S + room:
            theme = theme[:-1]
        if theme and len(theme) < len(s.get("theme") or ""):
            theme = theme[:-1] + "…" if len(theme) > 1 else ""
        if theme:
            d.text((theme_x, mid + 2 * S), theme, font=theme_font, fill=SUB, anchor="lm")
        bar_y = top + row_h * 0.74
        bar_w = (x1 - x0 - 48 * S)
        d.rounded_rectangle((x0 + 24 * S, bar_y, x0 + 24 * S + bar_w, bar_y + 6 * S), radius=3 * S, fill=_mix(tone, BG, 0.14))
        fill_w = max(10 * S, bar_w * min(1.0, abs(s["change_pct"]) / max(peak, 0.01)))
        d.rounded_rectangle((x0 + 24 * S, bar_y, x0 + 24 * S + fill_w, bar_y + 6 * S), radius=3 * S, fill=tone)

def render(data: dict | None, market: str = "kr") -> bytes:
    cache_key = f"{market}:{data['slot']}" if data else f"{market}:empty"
    with _lock:
        if cache_key in _cache:
            return _cache[cache_key]
    us = market == "us"
    img = _background()
    d = ImageDraw.Draw(img)
    M = 52 * S
    right = _pill(d, (M, 36 * S), "나스닥100 급등·급락의 이유" if us else "오늘의 급등·급락의 이유",
                  _font(22 * S, True), (255, 228, 232), _mix(UP, BG, 0.2), _mix(UP, BG, 0.7), dot=UP)
    if not data or not data.get("stocks"):
        d.text((M, 250 * S), "왜 올랐고, 왜 떨어졌나", font=_font(64 * S, True), fill=INK, anchor="lm")
        d.text((M, 330 * S), "급등·급락 종목의 이유를 한 장에", font=_font(34 * S, True), fill=SUB, anchor="lm")
        d.text((M, 400 * S), "21:00 · 00:40 · 06:40 업데이트" if us else "평일 09:20 · 12:30 · 16:00 업데이트",
               font=_font(28 * S, True), fill=GOLD, anchor="lm")
    else:
        stamp = f"{data['edition'].replace('-', '.')} {data['slot_label']} {data['slot_name']}"
        stamp_font = _font(21 * S, True)
        sw = d.textlength(stamp, font=stamp_font)
        if W * S - M - sw - 30 * S > right + 16 * S:
            _pill(d, (W * S - M - sw - 30 * S, 36 * S), stamp, stamp_font, GOLD, (20, 18, 30), (92, 80, 50))
        y = 104 * S
        head_font = _font(48 * S, True)
        lines = _wrap(d, data["headline"], head_font, W * S - 2 * M, 2)
        for line in lines:
            d.text((M, y), line, font=head_font, fill=INK)
            y += 62 * S
        top = max(y + 22 * S, 210 * S)
        ups = [s for s in data["stocks"] if s["direction"] == "up"][:4]
        downs = [s for s in data["stocks"] if s["direction"] == "down"][:4]
        peak = max([abs(s["change_pct"]) for s in ups + downs] or [1])
        gap = 22 * S
        col_w = (W * S - 2 * M - gap) // 2
        bottom = H * S - 74 * S
        _column(d, (M, top, M + col_w, bottom), "▲ 급등", ups, UP, peak)
        _column(d, (M + col_w + gap, top, W * S - M, bottom), "▼ 급락", downs, DOWN, peak)
    foot = H * S - 38 * S
    d.text((M, foot), "KOSPIMAP", font=_font(24 * S, True), fill=INK, anchor="lm")
    d.text((M + d.textlength("KOSPIMAP", font=_font(24 * S, True)) + 16 * S, foot),
           "kospimap.com/movers" + ("/us" if us else ""), font=_font(22 * S, True), fill=CYAN, anchor="lm")
    d.text((W * S - M, foot), "시세·공시·뉴스로 짚은 등락 이유", font=_font(19 * S), fill=SUB, anchor="rm")
    img = img.resize((W, H), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, "PNG", optimize=True)
    value = out.getvalue()
    with _lock:
        _cache[cache_key] = value
        if len(_cache) > 60:
            _cache.pop(next(iter(_cache)))
    return value
