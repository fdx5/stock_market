"""Diagnostic: ask SmartEditor for its own document schema.

Guessing at the documentModel shape produced
"setDocumentData: Cannot read properties of undefined (reading 'forEach')" — the editor
walks some field on every component and one of ours does not have it. Rather than guess
again, open the real write page with the stored session and dump what the editor itself
considers a valid document.

    python scripts/naver_probe_editor.py

Writes the raw JSON to scripts/_probe_documentmodel.json for inspection. Read-only: it
never publishes, and never saves a draft.
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import naver_blog_client, naver_session_store  # noqa: E402

OUT = Path(__file__).resolve().parent / "_probe_documentmodel.json"


def main() -> int:
    from playwright.sync_api import sync_playwright

    session = naver_session_store.get()
    if not session:
        print("[!] 저장된 세션이 없습니다.")
        return 2

    blog_id = session.get("blog_id") or "kospi-predictor"
    report = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        context = browser.new_context(
            viewport={"width": 1440, "height": 960},
            user_agent=naver_blog_client.USER_AGENT,
            locale="ko-KR",
            timezone_id="Asia/Seoul",
        )
        context.add_cookies(session["cookies"])
        page = context.new_page()
        page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined});")

        page.goto(f"https://blog.naver.com/{blog_id}/postwrite", wait_until="domcontentloaded", timeout=45000)
        print("url:", page.url)

        frame = naver_blog_client._find_editor_frame(page, timeout_s=30)
        if frame is None:
            print("[!] SmartEditor 프레임을 찾지 못했습니다.")
            browser.close()
            return 3
        print("editor frame:", frame.url[:100])

        naver_blog_client._dismiss_popups(frame)
        time.sleep(2)

        # 1. What does the editor consider a document right now?
        report["empty_document"] = frame.evaluate(
            """
            () => {
                const es = window.SmartEditor && window.SmartEditor._editors;
                if (!es) return {error: 'no _editors'};
                const key = Object.keys(es)[0];
                const ed = es[key];
                try {
                    return {editorKey: key, data: ed.getDocumentData()};
                } catch (e) {
                    return {editorKey: key, error: e.message};
                }
            }
            """
        )

        # 2. What methods does the editor expose, and what does setDocumentData look like?
        report["editor_api"] = frame.evaluate(
            """
            () => {
                const es = window.SmartEditor && window.SmartEditor._editors;
                if (!es) return {error: 'no _editors'};
                const ed = es[Object.keys(es)[0]];
                const names = [];
                let o = ed;
                while (o && o !== Object.prototype) {
                    for (const k of Object.getOwnPropertyNames(o)) {
                        if (typeof ed[k] === 'function' && !names.includes(k)) names.push(k);
                    }
                    o = Object.getPrototypeOf(o);
                }
                return {
                    methods: names.filter(n => !n.startsWith('__')).sort(),
                    setDocumentDataSource: ed.setDocumentData
                        ? String(ed.setDocumentData).slice(0, 1200) : null,
                };
            }
            """
        )

        # 3. Insert one plain paragraph through the editor's own path, then read it back.
        #    Whatever comes out is the authoritative shape for a text component.
        report["after_typing"] = frame.evaluate(
            """
            async () => {
                const es = window.SmartEditor && window.SmartEditor._editors;
                const ed = es[Object.keys(es)[0]];
                try {
                    const el = document.querySelector('.se-main-container .se-text-paragraph, .se-main-container');
                    if (el) { el.click && el.click(); }
                } catch (e) {}
                return null;
            }
            """
        )
        try:
            body = frame.locator(".se-main-container").first
            body.click(timeout=4000)
            frame.keyboard.type("스키마 확인용 문단", delay=15)
            time.sleep(1.5)
            report["typed_document"] = frame.evaluate(
                """
                () => {
                    const es = window.SmartEditor._editors;
                    const ed = es[Object.keys(es)[0]];
                    return ed.getDocumentData();
                }
                """
            )
        except Exception as exc:
            report["typed_document"] = {"error": str(exc)}

        try:
            context.close()
            browser.close()
        except Exception:
            pass

    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n[OK] wrote {OUT}")

    api = report.get("editor_api") or {}
    print("\n--- editor methods ---")
    print(", ".join(api.get("methods") or [])[:1500])
    print("\n--- setDocumentData source (truncated) ---")
    print((api.get("setDocumentDataSource") or "")[:900])

    typed = report.get("typed_document")
    if isinstance(typed, dict) and "document" not in typed and "error" not in typed:
        print("\n--- typed_document TOP-LEVEL KEYS ---")
        print(list(typed.keys()))
    print("\n--- typed_document (first 2500 chars) ---")
    print(json.dumps(typed, ensure_ascii=False, indent=2)[:2500])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
