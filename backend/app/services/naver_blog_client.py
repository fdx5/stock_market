"""Playwright client that publishes one post to Naver Blog.

Design, and why it is shaped this way
-------------------------------------
The previous attempt at this typed the post into the page with keyboard events and
decided it had succeeded whenever no exception escaped. Both halves of that were wrong,
and both are inverted here:

* Content goes in through SmartEditor's own document model
  (`setDocumentData`), not through keystrokes. See naver_document_model.py. After
  injection the model is read back with `getDocumentData()` and the component count is
  compared — if the editor dropped the body, we find out here rather than after
  publishing an empty post.

* Success is decided by the network, not by the click. The publish click is only a
  trigger; what proves publication is the `RabbitWrite.naver` response and the `logNo`
  in it. A click that lands on nothing now fails loudly.

Why the publish button is still clicked rather than POSTing RabbitWrite directly:
publishing a *public* post requires a `tokenId` — an ncaptcha token the editor obtains
at publish time. Its acquisition path is not publicly documented, and guessing at it
would be the one part of this flow that silently produces drafts instead of posts. So
the page is allowed to run its own publish routine (which mints the token correctly),
while everything that determines *what* gets published is fully deterministic on our
side. The interceptor records the outgoing request shape, which is what a future
pure-HTTP path would need.
"""

import datetime as dt
import json
import logging
import os
import random
import re
import shutil
import tempfile
import time
from pathlib import Path

log = logging.getLogger(__name__)

BLOG_ID = os.environ.get("NAVER_BLOG_ID", "kospi-predictor")
from app.site import PRIMARY_SITE_URL

SITE_URL = PRIMARY_SITE_URL

# Headless is required on Render (no display). Set NAVER_PUBLISH_HEADLESS=0 locally to
# watch a run — the only reliable way to diagnose a selector change.
HEADLESS = os.environ.get("NAVER_PUBLISH_HEADLESS", "1") != "0"

# A datacenter IP already makes this session look unusual to Naver; a headless-shaped
# UA string on top of that is free additional signal. Pin a normal desktop Chrome UA.
USER_AGENT = os.environ.get(
    "NAVER_PUBLISH_UA",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
)

# Failure artifacts (screenshot + page HTML) land here, never in exports/ — that path is
# gitignored specifically because it held live session cookies, and debug dumps of a
# logged-in page belong under the same treatment.
DEBUG_DIR = Path(os.environ.get("NAVER_PUBLISH_DEBUG_DIR", "/tmp/naver_publish_debug"))

WRITE_URLS = [
    f"https://blog.naver.com/{BLOG_ID}/postwrite",
    f"https://blog.naver.com/PostWriteForm.naver?blogId={BLOG_ID}",
    "https://blog.naver.com/GoBlogWrite.naver",
]


class NaverSessionExpired(RuntimeError):
    """The stored cookies no longer authenticate. Needs a human re-seed; retrying is
    pointless and repeated login-page hits are exactly what escalates a Naver account
    to a hard block, so the publisher stops the whole run on this."""


class NaverPublishError(RuntimeError):
    """This post failed but the session is fine — safe to retry."""


def _dump_debug(page, tag: str) -> str | None:
    """Screenshot + HTML on failure. Without this a headless selector change is
    undiagnosable from logs alone."""
    try:
        DEBUG_DIR.mkdir(parents=True, exist_ok=True)
        stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        shot = DEBUG_DIR / f"{tag}_{stamp}.png"
        page.screenshot(path=str(shot), full_page=False)
        (DEBUG_DIR / f"{tag}_{stamp}.html").write_text(page.content(), encoding="utf-8")
        return str(shot)
    except Exception:
        return None


def _find_editor_frame(page, timeout_s: int = 30):
    """Returns the frame that owns `window.SmartEditor`.

    The write page has historically lived both at the top level and inside a `mainFrame`
    iframe, and which one you get depends on the entry URL and on redirects. Rather than
    hardcode either, probe every frame for the editor global.
    """
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        for frame in page.frames:
            try:
                if frame.evaluate("() => typeof window.SmartEditor !== 'undefined' && !!window.SmartEditor"):
                    return frame
            except Exception:
                # Frames detach mid-navigation; that is normal here, keep probing.
                continue
        page.wait_for_timeout(500)
    return None


def _editor_handle(frame) -> str:
    """JS expression resolving to the blog editor instance.

    `blogpc001` is the conventional editor id on the PC write page, but it is not
    guaranteed, so fall back to the first editor registered.
    """
    return (
        "(() => { const e = window.SmartEditor && window.SmartEditor._editors; "
        "if (!e) return null; return e.blogpc001 || e[Object.keys(e)[0]] || null; })()"
    )


_LOG_NO_RE = re.compile(r"/(\d{6,})(?:[/?#]|$)")


def _log_no_from_url(url: str, blog_id: str) -> str | None:
    """Extracts the post id from the URL the browser lands on after publishing.

    Two shapes are in play: the modern path form
    blog.naver.com/<blogId>/223456789012, and the legacy query form
    ...PostView.naver?blogId=<id>&logNo=223456789012.
    """
    if not url or "blog.naver.com" not in url:
        return None
    match = re.search(r"[?&]logNo=(\d+)", url)
    if match:
        return match.group(1)
    if f"/{blog_id}/" not in url:
        return None
    match = _LOG_NO_RE.search(url.split(f"/{blog_id}", 1)[1])
    return match.group(1) if match else None


def _assert_logged_in(page) -> None:
    url = page.url or ""
    if "nidlogin" in url or "nid.naver.com" in url:
        raise NaverSessionExpired(f"redirected to the Naver login page ({url[:80]})")


def publish(
    brief: dict,
    meta: dict,
    title_paragraphs: list[dict],
    body_components: list[dict],
    tags: list[str],
    cookies: list[dict],
    *,
    charts: list[tuple[str, bytes]] | None = None,
    blog_id: str = BLOG_ID,
    dry_run: bool = False,
) -> dict:
    """Publishes one post. Returns {"log_no", "post_url", "cookies", "request_seen"}.

    `dry_run=True` stops after the content is verified inside the editor and never
    publishes — this is the safe way to exercise the whole path (session, navigation,
    document model, normalization) against the real account without producing a post.

    Raises NaverSessionExpired (stop everything) or NaverPublishError (retryable).
    """
    from playwright.sync_api import sync_playwright

    from app.services import naver_document_model

    expected_components = 1 + len(body_components)
    captured: dict = {"log_no": None, "request_seen": False, "response_body": None}

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=HEADLESS,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ],
        )
        context = browser.new_context(
            viewport={"width": 1440, "height": 960},
            user_agent=USER_AGENT,
            locale="ko-KR",
            timezone_id="Asia/Seoul",
        )
        try:
            context.add_cookies(cookies)
        except Exception as exc:
            browser.close()
            raise NaverPublishError(f"stored cookies rejected by Playwright: {exc}") from exc

        page = context.new_page()

        # navigator.webdriver is the single cheapest automation tell; strip it before any
        # Naver script runs.
        page.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
        )

        def _on_response(response):
            if "RabbitWrite.naver" in response.url or "RabbitTempPostWrite.naver" in response.url:
                captured["request_seen"] = True
                try:
                    body = response.text()
                    captured["response_body"] = body[:2000]
                    data = json.loads(body)
                    log_no = (
                        data.get("logNo")
                        or (data.get("result") or {}).get("logNo")
                        or (data.get("data") or {}).get("logNo")
                    )
                    if log_no:
                        captured["log_no"] = str(log_no)
                except Exception:
                    log.warning("RabbitWrite response was not parseable JSON")

        page.on("response", _on_response)

        try:
            frame = None
            for url in WRITE_URLS:
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=45000)
                except Exception:
                    continue
                _assert_logged_in(page)
                frame = _find_editor_frame(page, timeout_s=25)
                if frame:
                    break

            if frame is None:
                _assert_logged_in(page)
                shot = _dump_debug(page, "no_editor")
                raise NaverPublishError(f"SmartEditor never appeared on the write page (debug: {shot})")

            # A recovered autosave draft opens a modal that swallows every later
            # interaction. Dismiss it before touching the document.
            _dismiss_popups(frame)

            # Take the editor's own empty document first and merge into it, rather than
            # constructing a whole document here. Everything schema-level (version, id,
            # di, the documentTitle component's own shape) then comes from the editor,
            # so a Naver-side bump does not silently invalidate our payload.
            skeleton = frame.evaluate(
                f"() => {{ const ed = {_editor_handle(frame)}; "
                "return ed ? ed.getDocumentData() : null; }"
            )
            if not skeleton:
                shot = _dump_debug(page, "no_skeleton")
                raise NaverPublishError(f"editor returned no document (debug: {shot})")

            uploaded = _upload_charts(page, frame, charts or [])
            resolved = naver_document_model.resolve_image_slots(body_components, uploaded)
            if uploaded:
                # The skeleton was read before the upload, so re-read it: it now holds
                # the uploaded images, and writing back the stale one would drop them.
                skeleton = frame.evaluate(
                    f"() => {{ const ed = {_editor_handle(frame)}; "
                    "return ed ? ed.getDocumentData() : null; }"
                ) or skeleton

            merged = naver_document_model.merge_into_skeleton(
                skeleton, title_paragraphs, resolved
            )
            expected_components = len(merged["document"]["components"])

            injected = frame.evaluate(
                """
                ([model, handleExpr]) => {
                    const ed = eval(handleExpr);
                    if (!ed) return {ok: false, error: 'editor instance not found'};
                    try {
                        ed.setDocumentData(model);
                    } catch (e) {
                        return {ok: false, error: 'setDocumentData: ' + e.message};
                    }
                    try {
                        const back = ed.getDocumentData();
                        const comps = (back && back.document && back.document.components) || [];
                        const titleComp = comps.find(c => c['@ctype'] === 'documentTitle');
                        const titleText = titleComp && titleComp.title
                            ? titleComp.title.map(p => (p.nodes || []).map(n => n.value || '').join('')).join('')
                            : '';
                        return {ok: true, count: comps.length, title: titleText,
                                text: (ed.getContentText ? ed.getContentText() : '').length};
                    } catch (e) {
                        return {ok: false, error: 'getDocumentData: ' + e.message};
                    }
                }
                """,
                [merged, _editor_handle(frame)],
            )

            if not injected.get("ok"):
                shot = _dump_debug(page, "inject_failed")
                raise NaverPublishError(f"documentModel injection failed: {injected.get('error')} (debug: {shot})")

            landed = int(injected.get("count") or 0)
            landed_title = (injected.get("title") or "").strip()
            landed_chars = int(injected.get("text") or 0)

            # The editor legitimately merges and re-splits components during
            # normalization, so an exact match is the wrong assertion. What actually
            # matters is that the body is not empty or near-empty — that is the failure
            # mode the old scripts shipped for weeks without noticing.
            if landed < max(3, expected_components // 3):
                shot = _dump_debug(page, "content_lost")
                raise NaverPublishError(
                    f"editor kept only {landed} of {expected_components} components (debug: {shot})"
                )
            if not landed_title:
                shot = _dump_debug(page, "title_lost")
                raise NaverPublishError(f"title did not land in the editor (debug: {shot})")
            log.info(
                "content injected: %s/%s components, %s chars, title=%r",
                landed, expected_components, landed_chars, landed_title[:60],
            )

            if dry_run:
                fresh = context.cookies()
                _dump_debug(page, f"dryrun_{meta.get('market', 'x')}")
                return {
                    "log_no": None,
                    "post_url": None,
                    "cookies": fresh,
                    "request_seen": False,
                    "dry_run": True,
                    "components": landed,
                    "chars": landed_chars,
                    "title": landed_title,
                }

            _click_publish(page, frame, tags)

            # Two independent success signals, because the response body alone is not
            # dependable: publishing navigates the browser to the new post, and reading
            # a response whose page has already gone away throws. The first real publish
            # succeeded and was still reported as a failure for exactly that reason.
            #
            # The landing URL is the stronger signal — Naver redirects to
            # blog.naver.com/<blogId>/<logNo>, and that redirect only happens on a
            # successful publish.
            log_no = None
            deadline = time.time() + 90
            while time.time() < deadline:
                if captured["log_no"]:
                    log_no = captured["log_no"]
                    break
                found = _log_no_from_url(page.url, blog_id)
                if found:
                    log_no = found
                    log.info("logNo recovered from landing URL: %s", found)
                    break
                page.wait_for_timeout(500)

            if not log_no:
                _assert_logged_in(page)
                shot = _dump_debug(page, "no_logno")
                detail = (
                    "no RabbitWrite request was made"
                    if not captured["request_seen"]
                    else f"RabbitWrite fired but no logNo appeared (url={page.url[:80]}, "
                         f"body={captured['response_body']})"
                )
                raise NaverPublishError(f"publish not confirmed - {detail} (debug: {shot})")
            fresh = context.cookies()
            return {
                "log_no": log_no,
                "post_url": f"https://blog.naver.com/{blog_id}/{log_no}",
                "cookies": fresh,
                "request_seen": True,
                "components": landed,
            }
        finally:
            try:
                context.close()
                browser.close()
            except Exception:
                pass


def _upload_charts(page, frame, charts: list[tuple[str, bytes]]) -> dict[str, dict]:
    """Uploads chart PNGs through the editor and returns {slug: image component}.

    Why through the editor rather than by POSTing to an upload endpoint: an `image`
    component carries Naver-side resource fields (domain, path, original dimensions)
    that are minted by the upload service. Fabricating one produces a component the
    editor discards — the same class of mistake as guessing the documentTitle shape.

    So the pictures are uploaded first, into an otherwise empty document, and the
    resulting components are harvested from getDocumentData. The body is assembled
    afterwards, interleaving those real components with our text
    (naver_document_model.resolve_image_slots).

    Best-effort throughout: a failed upload costs the post its charts, never its
    publication.
    """
    if not charts:
        return {}

    tmp_dir = Path(tempfile.mkdtemp(prefix="naver_charts_"))
    paths = []
    slugs = []
    try:
        for name, data in charts:
            slug = name.rsplit("_", 1)[-1].removesuffix(".png")
            path = tmp_dir / name
            path.write_bytes(data)
            paths.append(str(path))
            slugs.append(slug)

        # One file per click, not all of them in one shot. Handing SmartEditor several
        # images at once makes it treat them as a set and offer a layout choice
        # (개별/콜라주/슬라이드), and that prompt sits there unanswered — the batch upload
        # returned zero components for exactly this reason. Sequential uploads also make
        # the slug↔component mapping positional rather than a guess.
        mapped: dict[str, dict] = {}
        for slug, path in zip(slugs, paths):
            component = _upload_one(page, frame, path)
            if component is None:
                log.warning("chart %r did not upload; publishing without it", slug)
                continue
            mapped[slug] = component

        if mapped:
            log.info("charts uploaded: %s", ", ".join(mapped))
        return mapped
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _upload_one(page, frame, path: str) -> dict | None:
    """Uploads a single image and returns the component the editor created for it."""
    before = _image_components(frame)
    try:
        # The 사진 button does not open a native file dialog — waiting on a
        # `filechooser` event just times out. It injects `input#hidden-file` into the
        # DOM, and that input takes the file directly. It only exists after the click,
        # so the order here matters.
        _dismiss_draft_prompt(frame, wait_ms=1200)
        if not _click_first(
            frame,
            ["button.se-image-toolbar-button", "[class*='se-image-toolbar-button']"],
            what="image toolbar",
        ):
            raise NaverPublishError("image toolbar button not found")

        # Fixed settle, then resolve and set in one step. The input is created by the
        # click and Naver tears it down again, so a locator resolved in a polling loop
        # can be stale by the time files are handed to it.
        frame.wait_for_timeout(2500)
        if not frame.locator("input#hidden-file").count():
            raise NaverPublishError("no file input appeared after clicking 사진")
        frame.locator("input#hidden-file").set_input_files(path)
    except Exception as exc:
        shot = _dump_debug(page, "upload_start_failed")
        log.warning(
            "chart upload could not start: %s | debug=%s",
            str(exc).splitlines()[0][:120], shot,
        )
        return None

    # Wait for the editor to finish the round trip to Naver's image service. Polled
    # rather than slept: a chart on a slow link takes far longer than on a fast one.
    deadline = time.time() + 60
    while time.time() < deadline:
        page.wait_for_timeout(1000)
        current = _image_components(frame)
        if len(current) > len(before):
            component = current[len(before)]
            # `imageLoaded` flips once the upload really landed; a component without it
            # is a placeholder that would publish as a broken image.
            if component.get("imageLoaded") or component.get("src"):
                return component

    _dump_debug(page, "upload_timeout")
    return None


def _image_components(frame) -> list[dict]:
    try:
        return frame.evaluate(
            f"""() => {{
                const ed = {_editor_handle(frame)};
                if (!ed) return [];
                const d = ed.getDocumentData();
                const comps = (d && d.document && d.document.components) || [];
                return comps.filter(c => c['@ctype'] === 'image' || c['@ctype'] === 'imageGroup');
            }}"""
        ) or []
    except Exception:
        return []


def _dismiss_draft_prompt(frame, wait_ms: int = 4000) -> bool:
    """Answers "작성 중인 글이 있습니다. 이어서 작성하시겠습니까?" with 취소.

    This is not an edge case, it is the steady state. SmartEditor autosaves, so every
    interrupted run — a crash, a redeploy, a killed dry run — leaves a draft, and from
    then on every visit to the write page opens behind a modal dim that swallows the
    toolbar and the 발행 button alike. The first publish only worked because the account
    had no draft yet.

    취소, not 확인: we overwrite the document with setDocumentData immediately after, so
    loading the old draft first would only risk its content surviving into the post.
    """
    deadline = time.time() + wait_ms / 1000
    while time.time() < deadline:
        try:
            popup = frame.locator(".se-popup-alert, .se-popup-alert-confirm").first
            if popup.count() and popup.is_visible():
                break
        except Exception:
            pass
        frame.wait_for_timeout(300)
    else:
        return False

    for selector in (
        ".se-popup-alert button.se-popup-button-cancel",
        ".se-popup-alert-confirm button:has-text('취소')",
        ".se-popup-alert button:has-text('취소')",
        "button.se-popup-button-cancel",
    ):
        try:
            btn = frame.locator(selector).first
            if btn.count() and btn.is_visible():
                btn.click(timeout=2500)
                frame.wait_for_timeout(700)
                log.info("dismissed the autosaved-draft prompt via %s", selector)
                return True
        except Exception:
            continue

    log.warning("autosaved-draft prompt is present but could not be dismissed")
    return False


def _dismiss_popups(frame) -> None:
    """Close the autosave-recovery modal, the help panel and the promo tooltips.

    Not cosmetic: the help panel docks over the right-hand side of the toolbar and the
    promo tooltip floats above it, and either one will intercept the click on 발행.
    """
    _dismiss_draft_prompt(frame)
    for selector in (
        "button.se-popup-button-cancel",
        ".se-popup-button-cancel",
        ".se-help-panel-close-button",
        "button.se-help-panel-close-button",
        "[class*='guide'] button[class*='close']",
        "[class*='tooltip'] button[class*='close']",
        "[class*='layer'] button[class*='close']",
        "button.btn_close",
    ):
        try:
            for i in range(frame.locator(selector).count()):
                btn = frame.locator(selector).nth(i)
                if btn.is_visible():
                    btn.click(timeout=1500)
                    frame.wait_for_timeout(300)
        except Exception:
            continue

    # Anything still floating gets removed outright. Closing by button is preferred (it
    # tells Naver the tip was seen), but a leftover overlay must not cost us the publish.
    try:
        frame.evaluate(
            """
            () => {
                const kill = [];
                document.querySelectorAll('div,section,aside').forEach(el => {
                    const cls = (el.className || '').toString().toLowerCase();
                    if (!/guide|tooltip|help_panel|helppanel|coach|promo|balloon/.test(cls)) return;
                    const s = getComputedStyle(el);
                    if (s.position === 'fixed' || s.position === 'absolute') {
                        const r = el.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) kill.push(el);
                    }
                });
                kill.forEach(el => { el.style.display = 'none'; });
                return kill.length;
            }
            """
        )
    except Exception:
        pass


def _click_publish(page, frame, tags: list[str]) -> None:
    """Opens the publish panel, fills tags, confirms.

    Two clicks, each tried against several selectors: the first opens the publish
    settings layer, the second commits. Naver has kept `.publish_btn` / `.btn_apply`
    stable for a long time, but the text-based fallbacks cost nothing and cover a
    reskin. Tag entry is best-effort — a post without tags is still a successful post,
    so a tag failure must not abort the publish.
    """
    # Overlays are re-dismissed here, not just at page load: the promo tooltip that
    # covers the toolbar appears on a delay, so by the time the body has been injected it
    # may be sitting directly on top of the 발행 button.
    _dismiss_draft_prompt(frame, wait_ms=1500)
    _dismiss_popups(frame)

    opened = _click_first(
        frame,
        [
            "button[class*='publish_btn__']",
            "button.publish_btn",
            "[class*='publish_btn_area'] button",
            ".btn_area button:has-text('발행')",
            "button:has-text('발행')",
        ],
        what="publish panel",
    )
    if not opened:
        shot = _dump_debug(page, "publish_btn_missing")
        raise NaverPublishError(f"could not open the publish panel (debug: {shot})")

    frame.wait_for_timeout(1500)

    # Make the two settings that decide whether this counts as "published" explicit
    # rather than inheriting whatever the account last used. An unattended batch that
    # silently posts 이웃공개 because a previous manual post left that selected would
    # meet none of the requirement. `check()` is a no-op when already selected.
    for selector, what in (("#open_public", "전체공개"), ("#publish-option-search", "검색 허용")):
        try:
            box = frame.locator(selector).first
            if box.count():
                box.check(timeout=2500, force=True)
                log.info("publish option set: %s", what)
        except Exception as exc:
            log.warning("could not set %s: %s", what, str(exc).splitlines()[0][:80])

    if tags:
        for selector in ("#tag-input", "input#tag-input", ".tag_input", "input[placeholder*='태그']"):
            try:
                box = frame.locator(selector).first
                if box.count() and box.is_visible():
                    box.click()
                    for tag in tags:
                        box.type(tag, delay=25)
                        # Page.keyboard, not Frame.keyboard - Frame has no keyboard
                        # attribute, and the AttributeError was being swallowed by the
                        # per-selector except, so every post published untagged.
                        page.keyboard.press("Enter")
                        frame.wait_for_timeout(120)
                    log.info("entered %s tags", len(tags))
                    break
            except Exception as exc:
                log.warning("tag entry via %s failed: %s", selector, str(exc).splitlines()[0][:80])
                continue

    committed = _click_first(
        frame,
        [
            "button[class*='confirm_btn__']",
            "button.btn_apply",
            "[class*='layer_publish'] button:has-text('발행')",
            "button:has-text('발행하기')",
            "[class*='publish'] button:has-text('발행')",
        ],
        what="publish confirm",
    )
    if not committed:
        shot = _dump_debug(page, "confirm_btn_missing")
        raise NaverPublishError(f"could not click the publish confirm button (debug: {shot})")


def _click_first(frame, selectors: list[str], *, what: str) -> bool:
    """Clicks the first selector that resolves, escalating through three strategies.

    The escalation exists because the write page floats promo tooltips and a help panel
    over the toolbar; a plain click then fails with "element intercepted" even though the
    button is present and visible. Playwright's force click skips the actionability
    check, and a dispatched DOM event skips hit-testing entirely.

    Failures are logged per selector rather than swallowed. The first version returned a
    bare False here, which turned "a tooltip is covering the button" into the same
    undiagnosable "could not open the publish panel" as "the selector is wrong" — the
    exact silent-failure shape this client exists to avoid.
    """
    reasons = []
    for selector in selectors:
        try:
            loc = frame.locator(selector).first
            if not loc.count():
                reasons.append(f"{selector}: no match")
                continue
        except Exception as exc:
            reasons.append(f"{selector}: locator error {exc}")
            continue

        for strategy in ("click", "force", "dispatch"):
            try:
                if strategy == "click":
                    loc.click(timeout=4000)
                elif strategy == "force":
                    loc.click(timeout=4000, force=True)
                else:
                    loc.dispatch_event("click")
                log.info("clicked %s via %s (%s)", what, selector, strategy)
                return True
            except Exception as exc:
                reasons.append(f"{selector}[{strategy}]: {str(exc).splitlines()[0][:90]}")

    log.warning("could not click %s; tried:\n  %s", what, "\n  ".join(reasons))
    return False


def keep_alive(cookies: list[dict]) -> list[dict]:
    """Loads the blog once to let Naver rotate the session cookies, and returns the
    refreshed jar.

    This is the main defence for running on Render: the cookies were minted on a Korean
    residential IP and are being replayed from a datacenter, which shortens their useful
    life. Touching the session on a schedule keeps NID_SES fresh instead of letting it
    idle out between the once-a-weekday publish runs.
    """
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=HEADLESS,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"],
        )
        context = browser.new_context(user_agent=USER_AGENT, locale="ko-KR", timezone_id="Asia/Seoul")
        context.add_cookies(cookies)
        page = context.new_page()
        page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined});")
        try:
            page.goto(f"https://blog.naver.com/{BLOG_ID}", wait_until="domcontentloaded", timeout=30000)
            _assert_logged_in(page)
            page.wait_for_timeout(random.randint(1500, 3500))
            return context.cookies()
        finally:
            try:
                context.close()
                browser.close()
            except Exception:
                pass
