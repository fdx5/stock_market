# K-Stock Hub (코스피/코스닥 대시보드)

종목명을 검색하면 실시간 시세, 3년치 일봉 차트와 보조지표(이동평균, RSI, MACD, 볼린저밴드 등), 호가창, 관련 뉴스, 종목토론방을 한 화면에서 보여주는 웹앱입니다. 이 외에도 코스피/코스닥 전 종목을 한눈에 보는 트리맵, 삼성전자 vs SK하이닉스 시가총액 배틀, 외국인/기관 수급 동향, 글로벌 시가총액 TOP20 페이지를 함께 제공합니다.

- 시세: [FinanceDataReader](https://github.com/FinanceData/FinanceDataReader) + 네이버 금융 (무료, API 키 불필요)
- 뉴스·종목토론방·호가: 네이버 금융 크롤링
- 한국어/영어 자동 전환 지원 (접속 국가 기반 기본값 + 수동 토글)

## 주요 기능

- **종목 대시보드**: 검색, 실시간 시세, 3년 일봉 차트 + 보조지표, 10호가 창, 관련 뉴스, 종목토론방(댓글 포함), 기업 개요
- **코스피/코스닥 맵**: 시가총액 크기 + 등락률 색상의 트리맵(히트맵), 섹터 필터
- **배틀**: 삼성전자 vs SK하이닉스 실시간 시가총액 줄다리기, 실시간 환율, 응원 댓글
- **수급 동향**: 종목별 외국인/기관 순매수 추이, 주간 외국인 순매수 상위 종목
- **글로벌 TOP20**: 전 세계 시가총액 상위 20개 기업
- **지수 차트**: 코스피/코스닥 지수 차트
- **AI 종목예측**(`/ai-prediction`): 코스피·코스닥 시총 TOP10, 나스닥 시총 TOP10 + AMD·인텔·마이크론·샌디스크에 대해 장 마감 직후 배치가 익일 시세·방향을 예측. 단순 방향이 아니라 **상승/보합/하락 확률, 예측 신뢰도, 당일 장 마감 원인 설명, 실제 사용된 근거 데이터, 예측 대비 실제 적중률**을 함께 기록해 예측의 이유와 성과를 검증할 수 있게 합니다. 날짜 네비게이터로 과거 예측과 그 채점 결과를 넘겨볼 수 있음

## 기술 스택

### Backend
- **Python 3.11 + FastAPI**, Uvicorn(ASGI)으로 서빙, 단일 워커(`WEB_CONCURRENCY=1`)
  - 캐시가 프로세스 내부 메모리에 상주하므로 워커를 늘리면 캐시가 파편화되기 때문에 의도적으로 1로 고정
- 주요 라이브러리: `pandas`, `numpy`, `finance-datareader`, `beautifulsoup4`+`lxml`(크롤링), `pydantic`, `libsql`(Turso 클라이언트)
- 구조: `routers/`(HTTP 레이어) → `services/`(비즈니스 로직) → `data/`(외부 소스별 fetcher)

### Frontend
- **React 18 + TypeScript**, 빌드는 **Vite**
- 라우팅은 외부 라이브러리 없이 `window.history.pushState` 기반 자체 구현
- 차트: TradingView **lightweight-charts**
- CSS: 프레임워크 없이 순수 CSS 한 파일 (Tailwind/CSS-in-JS 미사용)
- 라우트별 코드 스플리팅 적용

### 데이터 저장
전통적인 RDB는 사용하지 않습니다.
- **시세/지표/번역 데이터**: 전부 자체 구현 **인메모리 TTL 캐시**로만 존재 (DB 테이블 없음). TTL은 데이터 성격에 따라 10초~24시간까지 다양
- **영구 저장이 필요한 것만 Turso(libSQL)**: 배틀 응원 댓글, 누적 방문자 수 딱 2가지. 로컬 개발 시 Turso 환경변수가 없으면 로컬 SQLite 파일로 자동 폴백

캐시 아키텍처는 **single-flight**(동시 요청 몰려도 upstream fetch는 1번만 실행)와 **stale-while-revalidate**(만료돼도 옛 데이터를 즉시 반환하고 백그라운드에서 갱신)를 자체 구현해 사용 중이며, 서버 기동 시 주요 데이터를 미리 워밍업합니다.

### 외부 연동 (전부 무료, API 키 불필요)
- **네이버 금융** 크롤링: 실시간 시세, 뉴스, 종목토론방, 10호가 창, 투자자 매매동향
- **Yahoo Finance** 비공식 차트 API: 원자재/환율/미국지수 등 상단 시세 티커
- **Google Translate** 비공식 엔드포인트: 동적 텍스트 번역 (배치 처리 + SHA1 해시 기반 7일 캐시)
- **ip-api.com**: 접속 국가 기반 기본 언어 결정
- **companiesmarketcap.com**: 글로벌 시가총액 TOP20 크롤링

### 예측 기능
- 대시보드의 단일 종목 예측(`predictor.py`)은 머신러닝이 아니라 **룰 베이스 휴리스틱**입니다 — SMA/RSI/MACD/볼린저밴드/OBV 등 기술적 지표 점수를 조합해 다음날 방향을 예측합니다.
- **AI 종목예측 배치**는 별도 파이프라인입니다. 예측 가중치는 **차트 추이 + 호가 40%**(`prediction_engine.py`, 내부적으로 차트 70 / 호가 30) + **뉴스·수급·지수·섹터 등 정성 판단 60%**(`ai_analyst.py`)로 고정. 60% 레이어는 `ANTHROPIC_API_KEY`가 설정되면 **Claude(기본 `claude-opus-4-8`)** 가 시장 전체 로스터를 한 번의 호출로 읽고 종목별 점수·근거를 생성하며, 키가 없으면 금융 특화 감성사전 + 매크로 휴리스틱으로 자동 폴백해 키 없이도 배치가 동작합니다. 결과는 `stock_predictions` 테이블에 `(수집일자, 종목코드)` 유니크로 upsert되어 재실행이 중복이 아닌 갱신이 됩니다.
- **예측시세는 종목별 호가 단위로 스냅**됩니다(`prediction_universe.snap_to_tick`). KRX 7단계 호가 가격 단위(2023-01-25 개편, 코스피·코스닥 공통 — 2천원 미만 1원 … 50만원 이상 1,000원)를 적용해 삼성전자를 `245,234원`처럼 호가창에 존재할 수 없는 값으로 표시하지 않습니다. 미국 종목은 $0.01. 증감률은 스냅된 가격에서 다시 계산하므로 기준 종가 → 예측 시세 → 증감률이 항상 서로 일치합니다.
- **예측이 자기 자신을 설명합니다**(`prediction_quality.py`). 한 행은 방향만이 아니라 다음을 함께 저장합니다:
  - **방향 확률**(`prob_up`/`prob_flat`/`prob_down`, 합계 정확히 100): 예상 등락률을 평균, 종목의 20일 실현변동성을 표준편차로 하는 정규분포에서 ±`flat_band` 바깥 꼬리를 적분한 값.
  - **보합 밴드**(`flat_band`): `max(0.4%, 20일 변동성 × 0.35)`. **방향 판정·확률·사후 채점이 모두 이 하나의 밴드를 씁니다** — 예측할 때와 채점할 때 기준이 달라 억울하게 오답 처리되는 일이 없도록.
  - **예측 신뢰도**(`reliability` 0~100 + 등급 + 사유 목록): 확신도(지표가 얼마나 쏠렸나)와 구분되는 별개 축으로, 데이터 결측·시세 지연·변동성 확대·40%와 60%의 방향 충돌·휴리스틱 폴백 여부를 감점합니다. 신뢰도가 낮을수록 위 확률 분포를 더 넓게(33/33/33에 가깝게) 계산하므로, 배지로만 붙는 값이 아니라 실제 출력에 영향을 줍니다.
  - **장 마감 설명**(`close_summary`, `close_change_rate`): 수집일 종가가 왜 그렇게 끝났는지를 지수·업종/동일시장 평균·수급·거래량·환율로 서술하고, **지수 영향과 종목 고유 변동을 %p로 분해**합니다. Claude가 있으면 헤드라인까지 읽고 직접 작성하고, 없으면 결정론적 문장으로 폴백합니다.
  - **근거 데이터**(`evidence`): 주가/거래량/수급/호가/업종지수/환율/뉴스 중 **실제로 계산에 들어간 항목만** 방향(호재/악재)과 함께 기록합니다. 수집 실패한 카테고리는 목록에서 빠지고, 그 사실은 신뢰도 사유에 남습니다.
- **예측 vs 실제 채점**(`prediction_grader.py`): 각 배치는 예측 생성 전에 먼저 채점을 돌립니다 — 방금 끝난 세션이 바로 어제 예측이 겨냥한 날이기 때문입니다. 예측일 종가를 가져와 `actual_price`/`actual_change_rate`/`actual_result`/`hit`/`graded_at`을 채우고, 종목별 **최근 20거래일·60거래일·전체 적중률**과 세션별 성적표를 API로 제공합니다. 종가가 아직 안 나온 행은 오답이 아니라 미채점으로 남아 다음 실행에서 다시 시도합니다(10일 초과 시 확인 불가로 확정).
- **배치 트리거**: `POST /api/prediction/run?region=KR|US`(`Authorization: Bearer $PREDICTION_BATCH_TOKEN`). 한국장(코스피·코스닥)은 KRX 마감(15:30 KST) 직후, 미국장(나스닥)은 뉴욕장 마감(16:00 ET) 직후에 각각 독립 실행. 다음 개장 거래일은 주말·공휴일을 반영한 `trading_calendar.py`가 계산합니다. 1차 트리거는 GitHub Actions cron(`.github/workflows/ai-prediction.yml`, 마감 15분 후, 미국장은 서머타임 두 슬롯), 2차 안전망은 백엔드 인프로세스 스케줄러(`prediction_batch.start_scheduler`) — 둘 다 idempotent한 같은 `run_batch`를 호출하므로 먼저 도달한 쪽이 저장하고 다른 쪽은 skip합니다.

### 배포/인프라
- **Render**(Docker 멀티스테이지 빌드: `node:20-alpine`으로 프론트 빌드 → `python:3.11-slim`에 백엔드+빌드 결과물을 합쳐 단일 컨테이너로 API+SPA 동시 서빙), **standard 플랜(2GB RAM/1CPU)**
- GitHub Actions cron(10분마다)이 헬스체크와 캐시 워밍을 겸함. AI 종목예측 배치는 별도 cron 워크플로(`ai-prediction.yml`)로 실행 (별도 테스트 CI는 없음)
- **AI 종목예측 관련 환경변수** — Render 대시보드(또는 로컬 `backend/.env`)에 설정:
  - `PREDICTION_BATCH_TOKEN`(필수): 배치 트리거 엔드포인트의 공유 시크릿. **미설정 시 `/api/prediction/run`이 503으로 비활성화**되어 공개된 배치 트리거가 남지 않음. GitHub 저장소 Secrets에도 같은 값을 등록해야 cron이 인증됨.
  - `ANTHROPIC_API_KEY`(선택): 있으면 60% 정성 판단을 Claude가 수행, 없으면 내장 휴리스틱으로 폴백. `PREDICTION_AI_MODEL`(기본 `claude-opus-4-8`), `PREDICTION_AI_EFFORT`(기본 `high`)로 조정 가능.
  - `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`(선택): 예측 이력을 Turso에 영구 저장. 미설정 시 `app/data/store/predictions.db` 로컬 파일로 폴백(git-ignored, 컨테이너 재시작 시 초기화).

## 로컬 실행 (개발 모드)

### 1) 백엔드

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # (Windows) / source .venv/bin/activate (macOS/Linux)
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 2) 프론트엔드

```bash
cd frontend
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 접속 (Vite dev 서버가 `/api` 요청을 8000번 백엔드로 프록시합니다).

## Docker로 프로덕션 빌드 실행

리포지토리 루트에서:

```bash
docker build -t k-stock-hub .
docker run -p 8000:8000 k-stock-hub
```

`http://localhost:8000` 접속 시 프론트엔드(정적 빌드)와 API가 하나의 컨테이너에서 함께 서빙됩니다.

## 외부 접속 가능하도록 배포하기 (Render)

1. 이 리포지토리를 GitHub에 push 합니다.
   ```bash
   git remote add origin <your-github-repo-url>
   git branch -M main
   git push -u origin main
   ```
2. [Render](https://render.com)에 GitHub 계정으로 가입/로그인합니다.
3. 대시보드에서 **New +** → **Blueprint** 선택 후 이 GitHub 저장소를 연결합니다.
   - 루트의 `render.yaml`을 자동으로 인식해 Docker 웹 서비스를 생성합니다.
4. 배포가 완료되면 Render가 발급한 URL로 외부에서 접속할 수 있습니다.
5. 이후 `main` 브랜치에 push할 때마다 자동으로 재배포됩니다 (`autoDeploy: true`).

> 현재 `standard` 플랜(2GB RAM/1CPU)으로 운영 중이며, `backend/.env`(로컬) 또는 Render 대시보드(운영)에 `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`을 설정해야 배틀 댓글/방문자 수가 재배포 이후에도 유지됩니다. 설정하지 않으면 로컬 파일로 자동 폴백되어 컨테이너가 재시작될 때 초기화됩니다.

## 프로젝트 구조

```
backend/app/routers/   HTTP 레이어 (battle, geo, investor, market_map, search, stock, translate, visitors)
backend/app/services/  비즈니스 로직 (cache, battle, comment_store, indicators, investor_summary, market_map, predictor, translation, visitor_store 등)
backend/app/data/      외부 소스별 fetcher (네이버 금융, Yahoo Finance, Google Translate 등 크롤링/호출 계층)
frontend/src/          React + TypeScript 프론트엔드 (대시보드, 맵, 배틀, 수급, 글로벌TOP20, 다국어 i18n)
Dockerfile              프론트엔드 빌드 + 백엔드를 하나의 이미지로 묶는 멀티스테이지 빌드
render.yaml             Render 배포 설정
.github/workflows/      keep-alive.yml (cron 헬스체크 + 캐시 워밍)
```

## API 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/search?q=` | 종목명/코드 검색 |
| GET | `/api/stock/{code}/summary` | 현재가/등락률 요약 |
| GET | `/api/stock/{code}/quote` | 실시간 시세 (단기 폴링용) |
| GET | `/api/stock/{code}/orderbook` | 10호가 창 |
| GET | `/api/stock/{code}/history?years=3` | 일봉 OHLCV |
| GET | `/api/stock/{code}/indicators?years=3` | 보조지표 시계열 + 최신값 |
| GET | `/api/stock/{code}/overview` | 기업 개요 |
| GET | `/api/stock/{code}/news` | 관련 뉴스 |
| GET | `/api/stock/{code}/board` | 종목토론방 게시글 목록 |
| GET | `/api/stock/{code}/board/{nid}` | 종목토론방 게시글 상세 |
| GET | `/api/stock/{code}/board/{nid}/comments` | 종목토론방 댓글 |
| GET | `/api/market/map` | 코스피 트리맵 |
| GET | `/api/market/kosdaq-map` | 코스닥 트리맵 |
| GET | `/api/market/ticker` | 상단 시세 티커 |
| GET | `/api/market/index/{symbol}/history` | 코스피/코스닥 지수 차트 |
| GET | `/api/investor/indices` | 코스피/코스닥 지수 + 수급 요약 |
| GET | `/api/investor/summary` | 외국인/기관 수급 요약 |
| GET | `/api/investor/weekly-foreign-top` | 주간 외국인 순매수 상위 |
| GET | `/api/investor/{code}` | 종목별 수급 추이 |
| GET | `/api/battle/status` | 삼성전자 vs SK하이닉스 시가총액 배틀 |
| GET | `/api/battle/exchange` | 실시간 환율 |
| GET/POST | `/api/battle/comments` | 배틀 응원 댓글 |
| GET | `/api/battle/global-top20` | 글로벌 시가총액 TOP20 |
| GET | `/api/battle/global-top20/detail` | 글로벌 TOP20 기업 상세 |
| POST | `/api/translate` | 텍스트 일괄 영어 번역 |
| GET | `/api/geo/country` | 접속 국가 조회 (언어 기본값 결정용) |
| GET | `/api/prediction` | 특정 예측일자의 종목별 예측 (시장별 그룹) |
| GET | `/api/prediction/dates` | 예측 데이터가 있는 거래일 목록 (날짜 네비게이터) |
| GET | `/api/prediction/stock/{code}` | 종목별 예측 이력 + 실제 결과 + 적중률 |
| GET | `/api/prediction/accuracy` | 시장별·세션별 적중률 (최근 20/60거래일, 전체) |
| POST | `/api/prediction/run?region=KR\|US` | 예측 배치 실행 (토큰 필요, cron 트리거용) |
| GET | `/api/health` | 헬스체크 |
