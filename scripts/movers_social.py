"""급등·급락 이유 posts (09:30 / 12:40 / 16:15 KST trading days) for X, Threads and Bluesky.

Each post carries a screenshot of the edition's page (the ?shot=1 card) and links
back with utm_campaign=<edition>-<YYYYMMDD>, so the site can count each post's visits
and the next edition's writer can learn which openings and hashtags worked.
"""

import datetime as dt
import io
import json
import re
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from PIL import Image

SITE = "https://kospimap.com"
EDITIONS = {"movers_open": "0920", "movers_noon": "1230", "movers_close": "1600",
            "us_movers_pre": "2230", "us_movers_open": "0040", "us_movers_close": "0640"}
POST_AT = {"movers_open": (9, 30), "movers_noon": (12, 40), "movers_close": (16, 15),
           "us_movers_pre": (22, 40), "us_movers_open": (0, 50), "us_movers_close": (6, 50)}
NAMES = {"movers_open": "장 초반", "movers_noon": "점심", "movers_close": "장 마감",
         "us_movers_pre": "프리마켓", "us_movers_open": "개장 직후", "us_movers_close": "마감"}
BASE_TAGS_BY = {"kr": ("#급등주", "#특징주", "#주식"), "us": ("#미국주식", "#나스닥", "#해외주식")}


def market(edition):
    return "us" if edition.startswith("us_") else "kr"


def base(edition):
    return "/movers/us" if market(edition) == "us" else "/movers"


def headline(day, edition):
    return f"{day:%m/%d} {'나스닥100 ' if market(edition) == 'us' else ''}{NAMES[edition]} 급등·급락 이유"


def link(service, day, edition):
    slot = EDITIONS[edition]
    params = urlencode({"utm_source": "x" if service == "twitter" else service, "utm_medium": "social",
                        "utm_campaign": f"{edition}-{day:%Y%m%d}"})
    return f"{SITE}{base(edition)}/{day}/{slot}?{params}"


def _edition(day, edition):
    slot = EDITIONS[edition]
    req = Request(f"{SITE}/api{base(edition)}/{day}/{slot}", headers={"User-Agent": "KOSPIMAP-SocialPublisher/1"})
    try:
        with urlopen(req, timeout=30) as response:
            return json.loads(response.read())
    except HTTPError as error:
        if error.code == 404:
            raise RuntimeError("Today's movers edition is not published yet") from None
        raise


def screenshot(day, edition):
    from playwright.sync_api import sync_playwright

    url = f"{SITE}{base(edition)}/{day}/{EDITIONS[edition]}?shot=1"
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 640, "height": 2200}, device_scale_factor=2,
                                locale="ko-KR", timezone_id="Asia/Seoul", reduced_motion="reduce")
        page.goto(url, wait_until="networkidle", timeout=90000)
        page.locator("#mv-capture .mv-board").wait_for(timeout=60000)
        # Site chrome pinned to the viewport (tab bar, players) is not part of the card.
        page.evaluate("""() => { for (const el of document.querySelectorAll('body *')) {
          if (getComputedStyle(el).position === 'fixed' && !el.closest('#mv-capture')) el.style.display = 'none'; } }""")
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(1200)
        png = page.locator("#mv-capture").screenshot()
        browser.close()
    with Image.open(io.BytesIO(png)) as image:
        image.load()
        if image.width < 1000 or image.height < 1000:
            raise RuntimeError("Movers screenshot is unexpectedly small")
        out = io.BytesIO()
        image.convert("RGB").save(out, "PNG", optimize=True)
        if out.tell() > 975_000:
            out = io.BytesIO()
            image.convert("RGB").quantize(colors=256, dither=Image.Dither.NONE).save(out, "PNG", optimize=True)
        if out.tell() > 975_000:
            raise RuntimeError("Movers screenshot exceeds the image size budget")
        return out.getvalue()


def _pct(v):
    return f"{v:+.2f}%"


def _tag(value):
    word = re.sub(r"[^0-9A-Za-z가-힣]", "", str(value or ""))
    return f"#{word}" if 2 <= len(word) <= 20 and any(c.isalpha() for c in word) else ""


def captions(day, edition, data, fits):
    first = headline(day, edition)
    BASE_TAGS = BASE_TAGS_BY[market(edition)]
    hook = " ".join(str(data.get("social_hook") or data["headline"]).split())
    ups = [s for s in data["stocks"] if s["direction"] == "up"]
    downs = [s for s in data["stocks"] if s["direction"] == "down"]
    dynamic = []
    for value in [*(data.get("hashtags") or []), *(t["name"] for t in data.get("themes") or []), *(s["name"] for s in ups[:2])]:
        tag = _tag(value)
        if tag and tag not in dynamic and tag not in BASE_TAGS:
            dynamic.append(tag)
    out = {}

    # Names people recognise draw the click: lead with the most-traded of the top gainers.
    # On a day led by the fallers, the lines follow the story.
    lead = downs if downs and (not ups or abs(downs[0]["change_pct"]) > ups[0]["change_pct"]) else ups
    known = sorted(lead[:6], key=lambda s: -s.get("turnover_100m", 0))

    def short(s):
        return f"{s['name']} {_pct(s['change_pct'])}"

    for n_tags in (3, 2, 1):
        tags = " ".join([*BASE_TAGS[:2], *dynamic[:n_tags]])
        for count in (3, 2, 1):
            text = f"{first}\n{hook}\n{' · '.join(short(s) for s in known[:count])}\n종목별 이유 {link('twitter', day, edition)}\n{tags}"
            if fits("twitter", text):
                out["twitter"] = text
                break
        if "twitter" in out:
            break

    def row(s):
        return f"{'▲' if s['direction'] == 'up' else '▼'} {s['name']} {_pct(s['change_pct'])}" + (f" ({s['theme']})" if s.get("theme") else "")

    tags_all = " ".join([*BASE_TAGS, *dynamic[:3]])
    dek = " ".join(str(data.get("dek") or "").split())
    for body, n_up, n_down in ((dek, 5, 3), (dek, 4, 2), ("", 5, 3), ("", 3, 2)):
        lists = "\n".join(map(row, ups[:n_up])) + ("\n\n" + "\n".join(map(row, downs[:n_down])) if downs and n_down else "")
        text = (f"{first}\n{hook}\n\n" + (f"{body}\n\n" if body else "") + f"{lists}\n\n"
                f"종목별 이유와 차트 {link('threads', day, edition)}\n{tags_all}")
        if fits("threads", text):
            out["threads"] = text
            break

    for count, n_tags in ((3, 3), (2, 2), (1, 1)):
        tags = " ".join([*BASE_TAGS[:2], *dynamic[:n_tags]])
        text = f"{first}\n{hook}\n{' · '.join(short(s) for s in known[:count])}\n{link('bluesky', day, edition)}\n{tags}"
        if fits("bluesky", text):
            out["bluesky"] = text
            break
    missing = {"twitter", "threads", "bluesky"} - out.keys()
    if missing:
        raise RuntimeError("Movers captions do not fit: " + ", ".join(sorted(missing)))
    return out


def make(day, edition, fits):
    data = _edition(day, edition)
    if not data.get("stocks"):
        raise RuntimeError("Movers edition has no stocks")
    texts = captions(day, edition, data, fits)
    png = screenshot(day, edition)
    top = ", ".join(f"{s['name']} {_pct(s['change_pct'])}" for s in data["stocks"][:5])
    alt = f"{day:%m/%d} {NAMES[edition]} 급등·급락 종목: {data['headline']}. {top}"
    return texts, [(f"movers-{EDITIONS[edition]}.png", png, alt[:900], None)]
