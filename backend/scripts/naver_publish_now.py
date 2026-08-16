"""Manual trigger for the Naver blog publish batch.

    cd backend
    python scripts/naver_publish_now.py --dry-run              # 발행 직전까지만
    python scripts/naver_publish_now.py --date 2026-08-17      # 실제 발행
    python scripts/naver_publish_now.py --status               # 발행 이력 조회

--dry-run drives the entire path - session, navigation, documentModel injection,
normalization read-back - and stops before the publish click. It is the safe way to
prove the pipeline against the real account without putting a post on the blog, and it
is what should be run first after any change to the document model.
"""

import argparse
import datetime as dt
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import naver_publish_store, naver_publisher  # noqa: E402

KST = ZoneInfo("Asia/Seoul")


def show_status(limit: int) -> int:
    rows = naver_publish_store.recent(limit)
    if not rows:
        print("발행 이력이 없습니다.")
        return 0
    print(f"{'날짜':<12} {'종목':<10} {'상태':<11} {'시도':<4} {'주소'}")
    print("-" * 88)
    for r in rows:
        url = r["post_url"] or (r["last_error"] or "")[:40]
        print(f"{r['report_date']:<12} {r['market']:<10} {r['status']:<11} {r['attempts']:<4} {url}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="네이버 블로그 발행 수동 실행")
    parser.add_argument("--date", help="리포트 날짜 (YYYY-MM-DD). 기본값: 오늘 KST")
    parser.add_argument("--dry-run", action="store_true", help="발행 직전까지만 수행")
    parser.add_argument("--status", action="store_true", help="발행 이력 출력")
    parser.add_argument("--market", action="append", help="특정 종목만 (반복 지정 가능)")
    parser.add_argument("--reset", action="store_true", help="재시도 횟수 초기화 (발행완료 건은 제외)")
    parser.add_argument("--limit", type=int, default=30)
    args = parser.parse_args()

    if args.status:
        return show_status(args.limit)

    report_date = args.date or dt.datetime.now(KST).date().isoformat()

    if args.reset:
        markets = args.market or [None]
        total = sum(naver_publish_store.reset(report_date, m) for m in markets)
        print(f"[{report_date}] {total}건 초기화 (발행 완료 건은 유지)")
        return 0
    print(f"[{report_date}] 발행 배치 시작 (dry_run={args.dry_run})")

    result = naver_publisher.run(
        report_date, dry_run=args.dry_run, triggered_by="manual", only=args.market
    )

    print()
    print(f"상태   : {result['status']}")
    print(f"성공   : {len(result.get('published', []))}건")
    for item in result.get("published", []):
        print(f"         · {item['market']}: {item['url']}")
    if result.get("verified"):
        print(f"검증   : {len(result['verified'])}건 (발행 직전까지 확인)")
        for item in result["verified"]:
            print(f"         · {item['market']}: 컴포넌트 {item['components']}개 / "
                  f"본문 {item['chars']:,}자")
            print(f"           제목: {(item.get('title') or '')[:70]}")
    print(f"실패   : {len(result.get('failed', []))}건")
    for item in result.get("failed", []):
        print(f"         · {item['market']}: {item['error']}")
    if result.get("skipped"):
        print(f"건너뜀 : {', '.join(result['skipped'])} (claim 실패 - 이미 발행됐거나 재시도 한도 초과)")

    return 0 if result["status"] in ("ok", "nothing_to_do") else 1


if __name__ == "__main__":
    raise SystemExit(main())
