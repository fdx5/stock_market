"""One-time setup script: exchanges a Kakao OAuth authorization code for an
access/refresh token pair and stores it directly via kakao_token_store, so the
backend's hourly notification job (see app/services/kakao_notify.py) can start
sending "나에게 보내기" KakaoTalk messages without any further manual token handling.

Run this once locally (from backend/, with the venv active):

    python scripts/kakao_get_refresh_token.py

Before running, in Kakao Developers (developers.kakao.com) for this app:
  1. 제품 설정 > 카카오 로그인 > 활성화 설정 ON
  2. Same screen > Redirect URI 등록 (any URI works — you only need to read the
     `code` value back out of the address bar after Kakao redirects there; it does
     not need to be a live server). Put that same URI in backend/.env as
     KAKAO_REDIRECT_URI, or this script will prompt for it.
  3. 카카오 로그인 > 동의항목 > "카카오톡 메시지 전송" (talk_message) 활성화 — required,
     or the send call in kakao_notify.py will fail with a 403.
  4. KAKAO_REST_API_KEY must already be set in backend/.env (the REST API key from
     앱 키, not the JavaScript key).

This script writes into whichever database backend/.env currently points at — if
TURSO_DATABASE_URL/TURSO_AUTH_TOKEN are set there (the same variables the running
service uses in prod, per render.yaml), run this once with those set to seed Kakao's
token directly into the production database. Otherwise it falls back to the local
libSQL file the dev server also uses, same as every other *_store.py module here.
"""

import sys
import webbrowser
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import os  # noqa: E402

from app.services import kakao_token_store  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

TOKEN_URL = "https://kauth.kakao.com/oauth/token"
AUTHORIZE_URL = "https://kauth.kakao.com/oauth/authorize"


def _mask(token: str) -> str:
    if len(token) <= 12:
        return "***"
    return f"{token[:6]}...{token[-4:]}"


def main() -> None:
    client_id = os.environ.get("KAKAO_REST_API_KEY")
    if not client_id:
        print("KAKAO_REST_API_KEY가 backend/.env에 설정되어 있지 않습니다. 먼저 설정해 주세요.")
        sys.exit(1)

    redirect_uri = os.environ.get("KAKAO_REDIRECT_URI")
    if not redirect_uri:
        redirect_uri = input(
            "Kakao Developers에 등록한 Redirect URI를 입력하세요 (예: https://localhost:3000/oauth): "
        ).strip()
    if not redirect_uri:
        print("Redirect URI가 필요합니다.")
        sys.exit(1)

    client_secret = os.environ.get("KAKAO_CLIENT_SECRET")

    authorize_url = (
        f"{AUTHORIZE_URL}?client_id={client_id}&redirect_uri={redirect_uri}"
        "&response_type=code&scope=talk_message"
    )
    print("\n아래 URL을 브라우저에서 열어 카카오 로그인 및 동의를 진행하세요:")
    print(authorize_url)
    print()
    try:
        webbrowser.open(authorize_url)
    except Exception:
        pass

    pasted = input(
        "동의 후 리다이렉트된 주소 전체(또는 code= 값만)를 붙여넣으세요: "
    ).strip()

    if pasted.startswith("http"):
        query = parse_qs(urlparse(pasted).query)
        code = query.get("code", [None])[0]
    else:
        code = pasted

    if not code:
        print("code 값을 찾을 수 없습니다. URL 전체 또는 code 파라미터 값을 다시 확인하세요.")
        sys.exit(1)

    payload = {
        "grant_type": "authorization_code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "code": code,
    }
    if client_secret:
        payload["client_secret"] = client_secret

    resp = requests.post(TOKEN_URL, data=payload, timeout=10)
    if not resp.ok:
        print(f"토큰 발급 실패 ({resp.status_code}): {resp.text}")
        sys.exit(1)
    data = resp.json()

    now = datetime.now(timezone.utc)
    access_token = data["access_token"]
    refresh_token = data["refresh_token"]
    access_expires_at = (now + timedelta(seconds=data["expires_in"])).isoformat()
    refresh_expires_at = (
        (now + timedelta(seconds=data["refresh_token_expires_in"])).isoformat()
        if "refresh_token_expires_in" in data
        else None
    )

    kakao_token_store.save(access_token, refresh_token, access_expires_at, refresh_expires_at, now.isoformat())

    print("\n토큰 저장 완료.")
    print(f"  access_token  : {_mask(access_token)} (만료: {access_expires_at})")
    print(f"  refresh_token : {_mask(refresh_token)} (만료: {refresh_expires_at or '알 수 없음'})")
    print(
        "\n다음으로, 배포 환경(Render)에 KAKAO_REST_API_KEY / KAKAO_NOTIFY_TOKEN 환경변수가 "
        "설정되어 있는지 확인하세요 (README/PR 설명 참고). 이 스크립트가 사용한 것과 같은 "
        "TURSO_DATABASE_URL/TURSO_AUTH_TOKEN을 가리키고 있었다면 토큰은 이미 운영 DB에 저장된 상태입니다."
    )


if __name__ == "__main__":
    main()
