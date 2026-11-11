# Search Console 색인 미생성 개선 (2026-11-11)

## 상태별 원인과 조치

| Search Console 상태 | 규모 | 원인 | 조치 |
|---|---|---|---|
| 적절한 표준 태그가 포함된 대체 페이지 | 약 5,200 | 36개 조사 서비스(`/decision-brief`, `/rate-paths` 등)의 `?code=`·`?market=` 변형 URL. canonical은 기본 경로로 정상 | canonical은 유지. `robots.txt`에서 이 변형들(`/<서비스>?`)과 `/news?`, `/desk?`, `/global?`, `/discussion-explorer?` 크롤링 차단으로 크롤링 예산 회수 |
| 크롤링됨 - 색인 미생성 | 약 3,530 | 서버 HTML(SEO 셸)이 종목명만 바뀐 같은 템플릿 문장 | 국내 종목 `/stock/X`, `/outlook`, `/news`에 실제 수치 추가: 종가·등락률, 10거래일 수익률·종가 범위, 외국인·기관·개인 순매매, 시총 순위·시장, 10거래일 표. `/outlook`은 5일·10(20)일 이동평균과 RSI(데이터가 충분할 때). `/stock/X` meta description도 수치로 고유화 |
| 발견됨 - 색인 미생성 | 약 2,930 | 크롤링 예산이 변형 URL에 소모되고, 사이트 전체 품질 신호가 낮음 | 위 두 조치의 간접 효과를 기대. 별도 강제 수단 없음 |
| 리다이렉션이 포함된 페이지 | 36 | `www`·`http` → `https://kospimap.com` 301은 정상. `/news?code=X`는 화면이 주소의 `code`를 지워 리다이렉트로 집계 | 서버에서 `/news?code=X`를 301로 이동: 국내 종목은 `/stock/X/news`, 미국 종목·ETF는 `/stock/X`, 모르는 코드는 `/news`. 내부 링크(뉴스 사실 타임라인)도 직접 종목 페이지로 변경 |

수치 데이터는 `/investor/<code>`와 같은 캐시(`investor_fetcher.get_investor_trend`, 30분)를 공유한다. 데이터가 없으면 기존 셸 그대로 낸다.

## 남은 일
- `/prices/*`, `/dram-price`, `/news`, `/market-radar`, `/sector/*` 등은 여전히 한두 문장짜리 셸이다. 각 페이지의 캐시된 수치를 같은 방식으로 넣으면 다음 개선이 된다.
- 미국 종목 `/stock/<티커>` 셸에도 수치가 없다.
- 색인 여부는 Google의 판단이므로, 배포 후 Search Console에서 "수정사항 확인"을 요청하고 수 주간 추이를 본다.

## 검증
- `backend/tests/test_stock_report_seo.py` 등 SEO 관련 테스트 157개 통과(신규: 종목 수치, 데이터 없을 때 기본 셸, `/news?code` 301, robots 규칙).
- 실제 데이터로 `/stock/005930`, `/stock/000850/outlook`, `/stock/034020/news` 렌더링 확인(읽기 전용).
