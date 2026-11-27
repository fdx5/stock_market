"""Local Tistory publisher — run by Windows Task Scheduler every 5 minutes.

    cd backend
    python scripts/tistory_publisher.py --login     # once: a browser opens, you log in to Tistory (Kakao)
    python scripts/tistory_publisher.py --check     # is the stored login still valid?
    python scripts/tistory_publisher.py             # one tick: publish every prepared draft not yet public
    python scripts/tistory_publisher.py --dry-run   # fill the editor for the next draft, do not publish
    python scripts/tistory_publisher.py --status    # pending drafts and today's count

Why a PC: Kakao retired the Tistory Open API (cs.daum.net/notice/5108), so the only way
to publish is a real logged-in editor. The server (app/services/tistory_editorial.py)
prepares each draft and later confirms it through the public RSS feed; this script only
types the prepared draft into the editor and presses "공개 발행".

The login lives in a dedicated browser profile under app/data/store/ (gitignored). The
password is typed by a human into the genuine Kakao page and is never read or stored
here; nothing from the session is logged.

Tistory allows about 15 posts a day. When it refuses (an alert instead of the post page)
the script stops for the rest of the KST day and resumes the next tick after midnight.
A publish whose outcome is unknown is never retried automatically (no duplicates).
"""

import argparse
import base64
import datetime as dt
import html as htmllib
import json
import logging
import logging.handlers
import os
import re
import sys
import time
from pathlib import Path
from zoneinfo import ZoneInfo

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

KST = ZoneInfo("Asia/Seoul")
BLOG = "https://kospi-map.tistory.com"
EDITOR = f"{BLOG}/manage/newpost/?type=post&returnURL=ENTRY"
PROFILE_DIR = BACKEND / "app" / "data" / "store" / "tistory_profile"
STATE = BACKEND / "app" / "data" / "store" / "tistory_publisher_state.json"
LOG = BACKEND / "logs" / "tistory_publisher.log"
DAILY_LIMIT = 15
# A publish whose result is unknown is never retried automatically: RSS lists only the
# latest 10 posts, so it cannot prove the post is missing. Hold it for a human.
UNCERTAIN_KEEP_S = 3 * 86400
POST_URL = re.compile(rf"^{re.escape(BLOG)}/(\d+)(?:[?#].*)?$")
log = logging.getLogger("tistory_publisher")

# Runs in the editor page. Images are passed in as base64 and pasted into TinyMCE, which
# uploads them to Tistory's own CDN, so posts never depend on hot-linked files.
FILL_JS = r"""
async ({title, html, category, images}) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let t = 0; t < 80 && !(window.tinymce && tinymce.activeEditor && document.querySelector('#post-title-inp')); t++) await sleep(250);
  const ta = document.querySelector('#post-title-inp');
  if (!ta) throw new Error('editor did not load');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, title);
  ta.dispatchEvent(new Event('input', {bubbles: true}));
  const ed = tinymce.activeEditor; ed.setContent(html); const b = ed.getBody();
  for (const img of [...b.querySelectorAll('img')]) {
    const data = images[img.getAttribute('src')];
    if (!data) throw new Error('image not downloaded');
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bytes], 'kospimap.png', {type: 'image/png'}));
    const before = b.querySelectorAll('img[src*="kakaocdn"]').length; const host = img.closest('p') || img;
    ed.selection.select(host); ed.selection.collapse(false);
    b.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));
    let ok = false;
    for (let t = 0; t < 60; t++) { await sleep(500); if (b.querySelectorAll('img[src*="kakaocdn"]').length > before) { ok = true; break; } }
    if (!ok) throw new Error('image upload timed out');
    if (host !== img && host.querySelectorAll('img').length === 1 && !host.textContent.trim()) host.remove(); else img.remove();
  }
  if (b.querySelectorAll('img:not([src*="kakaocdn"])').length) throw new Error('external image left');
  // Tistory saves what its own input handlers saw. setContent alone fires none of them, so
  // a post without images (nothing pasted) was published with an empty body (2026-11-28).
  ed.focus(); ed.selection.select(b.lastChild); ed.selection.collapse(false);
  ed.execCommand('mceInsertContent', false, '&nbsp;');
  ed.undoManager.add(); ed.setDirty(true); ['input', 'keyup', 'change'].forEach(e => ed.fire(e)); ed.save();
  b.dispatchEvent(new InputEvent('input', {bubbles: true}));
  const fire = el => ['mousedown', 'mouseup', 'click'].forEach(t => el.dispatchEvent(new MouseEvent(t, {bubbles: true, cancelable: true, view: window})));
  fire(document.querySelector('#category-btn')); await sleep(400);
  const item = [...document.querySelectorAll('[id^=category-item-]')].find(e => e.textContent.trim() === category);
  if (!item) throw new Error('category missing on the blog');
  fire(item); await sleep(400);
  const chosen = document.querySelector('#category-btn').textContent.replace('더보기', '').trim();
  if (chosen !== category) throw new Error('category not applied');
  document.querySelector('#publish-layer-btn').click(); await sleep(800);
  document.querySelector('label[for=open20]').click(); await sleep(400);
  const label = document.querySelector('#publish-btn').textContent.trim();
  if (label !== '공개 발행') throw new Error('visibility is not public');
  return true;
}
"""


class SessionExpired(RuntimeError):
    pass


class DailyLimit(RuntimeError):
    pass


def _setup_logging(verbose: bool) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    handler = logging.handlers.RotatingFileHandler(LOG, maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    handlers = [handler] + ([logging.StreamHandler(sys.stdout)] if verbose else [])
    logging.basicConfig(level=logging.INFO, handlers=handlers, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def _state() -> dict:
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_state(state: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")


def _today() -> str:
    return dt.datetime.now(KST).date().isoformat()


def _launch(p, headless: bool):
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    for lock in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        try:
            (PROFILE_DIR / lock).unlink()
        except Exception:
            pass
    context = p.chromium.launch_persistent_context(
        user_data_dir=str(PROFILE_DIR), headless=headless, viewport={"width": 1280, "height": 900},
        locale="ko-KR", timezone_id="Asia/Seoul", args=["--disable-blink-features=AutomationControlled"])
    context.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined});")
    return context


def _logged_in(page) -> bool:
    page.goto(f"{BLOG}/manage", wait_until="domcontentloaded", timeout=30000)
    return page.url.startswith(f"{BLOG}/manage")


def login(timeout_s: int = 600) -> int:
    from playwright.sync_api import sync_playwright

    print("=" * 72)
    print("티스토리 로그인 창이 열립니다. kospi-map 블로그 계정(카카오)으로 로그인해 주세요.")
    print("로그인 상태 유지를 켜 두면 오래 유지됩니다. 로그인이 끝나면 자동으로 감지합니다.")
    print("=" * 72)
    with sync_playwright() as p:
        context = _launch(p, headless=False)
        page = context.pages[0] if context.pages else context.new_page()
        page.goto("https://www.tistory.com/auth/login")
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            time.sleep(3)
            try:
                names = {c["name"] for c in context.cookies("https://www.tistory.com")}
                url = page.url
            except Exception:
                break
            if "TSSESSION" in names and "login" not in url and "kakao.com" not in url:
                probe = context.new_page()
                ok = _logged_in(probe)
                probe.close()
                if ok:
                    print("[OK] 로그인 확인. 이제 창을 닫으셔도 됩니다.")
                    context.close()
                    return 0
        try:
            context.close()
        except Exception:
            pass
    print("[!] 로그인을 확인하지 못했습니다. 다시 실행해 주세요.")
    return 4


def check() -> int:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        context = _launch(p, headless=True)
        ok = _logged_in(context.new_page())
        context.close()
    print("로그인 유효" if ok else "로그인 만료 - `python scripts/tistory_publisher.py --login` 필요")
    return 0 if ok else 3


def _images(html: str) -> dict[str, str]:
    import requests

    result = {}
    for src in set(re.findall(r'<img src="([^"]+)"', html)):
        url = htmllib.unescape(src)
        response = requests.get(url, timeout=(5, 30), headers={"User-Agent": "KOSPIMAP-Editorial/1"})
        response.raise_for_status()
        if not response.headers.get("content-type", "").startswith("image/"):
            raise ValueError("draft image is not an image")
        result[src] = base64.b64encode(response.content).decode()
    return result


def _public_campaigns() -> set[str]:
    import requests

    try:
        body = requests.get(f"{BLOG}/rss", timeout=(5, 15), headers={"User-Agent": "KOSPIMAP-Editorial/1"}).text
    except Exception:
        return set()
    return set(re.findall(r"utm_campaign=(ts_[a-z0-9_]+)", body))


def _publish(context, draft: dict, dry_run: bool) -> str | None:
    alerts: list[str] = []
    page = context.new_page()

    def on_dialog(dialog):
        alerts.append(dialog.message[:200])
        dialog.dismiss()  # "continue the autosaved draft?" -> no, start clean; limit alerts -> close

    page.on("dialog", on_dialog)
    try:
        page.goto(EDITOR, wait_until="domcontentloaded", timeout=40000)
        if not page.url.startswith(f"{BLOG}/manage"):
            raise SessionExpired("redirected away from the editor")
        page.evaluate(FILL_JS, {"title": draft["title"], "html": draft["html"],
                                "category": draft["category"], "images": _images(draft["html"])})
        if dry_run:
            log.info("dry-run filled %s", draft["key"])
            return None
        alerts.clear()
        page.click("#publish-btn")
        deadline = time.time() + 30
        while time.time() < deadline:
            match = POST_URL.match(page.url)
            if match:
                return f"{BLOG}/{match.group(1)}"
            if alerts:
                raise DailyLimit(alerts[0])
            page.wait_for_timeout(500)
        raise TimeoutError("post page did not open after publishing")
    finally:
        page.close()


def tick(dry_run: bool = False, verbose: bool = False) -> int:
    from playwright.sync_api import sync_playwright
    from dotenv import load_dotenv

    load_dotenv(BACKEND / ".env")
    from app.services import tistory_editorial as editorial

    state = _state()
    today = _today()
    if state.get("day") != today:
        state.update(day=today, count=0, limit_hit=False)
    if state.get("limit_hit") and not dry_run:
        return 0
    if state.get("session_expired_at") and not dry_run:
        # Repeated login-page hits on a dead session gain nothing; wait for --login.
        return 3

    since = dt.datetime.now(KST).date() - dt.timedelta(days=2)
    drafts = editorial.pending(since)
    # Posts the owner deleted to be published again (--republish KEY). They already have a
    # recorded URL, so pending() no longer lists them; they go first.
    forced = [editorial.get_draft(key) for key in state.get("republish") or []]
    forced = [{**d, "campaign": None} for d in forced if d]
    drafts = forced + drafts
    held = {k: v for k, v in (state.get("uncertain") or {}).items() if time.time() - v < UNCERTAIN_KEEP_S}
    if not drafts:
        return 0
    public = _public_campaigns()
    queue = []
    for draft in drafts:
        if draft["campaign"] and draft["campaign"] in public:
            continue  # already live; the server will record it from RSS
        if draft["key"] in held:
            continue
        queue.append(draft)
    if not queue:
        return 0

    with sync_playwright() as p:
        context = _launch(p, headless=not verbose)
        try:
            for draft in queue:
                if not dry_run and state.get("count", 0) >= DAILY_LIMIT:
                    state["limit_hit"] = True
                    log.info("local daily ceiling reached (%s)", DAILY_LIMIT)
                    break
                try:
                    url = _publish(context, draft, dry_run)
                except SessionExpired:
                    state["session_expired_at"] = time.time()
                    log.error("Tistory login expired; run scripts/tistory_publisher.py --login")
                    break
                except DailyLimit as exc:
                    state["limit_hit"] = True
                    log.warning("Tistory refused %s: %s", draft["key"], exc)
                    break
                except TimeoutError:
                    held[draft["key"]] = time.time()
                    log.warning("publish result unknown for %s; not retried automatically - check the blog", draft["key"])
                    continue
                except Exception as exc:
                    log.warning("could not publish %s (%s: %s)", draft["key"], type(exc).__name__, str(exc)[:160])
                    continue
                if dry_run:
                    break
                if draft["campaign"] is None:
                    state["republish"] = [k for k in state.get("republish") or [] if k != draft["key"]]
                    state.setdefault("republished", {})[draft["key"]] = url
                else:
                    editorial.mark_published(draft["key"], url)
                state["count"] = state.get("count", 0) + 1
                log.info("published %s -> %s", draft["key"], url)
                _save_state({**state, "uncertain": held})
                time.sleep(5)
        finally:
            context.close()
    state["uncertain"] = held
    _save_state(state)
    return 0


def status() -> int:
    from dotenv import load_dotenv

    load_dotenv(BACKEND / ".env")
    from app.services import tistory_editorial as editorial

    state = _state()
    print(json.dumps({k: v for k, v in state.items() if k != "uncertain"}, ensure_ascii=False))
    for draft in editorial.pending(dt.datetime.now(KST).date() - dt.timedelta(days=2)):
        print(draft["key"], "|", draft["category"], "|", draft["title"][:60])
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--login", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--republish", nargs="+", metavar="KEY", help="queue drafts whose posts were deleted")
    parser.add_argument("-v", "--verbose", action="store_true", help="log to stdout and show the browser")
    args = parser.parse_args()
    _setup_logging(args.verbose or args.login or args.check or args.status)
    if args.login:
        code = login()
        if code == 0:
            state = _state()
            state.pop("session_expired_at", None)
            _save_state(state)
        return code
    if args.republish:
        state = _state()
        state["republish"] = list(dict.fromkeys((state.get("republish") or []) + args.republish))
        _save_state(state)
        print("queued:", ", ".join(state["republish"]))
        return 0
    if args.check:
        return check()
    if args.status:
        return status()
    return tick(dry_run=args.dry_run, verbose=args.verbose)


if __name__ == "__main__":
    sys.exit(main())
