"""Create the local implementation handoff without importing the application or DB."""
import json
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs/research-services-local-review-2026-10-25.md"
PDF = ROOT / "output/pdf/research-services-local-review-2026-10-25.pdf"
SCOPE = {
    "/markets": "질문 중심 진입, 36개 서비스 검색·분류, 기존 서비스 연결",
    "/market-inside": "같은 유효 표본의 시총 가중·동일 비중·상위 3종목 제외 비교",
    "/stock-tradeoffs": "같은 시장·업종 후보의 지표 차이와 비교 불가 사유",
    "/recovery-lab": "손실·회복의 비대칭 계산, 선택 종목의 회복 가격 실험",
    "/market-radar": "상승·하락·거래 규모·고점 접근 후보와 후속 비교",
    "/stock-screener": "TOP 100 표본 조건 검색, 조건 URL과 CSV",
    "/stock-compare": "최대 4개 종목의 같은 기준 지표 비교",
    "/sector-strength": "같은 표본 업종의 등락·참여 폭과 포함 종목 확인",
    "/event-impact": "BEA 공식 일정의 전달 경로와 원문 확인. 모든 국가 일정은 아님",
    "/liquidity-quality": "완료된 일봉 거래량을 앞선 20거래일과 비교. 장중 동시간대 상대량은 아님",
    "/stock-context": "종목·기준지수의 실제 공통 날짜 상대 성과, 기준지수 선택",
    "/etf-overlap": "공개 상위 10개 구성종목의 부분 중복과 공개 비중, 동일 날짜 CSV 확장",
    "/etf-tradeoffs": "공개 보수·NAV·분배율 원표와 비저장 비용 가정 계산",
    "/dividend-reality": "과거 배당락·금액과 지급일 구분, 확정 일정 CSV 입력",
    "/currency-lens": "USD 자산과 USD/KRW 공통 날짜 복리 효과. 원화 자산은 계산 제외",
    "/rate-paths": "미국 국채 참고값과 가정 금리 변화의 이자 비용 전달 계산",
    "/commodity-impact": "금·WTI 연속선물 원표와 생산자·소비자 전달 경로. 기업별 확정 노출은 아님",
    "/event-collision": "BEA 일정의 한국시간 충돌·간격 계산과 외부 일정 CSV 확장",
    "/earnings-gap": "수신된 재무 실적·예상 구분. 원천에 기대치가 있을 때만 차이 계산",
    "/signal-crosscheck": "SMA20·단순 RSI14·완료일 거래량을 분리 제시. 종합 확률 없음",
    "/news-evidence": "기존 공개 종목 뉴스의 URL 중복 제거·시간순 근거와 원문 이동",
    "/theme-evidence": "공개 사업 소개의 키워드 근거. 매출·수혜 확정과 구분, CSV 증거 보완",
    "/gap-context": "전일 종가 대비 시가 갭과 당일 시가·종가 움직임 분리",
    "/fundamental-gap": "양수 실제 재무의 기준값 100 비교와 회계기간 말 가격. 공시 당시 재현은 아님",
    "/macro-context": "World Bank 8개국·4개 연간 지표의 같은 연도 비교",
    "/yield-curve-lab": "미국 Treasury 일별 Par Yield 만기 곡선과 직전 관측일 bp 변화",
    "/bond-tradeoffs": "가정 채권 2개의 반기 현금흐름·수익률·가격 충격. 실제 회사채 호가 아님",
    "/crypto-inside": "Upbit KRW 종목의 동일 비중과 BTC·ETH 제외 체감. 세계 시총 지수 아님",
    "/crypto-liquidity": "Upbit 실제 호가 잔량·스프레드와 가정 주문의 부분 체결·미체결 비용",
    "/derivatives-context": "Bybit 동일 USDT 무기한 계약의 가격 괴리·펀딩·미결제약정 기록",
    "/global-peers": "기존 글로벌 TOP 100의 업종·USD 시총·공개 지표 비교",
    "/sector-replay": "명시적으로 추가 기록한 공개 스냅샷의 업종 재현. 과거 기록을 생성하지 않음",
    "/session-planner": "KR·US 휴장표, IANA 서머타임과 알려진 조기 종료를 반영한 14일 일정",
    "/change-digest": "실제로 기록된 두 공개 스냅샷 간 변화. 기록 부족 시 비어 있음",
    "/decision-brief": "공개 관측값·남은 질문·자료 공백 정리, 메모리 메모와 사용자 인쇄/PDF",
    "/data-confidence": "필드별 실제 유효·누락 표본 수와 비교 한계. 가짜 신선도 점수 없음",
}

def main():
    services = json.loads((ROOT / "frontend/src/markets/serviceCatalog.json").read_text(encoding="utf-8"))
    qa = json.loads((ROOT / "tmp/all-research-services-qa/result.json").read_text(encoding="utf-8"))
    assert len(services) == 36 and len(SCOPE) == 36
    assert not qa["errors"]
    intro = """# 신규 서비스 36개 로컬 구현 검토서

작성일: 2026-10-25 / 상태: 로컬 구현·검증 완료, 운영 배포 전 사용자 검토

## 1. 실행 화면과 검토 순서

로컬 주소: http://127.0.0.1:5184/markets

기존 개발 계획의 36개 제안 모두에 실행 가능한 페이지와 왼쪽 메뉴 목적지를 구성했다. 초기 8개에서 나머지 28개를 확장했다. 아래 표는 구현 범위이며, 계획에 제시한 모든 국가·시장·유료 데이터까지 확보했다는 뜻은 아니다.

- 시장 탐색에서 질문 검색 또는 6개 분류를 선택한다.
- 왼쪽 메뉴의 신규 페이지명 뒤 네온 N을 확인한다. 좁은 화면에서는 전체 메뉴 버튼으로 같은 트리를 연다.
- 종목 문맥 비교에서 종목을 바꾸고 관련 질문·기존 종목 원표로 이동한다.
- ETF 중복에서 A·B를 바꾸고 비용 비교로 이동한다. 국내·미국 전환은 호환되는 기본 ETF로 바뀐다.
- 기존 네온 단일 테마, 모바일 메뉴·뒤로 가기·본문 바로가기를 확인한다.

## 2. 기존 화면과의 연결

최근 개편한 I:/ai_root/sm-deploy의 NEO GENESIS를 기준으로 통합했다. 기존 NeoShell의 헤더·왼쪽 트리·Market Pulse·시계·BGM·하단 메뉴·공통 검색을 함께 사용한다. 별도로 만든 신문형 메뉴와 이중 헤더·푸터는 제거했다. 신문형 공통 훅·명조체·주야간 선택을 신규 서비스에서 제거하고, 이전 디자인 전환도 실행 경로에서 제거했다. 기존 네온 개편본의 자주색 배경·보라 네온·황금색과 산호색 강조·고딕 서체·정교한 프레임을 따른다. 기존 종목·ETF·뉴스에는 접을 수 있는 관련 분석 링크를 추가했다.

기존 6개 메뉴의 순서·분류·208px 폭을 유지한다. 신규 상위 분류를 만들지 않고 기존 마켓·인텔리전스·순위·자산 분류의 같은 링크 레벨에 새 목적지를 추가했다. 첫 화면은 기존 주요 링크와 현재 선택한 신규 링크만 표시하고, 나머지는 분류별 작은 ‘더 보기’로 펼친다. 링크 간격을 줄이고 모바일은 기존 전체 서비스 검색을 그대로 쓴다. 공개 종목 코드·시장·ETF 지역을 이어 주고 현재 페이지를 표시한다. 네온 N은 신규 페이지명 뒤에 위치하며 동작 감소 설정을 존중한다.

## 3. 전체 페이지와 실제 구현 범위

모든 아래 항목은 로컬 경로 구현 완료 상태다. 자료 누락·기준일·단위·부분 표본은 해당 화면에서 표시한다.

"""
    rows = ["| 페이지 / 경로 | 구현한 기능과 제공 범위 |", "| --- | --- |"]
    for s in services:
        rows.append(f'| {s["id"]} {s["name"]}<br/>{s["path"]} | {SCOPE[s["path"]]} |')
    tail = f"""

## 4. 검증 결과

- 브라우저 {len(qa['checks'])}개 검사 통과: 36개 경로의 데스크톱·모바일, 가로 넘침, 기존 NEO 메뉴 검색·포커스·N 표시, 종목·ETF 문맥, 뒤로 가기, 비저장 계산, 로컬 CSV. design=classic으로도 신문형으로 복귀하지 않는 것을 확인한다.
- 프런트 계산 테스트 21개와 백엔드 파서·추가 기록 보존 테스트 5개 통과. 기존 DB를 테스트 대상으로 사용하지 않았다.
- TypeScript 검사와 Vite 운영용 번들 생성 통과. 기존의 큰 청크 경고는 남아 있다.
- 실제 공개 원천으로 가격·재무·사업 소개·국내/미국 ETF 상위 보유분·국채·World Bank·BEA·Upbit·Bybit 응답을 별도 확인했다.
- 네온 개편본의 실제 데이터 허브와 왼쪽 메뉴를 별도 캡처해 확인했다. 새 원천 어댑터 17개는 모두 실제 자료로 응답했다. 기존 삼성전자 호가 원천의 일시 502는 별도 원천 장애로 남아 있다.

자동 UI 검사는 합성 응답을 사용하며 실제 응답 확인과 구분한다. 외부 원천의 응답 성공이 향후 지속 가용성·거래 실시간성·사용자 만족도를 보장하지 않는다. 사용자 만족도 실측은 아직 없으며, 실제 검토에서 과제 완료 시간·조건 이해·후속 이동 편의성을 확인해야 한다.

## 5. 자료·개인 입력·저장 보호

기존 TOP 100은 전체시장 표본이 아니다. 일부 ETF는 상위 10개만 제공되고 기준일이 미확인이다. 일정은 기본 BEA 범위, 거시경제는 연간 자료다. 실제 지급일·전 세계 일정·청산 피드·기업 노출·회사채 호가를 지어내지 않는다. 원천이 응답하지 않을 때 오류·누락을 표시한다.

CSV·JSON과 계산 메모·가정 금액은 화면 메모리에서 처리한다. 회원 가입이나 새로운 개인정보 입력을 만들지 않았다. 계산 입력은 URL·로컬 저장소·추적 요청에 포함하지 않는다. 로컬 공개 스냅샷은 사용자가 기록 버튼을 누를 때 별도 JSONL 파일에 추가하며, 과거 기록은 그대로 둔다.

검토 서버는 app.main을 불러오지 않고 기존 DB 초기화·스케줄러를 실행하지 않는다. 새 원천 어댑터와 허용 목록의 운영 공개 GET만 제공한다. 활동·방문 기록은 로컬에서 저장하지 않는다. 기존 데이터 삭제·테이블 교체·DB 초기화를 수행하지 않았다. 기술적 DB 권한 차단을 새로 설정·검증했다고 주장하지 않는다.

## 6. 실행과 다음 작업

- 백엔드: 저장소 루트에서 python scripts/run_discovery_preview.py (127.0.0.1:8000).
- 프런트엔드: frontend에서 node_modules/.bin/vite.cmd --host 127.0.0.1 --port 5184 --strictPort.
- 브라우저 검증: python frontend/scripts/test-all-research-services.py.
- 실제 자료 화면 검토: python scripts/review_research_live.py.
- 기존 조사·제안·144개 초기 작업 목록: docs/tradingview-new-services-plan-2026-10-25.md.
- 화면 검증 결과: tmp/all-research-services-qa/result.json 및 tmp/local-discovery-preview/live-screens/result.json.

사용자 로컬 검토와 수정 반영 후 운영 배포를 진행한다. 이번 작업에서는 운영 배포를 실행하지 않았다. 운영 환경의 외부 원천 가용성·스냅샷 경로 영속성·기존 데이터 권한 구성을 배포 시 확인한다.
"""
    markdown = intro + "\n".join(rows) + tail
    DOC.write_text(markdown, encoding="utf-8")
    spec = importlib.util.spec_from_file_location("plan_report", ROOT / "scripts/build_market_discovery_report.py")
    report = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(report)
    report.PDF = PDF
    report.build_pdf(markdown.replace("<br/>", " "))
    print(json.dumps({"markdown": str(DOC), "pdf": str(PDF), "pages": len(services), "browser_checks": len(qa['checks'])}))

if __name__ == "__main__":
    main()
