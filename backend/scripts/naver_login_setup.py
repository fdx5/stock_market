"""One-time Naver blog connection. Run this locally; never on the server.

    cd backend
    python scripts/naver_login_setup.py --genkey     # first time only
    python scripts/naver_login_setup.py              # opens a browser, you log in
    python scripts/naver_login_setup.py --check      # verify the stored session works

Why this exists at all: Naver shut down the official blog write API on 2020-05-06 and
never replaced it, so there is no key to issue. The only thing that can publish is a
real logged-in session. This script is the single point where a human is involved - you
type the password into a genuine Naver login page in a real browser (2FA and captcha
included), and what gets stored afterwards is cookies, encrypted.

The password itself is never read, passed, or stored by this script.

Same shape as scripts/kakao_get_refresh_token.py: seed a credential once from a trusted
local machine into Turso, and let the deployed service read it from there. The env this
runs with must therefore point at the SAME Turso database as Render, and share the same
NAVER_SESSION_KEY - otherwise the server will hold a row it cannot decrypt.
"""

import argparse
import sys
import time
from pathlib import Path

# Allow `python scripts/naver_login_setup.py` from the backend/ directory.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import naver_session_store  # noqa: E402

BLOG_ID_DEFAULT = "kospi-predictor"

# Only cookies on these domains are kept. A full jar from a browsing session carries
# tracking cookies for every Naver property; the login is carried by the NID_* pair on
# .naver.com, and storing less means less to leak.
KEEP_DOMAINS = (".naver.com", "naver.com", ".blog.naver.com", "blog.naver.com", ".nid.naver.com")
REQUIRED_COOKIES = ("NID_AUT", "NID_SES")

# The login browser runs on a persistent profile rather than a throwaway context, so the
# session lands on disk the moment Naver sets it. The first version of this script only
# held cookies in memory and snapshotted them when it detected the redirect - which
# meant closing the window at any point, including right after a successful login, threw
# the login away and left nothing to recover. With a profile on disk, --harvest can pick
# the session up afterwards with no window open at all.
#
# Lives under app/data/store/, which .gitignore already covers as the local libSQL
# fallback directory - the same reason applies here, only more so.
PROFILE_DIR = Path(__file__).resolve().parent.parent / "app" / "data" / "store" / "naver_profile"


def _filtered(cookies: list[dict]) -> list[dict]:
    return [c for c in cookies if str(c.get("domain", "")).endswith("naver.com")]


def genkey() -> None:
    key = naver_session_store.generate_key()
    print()
    print("=" * 72)
    print("NAVER_SESSION_KEY 를 생성했습니다. 아래 값을 두 곳에 동일하게 설정하세요.")
    print("=" * 72)
    print()
    print(f"  NAVER_SESSION_KEY={key}")
    print()
    print("  1) 로컬 backend/.env       - 이 스크립트가 쿠키를 암호화할 때 사용")
    print("  2) Render 환경변수(Secret) - 서버가 복호화할 때 사용")
    print()
    print("두 값이 다르면 서버는 저장된 세션을 읽지 못합니다.")
    print("이 키는 저장소에 커밋하지 마세요.")
    print()


def login(blog_id: str, timeout_s: int = 420) -> int:
    from playwright.sync_api import sync_playwright

    if not naver_session_store.is_configured():
        print("[!] NAVER_SESSION_KEY 가 설정되지 않았습니다.")
        print("    먼저 `python scripts/naver_login_setup.py --genkey` 를 실행하세요.")
        return 2

    PROFILE_DIR.mkdir(parents=True, exist_ok=True)

    print()
    print("=" * 72)
    print("네이버 로그인 창이 열립니다.")
    print(f"  · 블로그 계정({blog_id})으로 로그인해주세요.")
    print("  · 2단계 인증이 있다면 함께 완료해주세요.")
    print("  · '로그인 상태 유지'를 체크하면 세션이 훨씬 오래 유지됩니다.")
    print()
    print("  로그인이 끝나면 자동으로 감지해 저장합니다.")
    print("  창을 먼저 닫으셔도 괜찮습니다 - 세션은 디스크에 남고, 그럴 때는")
    print("  `--harvest` 로 나중에 수확할 수 있습니다.")
    print("=" * 72)
    print()

    cookies: list[dict] = []
    with sync_playwright() as p:
        # Persistent context: the profile (and therefore the session) is written to disk
        # as Naver sets it, so a closed window is recoverable instead of fatal.
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            headless=False,
            viewport={"width": 1280, "height": 900},
            locale="ko-KR",
            timezone_id="Asia/Seoul",
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined});")
        page.goto(f"https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fblog.naver.com%2F{blog_id}")

        deadline = time.time() + timeout_s
        closed = False
        ticks = 0
        while time.time() < deadline:
            time.sleep(2)
            ticks += 1
            try:
                url = page.url
                jar = _filtered(context.cookies())
            except Exception:
                closed = True
                break

            names = {c["name"] for c in jar}
            have_session = all(n in names for n in REQUIRED_COOKIES)
            on_login_page = "nidlogin" in url or "nid.naver.com" in url

            # A visible heartbeat. The previous version printed nothing for up to seven
            # minutes, so a stalled run was indistinguishable from a working one.
            if ticks % 5 == 0:
                state = "로그인 감지됨" if have_session else ("로그인 페이지" if on_login_page else "대기 중")
                print(f"    [{ticks * 2:>3}초] {state} - 쿠키 {len(jar)}개")

            if have_session and not on_login_page:
                time.sleep(3)  # let Naver finish setting the rest of the session
                cookies = _filtered(context.cookies())
                break

        try:
            context.close()
        except Exception:
            pass

    if not cookies:
        if closed:
            print()
            print("[i] 창이 닫혔습니다. 디스크에 남은 프로필에서 세션을 수확합니다...")
            return harvest(blog_id)
        print("[!] 로그인을 감지하지 못했습니다 (시간 초과).")
        print("    로그인은 완료하셨다면 아래로 수확할 수 있습니다:")
        print("      python scripts/naver_login_setup.py --harvest")
        return 4

    naver_session_store.save(cookies, blog_id, seeded=True)
    names = sorted({c["name"] for c in cookies})
    print()
    print(f"[OK] 세션을 암호화해 저장했습니다. 쿠키 {len(cookies)}개.")
    print(f"     주요 쿠키: {', '.join(n for n in names if n.startswith('NID'))}")
    print()
    print("다음 단계:")
    print("  python scripts/naver_login_setup.py --check     # 세션 동작 확인")
    print("  python scripts/naver_publish_now.py --dry-run   # 발행 직전까지 전체 경로 검증")
    print()
    return 0


def harvest(blog_id: str = BLOG_ID_DEFAULT) -> int:
    """Pulls the session out of the on-disk login profile. No window, no interaction.

    This is the recovery path for "I logged in but the window is closed now" - the
    persistent profile still holds the cookies, so a headless launch on the same
    user_data_dir can read them straight back out.
    """
    from playwright.sync_api import sync_playwright

    if not naver_session_store.is_configured():
        print("[!] NAVER_SESSION_KEY 가 설정되지 않았습니다.")
        return 2

    if not PROFILE_DIR.exists():
        print(f"[!] 로그인 프로필이 없습니다: {PROFILE_DIR}")
        print("    `python scripts/naver_login_setup.py` 를 먼저 실행해 로그인하세요.")
        return 3

    # A running Chromium holds a lock on the profile; Playwright then refuses to launch.
    for lock in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        try:
            (PROFILE_DIR / lock).unlink()
        except Exception:
            pass

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            headless=True,
            locale="ko-KR",
            timezone_id="Asia/Seoul",
            args=["--disable-blink-features=AutomationControlled"],
        )
        try:
            page = context.pages[0] if context.pages else context.new_page()
            page.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
            )
            # Load the blog so Naver refreshes the session before it is snapshotted, and
            # so a dead session shows up here rather than at publish time.
            page.goto(f"https://blog.naver.com/{blog_id}", wait_until="domcontentloaded", timeout=30000)
            landed = page.url or ""
            cookies = _filtered(context.cookies())
        finally:
            try:
                context.close()
            except Exception:
                pass

    names = {c["name"] for c in cookies}
    missing = [n for n in REQUIRED_COOKIES if n not in names]
    if missing:
        print(f"[!] 프로필에 로그인 쿠키가 없습니다 (누락: {', '.join(missing)}).")
        print("    로그인이 완료되지 않았습니다. 다시 실행해 로그인해주세요:")
        print("      python scripts/naver_login_setup.py")
        return 4

    if "nidlogin" in landed or "nid.naver.com" in landed:
        print("[!] 쿠키는 있으나 네이버가 로그인 페이지로 되돌렸습니다 (세션 만료).")
        print("    다시 실행해 로그인해주세요.")
        return 5

    naver_session_store.save(cookies, blog_id, seeded=True)
    print()
    print(f"[OK] 세션을 암호화해 저장했습니다. 쿠키 {len(cookies)}개.")
    print(f"     주요 쿠키: {', '.join(sorted(n for n in names if n.startswith('NID')))}")
    print()
    return 0


def check() -> int:
    from app.services import naver_blog_client

    session = naver_session_store.get()
    if not session:
        print("[!] 저장된 세션이 없거나 복호화할 수 없습니다.")
        print("    NAVER_SESSION_KEY 가 저장 당시와 동일한지 확인하세요.")
        return 2

    print(f"저장 시각 : {session['seeded_at']}")
    print(f"갱신 시각 : {session['refreshed_at']}")
    print(f"최근 성공 : {session['last_ok_at'] or '아직 없음'}")
    print(f"블로그 ID : {session['blog_id']}")
    print(f"쿠키 개수 : {len(session['cookies'])}")
    print()
    print("실제 로그인 상태를 확인하는 중...")

    try:
        fresh = naver_blog_client.keep_alive(session["cookies"])
    except naver_blog_client.NaverSessionExpired as exc:
        print(f"[!] 세션이 만료되었습니다: {exc}")
        print("    `python scripts/naver_login_setup.py` 로 재연동하세요.")
        return 5
    except Exception as exc:
        print(f"[!] 확인 중 오류: {exc}")
        return 6

    if fresh:
        naver_session_store.save(fresh, session["blog_id"])
    print("[OK] 세션이 정상 동작합니다.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="네이버 블로그 최초 1회 연동")
    parser.add_argument("--genkey", action="store_true", help="NAVER_SESSION_KEY 생성")
    parser.add_argument("--harvest", action="store_true", help="이미 로그인한 프로필에서 세션 수확 (창 불필요)")
    parser.add_argument("--check", action="store_true", help="저장된 세션 동작 확인")
    parser.add_argument("--clear", action="store_true", help="저장된 세션 삭제")
    parser.add_argument("--blog-id", default=BLOG_ID_DEFAULT)
    args = parser.parse_args()

    if args.genkey:
        genkey()
        return 0
    if args.harvest:
        return harvest(args.blog_id)
    if args.clear:
        naver_session_store.clear()
        print("[OK] 저장된 세션을 삭제했습니다.")
        return 0
    if args.check:
        return check()
    return login(args.blog_id)


if __name__ == "__main__":
    raise SystemExit(main())
