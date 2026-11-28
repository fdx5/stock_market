"""On-device Chrome profile for the weekly Naver Blog publisher."""

import os
from pathlib import Path
import time
from urllib.parse import urlsplit


def profile_dir() -> Path:
    return Path(os.environ["LOCALAPPDATA"]) / "KOSPIMAP" / "naver-weekly-chrome"


def launch(chromium, *, headless: bool):
    return chromium.launch_persistent_context(
        str(profile_dir()), channel="chrome", headless=headless,
        viewport={"width": 1440, "height": 960}, locale="ko-KR",
        timezone_id="Asia/Seoul", args=["--mute-audio"],
    )


def open_login(blog_id: str) -> bool:
    from playwright.sync_api import Error, sync_playwright

    profile_dir().mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        context = launch(playwright.chromium, headless=False)
        try:
            page = context.pages[0] if context.pages else context.new_page()
            page.goto(f"https://blog.naver.com/PostWriteForm.naver?blogId={blog_id}",
                      wait_until="domcontentloaded", timeout=30_000)
            page.bring_to_front()
            deadline = time.monotonic() + 600
            while not page.is_closed() and time.monotonic() < deadline:
                try:
                    if (urlsplit(page.url).hostname == "blog.naver.com"
                            and page.get_by_role("button", name="발행", exact=True).first.is_visible()):
                        return True
                    page.wait_for_timeout(1500)
                except Error:
                    if page.is_closed():
                        return False
        finally:
            context.close()
    return False
