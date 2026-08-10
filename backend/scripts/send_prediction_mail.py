"""Manage prediction-mail subscriptions, and run the send.

    # 구독 등록 / 해지 / 조회  (주소는 출력에서 항상 마스킹됩니다)
    python -m scripts.send_prediction_mail subscribe   --email you@naver.com --codes 005930,000660
    python -m scripts.send_prediction_mail unsubscribe --email you@naver.com [--codes 005930]
    python -m scripts.send_prediction_mail list

    # 발송 (구독 테이블 기준)
    python -m scripts.send_prediction_mail send --dry-run
    python -m scripts.send_prediction_mail send --date 20260811

    # 구독과 무관하게 한 번만 보낼 때
    python -m scripts.send_prediction_mail send --to you@naver.com --codes 005930 --date 20260811

    # 템플릿만 확인 (메일 발송 없음, SMTP 설정 불필요)
    python -m scripts.send_prediction_mail preview --codes 000660 --date 20260811 --out mail.html

Rows come from the same store the site renders, so a mail and the page can never
disagree about a session. SMTP credentials come from the environment
(PREDICTION_MAIL_*); `--dry-run` and `preview` need none.
"""

import argparse
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:  # backend/.env, same convention as the rest of the app
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except ImportError:  # python-dotenv is optional; env vars may already be exported
    pass

from app.services import mail_subscription_store as subs  # noqa: E402
from app.services import prediction_mail  # noqa: E402

SMTP_HELP = (
    "SMTP 설정이 없습니다. backend/.env 에 다음을 채우세요:\n"
    "  PREDICTION_MAIL_USER      발신 계정 (예: you@naver.com)\n"
    "  PREDICTION_MAIL_PASSWORD  네이버 '애플리케이션 비밀번호'\n"
    "  PREDICTION_MAIL_SMTP_HOST 기본값 smtp.naver.com\n"
    "  PREDICTION_MAIL_SMTP_PORT 기본값 587\n"
    "수신 주소는 이제 구독 테이블에서 읽습니다 — subscribe 명령을 쓰세요."
)


def _codes(raw: str | None) -> list[str]:
    return [c.strip() for c in (raw or "").split(",") if c.strip()]


def _dump(obj) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def main() -> int:
    parser = argparse.ArgumentParser(description="종목별 예측 결과 메일")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("subscribe", help="메일 주소를 종목에 구독 등록")
    p.add_argument("--email", required=True)
    p.add_argument("--codes", required=True, help="쉼표로 구분한 종목코드")

    p = sub.add_parser("unsubscribe", help="구독 해지 (--codes 생략 시 주소 전체)")
    p.add_argument("--email", required=True)
    p.add_argument("--codes")

    sub.add_parser("list", help="구독 현황 (주소 마스킹)")

    p = sub.add_parser("send", help="구독 테이블 기준 발송")
    p.add_argument("--date", help="예측일자 YYYYMMDD. 생략 시 종목별 최신")
    p.add_argument("--to", help="구독을 무시하고 이 주소로만 1회 발송")
    p.add_argument("--codes", help="--to 와 함께 쓰는 1회성 종목 목록")
    p.add_argument("--dry-run", action="store_true", help="발송하지 않고 대상만 출력")

    p = sub.add_parser("preview", help="HTML 본문만 생성")
    p.add_argument("--codes", required=True)
    p.add_argument("--date")
    p.add_argument("--out", required=True)

    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    if args.cmd == "subscribe":
        _dump(subs.subscribe(args.email, _codes(args.codes)))
        return 0

    if args.cmd == "unsubscribe":
        _dump(subs.unsubscribe(args.email, _codes(args.codes) or None))
        return 0

    if args.cmd == "list":
        _dump({"count": subs.count(), "targets": subs.list_targets()})
        return 0

    if args.cmd == "preview":
        from app.services import prediction_grader, prediction_store

        code = _codes(args.codes)[0]
        row = prediction_mail._pick_row(code, args.date)
        if row is None:
            print(f"{code}: 예측 이력이 없습니다.", file=sys.stderr)
            return 1
        acc = prediction_grader.accuracy_summary((code,)).get(code)
        history = prediction_store.list_by_code(code, limit=30)
        Path(args.out).write_text(prediction_mail.build_html(row, acc, history), encoding="utf-8")
        print(f"제목: {prediction_mail.build_subject(row)}")
        print(f"본문 저장: {args.out}")
        return 0

    # send
    if not args.dry_run and not (
        prediction_mail.SMTP_USER and prediction_mail.SMTP_PASSWORD
    ):
        print(SMTP_HELP, file=sys.stderr)
        return 2

    if args.to:
        report = prediction_mail.send_watchlist(
            codes=tuple(_codes(args.codes)) or prediction_mail.DEFAULT_WATCHLIST,
            predict_date=args.date,
            to_addr=args.to,
            dry_run=args.dry_run,
        )
        _dump(report)
        return 1 if report.get("failed") else 0

    report = prediction_mail.send_subscriptions(predict_date=args.date, dry_run=args.dry_run)
    _dump(report)
    failed = any(r.get("failed") or r.get("error") for r in report.get("results", []))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
