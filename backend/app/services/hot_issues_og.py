"""1200x630 share image for 오늘의 핫이슈: the edition's own headline and top issues.

Drawn on the server from the stored edition (no screenshot, no third-party photo),
so a shared link always previews the edition it points to. One PNG per edition
is kept in memory; editions never change once written.
"""
from __future__ import annotations

import io
import threading

from PIL import Image, ImageDraw

from app.services import hot_issues as hi
from app.services.market_brief_og import _font

W, H = 1200, 630
BG, INK, SUB, LINE = "#0d0811", "#f6f0f8", "#b8a8c4", "#3a2a44"
IMPACT = {"호재": "#ff5f6d", "악재": "#3f86f0", "혼재": "#9b6ad8", "중립": "#6e6378"}
_cache: dict[str, bytes] = {}
_lock = threading.Lock()


def _wrap(draw: ImageDraw.ImageDraw, text: str, font, width: int, lines: int) -> list[str]:
    """Break at spaces (Korean reads badly split mid-word); a single over-long word breaks by character."""
    out, current = [], ""
    words = text.split()
    i = 0
    while i < len(words) and len(out) < lines:
        word = words[i]
        trial = f"{current} {word}".strip()
        if draw.textlength(trial, font=font) <= width:
            current, i = trial, i + 1
        elif current:
            out.append(current)
            current = ""
        else:  # one word wider than the line
            cut = word
            while cut and draw.textlength(cut, font=font) > width:
                cut = cut[:-1]
            out.append(cut)
            words[i] = word[len(cut):]
    if current and len(out) < lines:
        out.append(current)
        current = ""
    if i < len(words) or current:
        last = out[-1]
        while last and draw.textlength(last + "…", font=font) > width:
            last = last[:-1]
        out[-1] = last.rstrip() + "…"
    return out


def _background() -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    glow = Image.new("RGB", (W, H), BG)
    g = ImageDraw.Draw(glow)
    for i in range(36):  # soft red / violet corner glows
        r = 520 - i * 12
        a = int(3 + i * 0.9)
        g.ellipse((-260 - r // 3, -300 - r // 3, -260 + r, -300 + r), fill=(13 + a * 2, 8 + a // 3, 17 + a // 2))
        g.ellipse((W - r + 200, -360, W + 200 + r // 3, -360 + r + r // 3), fill=(13 + a, 8 + a // 2, 17 + a * 2))
    img = Image.blend(img, glow, 0.85)
    d = ImageDraw.Draw(img)
    for x in range(0, W, 40):  # faint terminal grid
        d.line((x, 0, x, H), fill="#140d18")
    for y in range(0, H, 40):
        d.line((0, y, W, y), fill="#140d18")
    for x in range(W):  # bottom signature line: red → violet → blue
        t = x / W
        col = (int(255 * (1 - t) + 79 * t), int(95 * (1 - t) + 155 * t), int(109 * (1 - t) + 255 * t))
        d.line((x, H - 8, x, H), fill=col)
    return img


def render(edition: dict | None) -> bytes:
    key = (edition or {}).get("slot") or "generic"
    with _lock:
        if key in _cache:
            return _cache[key]
    img = _background()
    d = ImageDraw.Draw(img)
    x = 64
    d.ellipse((x, 58, x + 16, 74), fill="#ff5f6d")
    d.text((x + 28, 52), "TODAY'S HOT ISSUES", font=_font(24, True), fill="#ffb3bb")
    if edition and edition.get("stories"):
        stamp = f'{edition["edition"].replace("-", ".")}  {edition["slot_label"]}판'
        d.text((W - 64 - d.textlength(stamp, font=_font(26, True)), 50), stamp, font=_font(26, True), fill=INK)
        title_font = _font(60, True)
        y = 112
        for line in _wrap(d, edition["headline"], title_font, W - 128, 2):
            d.text((x, y), line, font=title_font, fill=INK)
            y += 78
        y = max(y + 18, 290)
        badge_font, item_font = _font(22, True), _font(30, True)
        for story in edition["stories"][:3]:
            impact = story.get("impact", "중립")
            bw = int(d.textlength(impact, font=badge_font)) + 26
            d.rounded_rectangle((x, y + 4, x + bw, y + 40), radius=8, fill=IMPACT.get(impact, IMPACT["중립"]))
            d.text((x + 13, y + 7), impact, font=badge_font, fill="#ffffff")
            line = _wrap(d, story["title"], item_font, W - 128 - bw - 20, 1)[0]
            d.text((x + bw + 18, y + 2), line, font=item_font, fill="#e8dff0")
            y += 66
        more = len(edition["stories"]) - 3
        footer = f"외 {more}건 · 호재·악재 한 장 정리" if more > 0 else "호재·악재 한 장 정리"
    else:
        title_font = _font(64, True)
        d.text((x, 150), "오늘의 핫이슈", font=title_font, fill=INK)
        d.text((x, 250), "국내·해외 증시를 움직인 이슈를 매일 두 번 한 장에", font=_font(34, True), fill="#e8dff0")
        footer = "매일 07:00 · 22:00 갱신"
    d.text((x, H - 70), footer, font=_font(24), fill=SUB)
    brand = "KOSPIMAP  ·  kospimap.com/hot-issues"
    d.text((W - 64 - d.textlength(brand, font=_font(24, True)), H - 70), brand, font=_font(24, True), fill="#d9bfff")
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    data = buf.getvalue()
    with _lock:
        if len(_cache) > 20:
            _cache.clear()
        _cache[key] = data
    return data


def image_path(edition: dict | None) -> str:
    if edition and edition.get("stories"):
        return f'/hot-issues/og/{edition["edition"]}/{edition["slot_label"].replace(":", "")}.png'
    return "/hot-issues/og/latest.png"
