"""Prepare the KOSPIMAP editions and send them from a hosted GitHub runner."""

import base64
import datetime as dt
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw, ImageFont, ImageOps


SITE = "https://kospimap.com"
KST = ZoneInfo("Asia/Seoul")
ORG = "6afa7cf43c2efb7b09f70ee5"
PROFILES = {"twitter": "fdx5555", "threads": "hidenkill", "bluesky": "fdx5.bsky.social"}
MAPS = (
    ("kospi", "/map", "코스피 히트맵"),
    ("kosdaq", "/kosdaq-map", "코스닥 시가총액 맵"),
)
SLOTS = {"morning": "0700", "evening": "2200"}
BUFFER = "https://api.buffer.com"
ASSETS_BRANCH = "social-post-assets"


def request(url, *, data=None, token=None, method=None):
    headers = {"User-Agent": "KOSPIMAP-SocialPublisher/1"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if data is not None:
        headers["Content-Type"] = "application/json"
    body = json.dumps(data).encode() if data is not None else None
    req = Request(url, data=body, headers=headers, method=method)
    with urlopen(req, timeout=30) as response:
        return response.read()


def read_json(url, **kwargs):
    return json.loads(request(url, **kwargs))


def buffer(query, variables=None):
    token = os.getenv("BUFFER_PUBLISH_API_KEY")
    if not token:
        raise RuntimeError("BUFFER_PUBLISH_API_KEY is missing from Actions secrets")
    reply = read_json(BUFFER, token=token,
                      data={"query": query, "variables": variables or {}})
    if reply.get("errors") or not reply.get("data"):
        # API errors may contain user text or authenticated request information.
        raise RuntimeError("Buffer GraphQL request failed")
    return reply["data"]


def image_size(png):
    with Image.open(io.BytesIO(png)) as image:
        if image.format != "PNG":
            raise RuntimeError("Media is not PNG")
        image.load()
        return image.size


def weighted_length(text):
    # Published strings are ordinary Korean/ASCII. Overcount extended marks to
    # stay within X's limit and use its standard shortened URL length.
    return sum(
        23 if part.startswith("https://") else
        sum(1 if ord(char) <= 0x7f else 2 for char in part)
        for part in re.split(r"(https://[^\s]+)", text)
    )


def make_news(day, edition):
    slot = SLOTS[edition]
    clock = f"{slot[:2]}:{slot[2:]}"
    payload = read_json(f"{SITE}/api/hot-issues/{day}/{slot}")
    published = dt.datetime.fromisoformat(payload["slot"]).astimezone(KST)
    if published.date() != day or published.strftime("%H%M") != slot or not payload["stories"]:
        raise RuntimeError("Today's requested news edition is not ready")
    media = f"{SITE}/hot-issues/og/{day}/{slot}.png"
    png = request(media)
    image_size(png)
    first = f"{day:%m/%d} 오늘의 핫이슈 | {clock}판"
    headline = " ".join(payload["headline"].split())
    if not headline:
        raise RuntimeError("News headline is empty")
    footer = f"\n\n{SITE}/hot-issues\n#코스피 #코스닥 #증시뉴스"
    text = f"{first}\n{headline}{footer}"
    for story in payload["stories"]:
        keyword = " ".join(story["title"].split())
        if not keyword or keyword in headline:
            continue
        candidate = f"{first}\n{headline}\n• {keyword}{footer}"
        if weighted_length(candidate) <= 280:
            text = candidate
        break
    return text, [(f"news-{slot}.png", png, f"{day:%m/%d} {clock} 오늘의 핫이슈 요약 카드", media)]


def market_close(day):
    # 2027 CSAT: securities session delayed by one hour (2026-11-19).
    if day == dt.date(2026, 11, 19):
        return dt.datetime.combine(day, dt.time(16, 30), KST)
    return dt.datetime.combine(day, dt.time(15, 30), KST)


def close_report(day, market):
    report = read_json(f"{SITE}/api/market-brief/{day}/{market}")
    quote = report["index"]
    updated = dt.datetime.fromisoformat(quote["updated_at"]).astimezone(KST)
    if (report["date"] != str(day) or report["market"] != market.upper()
            or quote["market_status"] != "CLOSE" or updated.date() != day
            or updated < market_close(day)):
        raise RuntimeError(f"{market} has no verified same-day closing quote")
    level, change = float(quote["close"]), float(quote["change_pct"])
    if not (math.isfinite(level) and level > 0 and math.isfinite(change)):
        raise RuntimeError(f"{market} returned invalid closing values")
    return f"{level:,.2f} ({change:+.2f}%)", report["breadth"]


def export_maps():
    from playwright.sync_api import expect, sync_playwright

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context(viewport={"width": 1920, "height": 1200},
                                      device_scale_factor=2, locale="ko-KR",
                                      timezone_id="Asia/Seoul", reduced_motion="reduce")
        # First-party map PNG export draws into its own canvas. The page's ad
        # frames, pointer, and overlays are never part of that canvas.
        for market, route, title in MAPS:
            page = context.new_page()
            page.goto(SITE + route, wait_until="domcontentloaded", timeout=60000)
            page.locator(".kospi-map-updated").wait_for(timeout=60000)
            download = page.get_by_role("button", name=re.compile("MAP 다운로드|Download MAP", re.I))
            expect(download).to_be_enabled(timeout=45000)
            download.click()
            image = page.locator(".kospi-map-preview-image")
            image.wait_for(timeout=60000)
            encoded = image.evaluate("""async img => {
              const response = await fetch(img.src);
              const bytes = new Uint8Array(await response.arrayBuffer());
              let raw = "";
              for (let i = 0; i < bytes.length; i += 8192) {
                raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
              }
              return btoa(raw);
            }""")
            fetched = page.locator(".kospi-map-updated").first.text_content()
            stamp = re.search(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+\-]\d{2}:\d{2}", fetched or "")
            if stamp is None:
                raise RuntimeError(f"{market} map update timestamp missing")
            yield market, title, base64.b64decode(encoded), dt.datetime.fromisoformat(stamp.group())
            page.close()


def format_map(png, title, quote, day, fetched):
    font = os.getenv("SOCIAL_FONT", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc")
    width, height = image_size(png)
    if width < 1800 or height < 900:
        raise RuntimeError(f"{title} export is too small ({width}×{height})")
    bg = "#121116"
    canvas = Image.new("RGB", (1920, 1200), bg)
    with Image.open(io.BytesIO(png)) as raw:
        map_image = ImageOps.contain(raw.convert("RGB"), (1888, 1070), Image.Resampling.LANCZOS)
    canvas.paste(map_image, ((1920 - map_image.width) // 2, 80 + (1070 - map_image.height) // 2))
    drawing = ImageDraw.Draw(canvas)
    for position, text, size, anchor in (
        ((22, 23), title, 37, "lt"),
        ((430, 28), quote, 30, "lt"),
        ((1897, 29), f"{day}  ·  KOSPIMAP", 27, "rt"),
        ((22, 1160), f"지수는 정규장 종가  ·  종목 맵은 {fetched:%H:%M} KST 조회", 22, "lt"),
    ):
        drawing.text(position, text, font=ImageFont.truetype(font, size), fill="#eeeeff", anchor=anchor)
    output = io.BytesIO()
    canvas.save(output, "PNG", optimize=True)
    if output.tell() > 975_000:
        output = io.BytesIO()
        canvas.quantize(colors=256, dither=Image.Dither.NONE).save(output, "PNG", optimize=True)
    if output.tell() > 975_000:
        raise RuntimeError(f"{title} exceeds the image size budget")
    return output.getvalue()


def make_close(day, *, preview):
    quotes = {market: close_report(day, market) for market, _, _ in MAPS}
    media = []
    for market, title, png, stamp in export_maps():
        fetched = stamp.astimezone(KST)
        if fetched.date() != day or fetched < market_close(day):
            if not preview:
                raise RuntimeError(f"{market} map was not fetched after today's close")
        content = format_map(png, title, quotes[market][0], day, fetched)
        media.append((f"{market}.png", content, f"{day:%m/%d} {title}, 장 마감 후 조회", None))
    kp, kd = quotes["kospi"], quotes["kosdaq"]
    text = (f"{day:%m/%d} 국내 증시 마감\n코스피 {kp[0]} · 코스닥 {kd[0]}\n"
            f"시총 상위 표본 하락 종목은 코스피 {kp[1]['decline']}개, 코스닥 {kd[1]['decline']}개.\n\n"
            f"{SITE}/map\n#코스피 #코스닥 #장마감")
    return text, media


def upload_map(day, name, png):
    repo = os.environ["GITHUB_REPOSITORY"]
    token = os.environ["GITHUB_TOKEN"]
    git_api = f"https://api.github.com/repos/{repo}"
    try:
        request(f"{git_api}/git/ref/heads/{ASSETS_BRANCH}", token=token)
    except HTTPError as error:
        if error.code != 404:
            raise
        # An orphan root avoids attaching application history to the asset branch.
        tree = read_json(f"{git_api}/git/trees", token=token, data={"tree": []})
        commit = read_json(f"{git_api}/git/commits", token=token,
                           data={"tree": tree["sha"], "message": "Initialize public social media assets"})
        request(f"{git_api}/git/refs", token=token,
                data={"ref": f"refs/heads/{ASSETS_BRANCH}", "sha": commit["sha"]})
    digest = hashlib.sha256(png).hexdigest()
    path = f"{day}/{digest[:20]}-{name}"
    url = f"https://raw.githubusercontent.com/{repo}/{ASSETS_BRANCH}/{path}"
    try:
        request(f"{git_api}/contents/{path}?ref={ASSETS_BRANCH}", token=token)
    except HTTPError as error:
        if error.code != 404:
            raise
        request(f"{git_api}/contents/{path}", token=token, method="PUT",
                data={"message": f"Add {day} social asset {name}", "branch": ASSETS_BRANCH,
                      "content": base64.b64encode(png).decode()})
    for _ in range(6):
        try:
            public = request(url)
            if hashlib.sha256(public).hexdigest() != digest or image_size(public) != (1920, 1200):
                raise RuntimeError("Public heatmap failed integrity or dimension check")
            return url
        except HTTPError as error:
            if error.code != 404:
                raise
            time.sleep(5)
    raise RuntimeError("The public image URL did not become available")


def connected_profiles():
    data = buffer(f'''{{ channels(input: {{organizationId: "{ORG}"}}) {{
        id name service isDisconnected isLocked
    }} }}''')
    profiles = {}
    for channel in data["channels"]:
        service = channel["service"]
        name = channel["name"].lower().lstrip("@")
        if (name == PROFILES.get(service) and not channel["isDisconnected"] and not channel["isLocked"]):
            profiles[service] = channel["id"]
    return profiles


def post_status(channel, headline):
    posts = buffer(f'''{{ posts(first: 30, input: {{organizationId: "{ORG}",
        filter: {{channelIds: [ {json.dumps(channel)} ], status: [scheduled, sending, sent, error]}}
    }}) {{ edges {{ node {{ id text status externalLink }} }} }} }}''')
    matching = [edge["node"] for edge in posts["posts"]["edges"]
                if (edge["node"]["text"] or "").splitlines()[:1] == [headline]]
    return next((post for post in matching if post["status"] == "sent"), None) or next(iter(matching), None)


def publish(channel, text, assets):
    query = """mutation($input: CreatePostInput!) {
      createPost(input: $input) {
        __typename
        ... on PostActionSuccess { post { id status } }
      }
    }"""
    reply = buffer(query, {"input": {"text": text, "channelId": channel, "schedulingType": "automatic",
                                     "mode": "shareNow", "assets": assets}})["createPost"]
    if reply["__typename"] != "PostActionSuccess":
        raise RuntimeError("Buffer rejected the post")


def deliver(day, edition):
    profiles = connected_profiles()
    if not profiles:
        raise RuntimeError("No configured Buffer profiles are connected")
    if edition == "close":
        headline = f"{day:%m/%d} 국내 증시 마감"
    else:
        slot = SLOTS[edition]
        headline = f"{day:%m/%d} 오늘의 핫이슈 | {slot[:2]}:{slot[2:]}판"
    existing = {service: post_status(channel, headline) for service, channel in profiles.items()}
    pending = {service: channel for service, channel in profiles.items() if not existing[service]}
    if pending:
        text, media = prepare(day, edition, preview=False)
        assets = [{"image": {"url": url or upload_map(day, name, png), "metadata": {"altText": alt}}}
                  for name, png, alt, url in media]
        for service, channel in pending.items():
            try:
                if not post_status(channel, headline):
                    publish(channel, text, assets)
            except (OSError, RuntimeError) as error:
                print(f"::warning::{service} delivery request needs verification ({type(error).__name__})")
        time.sleep(12)
    incomplete = []
    for service in PROFILES:
        post = post_status(profiles[service], headline) if service in profiles else None
        if post and post["status"] == "sent":
            print(f"{service}: published {post.get('externalLink') or post['id']}")
        else:
            status = post["status"] if post else ("missing" if service in profiles else "disconnected")
            incomplete.append(f"{service}: {status}")
    if incomplete:
        raise RuntimeError("Unconfirmed delivery: " + ", ".join(incomplete))


def prepare(day, edition, *, preview):
    text, media = make_close(day, preview=preview) if edition == "close" else make_news(day, edition)
    if len(text) > 300 or weighted_length(text) > 280:
        raise RuntimeError("Caption exceeds the cross-platform post length")
    return text, media


def scheduled_edition(now, schedule):
    close_slot = schedule == "0,20,40 7,8,9 * * 1-5"
    if close_slot:
        if now.hour < 16 or now.hour >= 20 or now < market_close(now.date()):
            return None
        import exchange_calendars

        return "close" if exchange_calendars.get_calendar("XKRX").is_session(now.date().isoformat()) else None
    if schedule != "15,35,55 13,22 * * *":
        raise RuntimeError("Unexpected schedule")
    if dt.time(7, 15) <= now.time() < dt.time(10):
        return "morning"
    if dt.time(22, 15) <= now.time():
        return "evening"
    return None


def main():
    mode = os.getenv("WORKFLOW_MODE")
    if mode == "preview" or (not mode and os.getenv("PREVIEW_DATE")):
        day = dt.date.fromisoformat(os.environ["PREVIEW_DATE"])
        text, assets = prepare(day, os.environ["PREVIEW_EDITION"], preview=True)
        path = Path("social-preview")
        path.mkdir(exist_ok=True)
        (path / "caption.txt").write_text(text, encoding="utf-8")
        for name, png, _, _ in assets:
            (path / name).write_bytes(png)
        print("Prepared preview; no social API calls were made.")
        return
    now = dt.datetime.now(KST)
    if mode == "verify":
        profiles = connected_profiles()
        if profiles.keys() != PROFILES.keys():
            raise RuntimeError("Buffer profiles missing: " + ", ".join(PROFILES.keys() - profiles.keys()))
        for service, channel in profiles.items():
            post_status(channel, "connection verification")
            print(f"{service}: connected; recent posting history can be read")
        return
    if mode == "publish-current":
        edition = os.environ["PREVIEW_EDITION"]
        schedule = "0,20,40 7,8,9 * * 1-5" if edition == "close" else "15,35,55 13,22 * * *"
        if scheduled_edition(now, schedule) != edition:
            raise RuntimeError("This edition is outside its current KST publication window")
        deliver(now.date(), edition)
        return
    start = os.getenv("SOCIAL_PUBLISH_START")
    if not start or now.date() < dt.date.fromisoformat(start):
        print("Cloud publishing is awaiting cutover.")
        return
    edition = scheduled_edition(now, os.environ["SCHEDULE"])
    if edition:
        deliver(now.date(), edition)
    else:
        print("Outside the publication window or no KRX session.")


if __name__ == "__main__":
    main()
