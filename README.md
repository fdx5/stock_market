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

## 외부 접속 가능하도록 배포하기 (Render, 무료 티어)

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

> 무료 티어는 일정 시간 요청이 없으면 슬립되며, 다음 요청 시 기동까지 수십 초가 걸릴 수 있습니다.

## 프로젝트 구조

```
backend/app/          FastAPI 백엔드 (데이터 수집, 지표 계산, 맵/배틀/수급 서비스, API)
frontend/src/          React + TypeScript 프론트엔드 (대시보드, 맵, 배틀, 수급, 글로벌TOP20, 다국어)
Dockerfile             프론트엔드 빌드 + 백엔드를 하나의 이미지로 묶는 멀티스테이지 빌드
render.yaml            Render 배포 설정
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
| GET | `/api/health` | 헬스체크 |
