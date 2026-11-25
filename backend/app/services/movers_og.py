"""1200x630 share image for a 급등·급락 이유 edition, drawn from the stored edition."""
from __future__ import annotations

import io
import threading

from PIL import Image, ImageDraw

from app.services.hot_issues_og import _wrap
from app.services.market_brief_og import _font

W, H = 1200, 630
BG, INK, SUB, LINE = (7, 10, 20), (240, 244, 255), (150, 162, 190), (34, 44, 70)
UP, DOWN, CYAN = (255, 70, 100), (70, 150, 255), (0, 230, 255)
_cache: dict[str, bytes] = {}
_lock = threading.Lock()


def render(data: dict | None) -> bytes:
    cache_key = f"{data['slot']}" if data else "empty"
    with _lock:
        if cache_key in _cache:
            return _cache[cache_key]
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    for x in range(0, W, 40):
        d.line((x, 0, x, H), fill=(12, 18, 32))
    for y in range(0, H, 40):
        d.line((0, y, W, y), fill=(12, 18, 32))
    d.text((48, 38), "오늘의 급등·급락 이유", font=_font(26, True), fill=CYAN)
    if not data or not data.get("stocks"):
        d.text((48, 260), "평일 09:20 · 12:30 · 16:00 업데이트", font=_font(44, True), fill=INK)
    else:
        d.text((W - 48, 40), f"{data['edition'].replace('-', '.')} {data['slot_label']} {data['slot_name']}",
               font=_font(24, True), fill=SUB, anchor="ra")
        y = 92
        for line in _wrap(d, data["headline"], _font(50, True), W - 96, 2):
            d.text((48, y), line, font=_font(50, True), fill=INK)
            y += 64
        y = max(y + 18, 240)
        ups = [s for s in data["stocks"] if s["direction"] == "up"][:4]
        downs = [s for s in data["stocks"] if s["direction"] == "down"][:2]
        rows = ups + downs
        row_h = min(62, (H - 60 - y) // max(1, len(rows)))
        for s in rows:
            tone = UP if s["direction"] == "up" else DOWN
            d.rounded_rectangle((48, y, W - 48, y + row_h - 10), radius=10, fill=tuple(int(c * 0.18 + b * 0.82) for c, b in zip(tone, BG)), outline=LINE)
            d.text((70, y + (row_h - 10) // 2), s["name"], font=_font(28, True), fill=INK, anchor="lm")
            tag = s.get("theme") or ""
            if tag:
                d.text((380, y + (row_h - 10) // 2), tag, font=_font(22), fill=SUB, anchor="lm")
            d.text((W - 70, y + (row_h - 10) // 2), f"{s['change_pct']:+.2f}%", font=_font(32, True), fill=tone, anchor="rm")
            y += row_h
    d.text((48, H - 34), "kospimap.com/movers", font=_font(22, True), fill=CYAN, anchor="lm")
    out = io.BytesIO()
    img.save(out, "PNG", optimize=True)
    value = out.getvalue()
    with _lock:
        _cache[cache_key] = value
        if len(_cache) > 60:
            _cache.pop(next(iter(_cache)))
    return value
