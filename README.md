# 코스피 종목 예측 (KOSPI Predictor)

종목명을 검색하면 다음날 예상 주가/방향과 근거, 3년치 일봉 차트와 보조지표(이동평균, RSI, MACD, 볼린저밴드 등), 관련 뉴스를 한 화면에서 보여주는 웹앱입니다.

- 예측은 **기술적 지표 + 통계 기반 규칙형 로직**으로 산출되며, 투자 조언이 아닌 참고용입니다.
- 시세: [FinanceDataReader](https://github.com/FinanceData/FinanceDataReader) (무료, API 키 불필요)
- 뉴스: 네이버 금융 종목 뉴스 페이지 크롤링

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
docker build -t kospi-predictor .
docker run -p 8000:8000 kospi-predictor
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
   - 루트의 `render.yaml`을 자동으로 인식해 Docker 웹 서비스(`kospi-predictor`)를 생성합니다.
4. 배포가 완료되면 Render가 발급한 `https://kospi-predictor-xxxx.onrender.com` 형태의 URL로 외부에서 접속할 수 있습니다.
5. 이후 `main` 브랜치에 push할 때마다 자동으로 재배포됩니다 (`autoDeploy: true`).

> 무료 티어는 일정 시간 요청이 없으면 슬립되며, 다음 요청 시 기동까지 수십 초가 걸릴 수 있습니다.

## 프로젝트 구조

```
backend/app/         FastAPI 백엔드 (데이터 수집, 지표 계산, 예측 로직, API)
frontend/src/         React + TypeScript 프론트엔드 (검색, 차트, 예측 카드, 뉴스 패널)
Dockerfile            프론트엔드 빌드 + 백엔드를 하나의 이미지로 묶는 멀티스테이지 빌드
render.yaml           Render 배포 설정
```

## API 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/search?q=` | 종목명/코드 검색 |
| GET | `/api/stock/{code}/summary` | 현재가/등락률 요약 |
| GET | `/api/stock/{code}/history?years=3` | 일봉 OHLCV |
| GET | `/api/stock/{code}/indicators?years=3` | 보조지표 시계열 + 최신값 |
| GET | `/api/stock/{code}/predict` | 다음날 예측(방향/범위/신뢰도/근거/전망) |
| GET | `/api/stock/{code}/news` | 관련 뉴스 |
| GET | `/api/health` | 헬스체크 |
