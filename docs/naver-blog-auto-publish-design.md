# 장마감 리포트 → 네이버 블로그 자동 포스팅 설계 문서

작성일: 2026-08-17
상태: **구현 완료 — 최초 1회 연동 대기**

확정된 결정
- 발행 방식: **documentModel 주입 + 에디터 발행 트리거**, 성공 판정은 RabbitWrite 응답의 `logNo`
- 실행 위치: **Render 컨테이너** (§3의 세션 리스크를 인지한 상태에서 선택. keep-alive·쿠키 재저장·만료 즉시 알림으로 완화)
- 기존 Gemini 파일 4개: **전량 삭제**
- 본문: **리포트 전문**

---

## 1. 기존 코드베이스 조사 결과

### 1.1 리포트 생성 트리거

요청서에는 "cron, Celery beat, APScheduler, 자체 배치 중 무엇인지 미파악"으로 되어 있었으나, 조사 결과 **셋 다 아니고 자체 데몬 스레드**다.

| 항목 | 내용 |
|---|---|
| 위치 | `backend/app/services/market_brief.py:433-450` (`_loop`, `start_scheduler`) |
| 기동 | `backend/app/main.py:376-378` FastAPI `@app.on_event("startup")` |
| 스레드명 | `market-brief-batch` (daemon) |
| 주기 | `time.sleep(300)` — 5분 폴링 |
| 발화 조건 | `weekday() < 5` **AND** `time >= 16:10 KST` **AND** `done != 오늘` |
| 실제 발화 시각 | 16:10:00 ~ 16:14:59 사이 (루프 위상이 프로세스 startup 시각에 종속) |
| 중복 방지 | `done` 변수(프로세스 메모리) + `generate()`의 저장본·버전 체크 |

Celery도 APScheduler도 없다. GitHub Actions cron도 market brief에는 없다 (`prediction`, `dram-price`, `global-top100`에만 존재).

### 1.2 리포트 저장 위치 — "생성 완료"를 알 수 있는 지점

| 항목 | 내용 |
|---|---|
| 모듈 | `backend/app/services/market_brief_store.py` |
| 저장소 | Turso (`TURSO_DATABASE_URL`) / 미설정 시 로컬 SQLite |
| 테이블 | `market_close_briefs(report_date, market, payload, created_at)`, PK `(report_date, market)` |
| 쓰기 시점 | `market_brief.py:326`(종목), `:415`(지수) — 각 건 생성 직후 개별 커밋 |

**완료 감지 지점은 3개 후보가 있고, 그중 1번이 이미 존재한다:**

1. **`run_all()` 반환 직후** (`market_brief.py:440`) — 7건 전부 커밋된 뒤. 이미 이 자리에서
   `schedule_blog_export_after_brief()`가 호출되고 있다. **이걸 그대로 쓰면 된다.**
2. `market_brief_store.save()` 훅 — 건별 이벤트. 7번 발생하므로 배치 트리거로는 부적합.
3. DB 폴링 (`dates()`로 오늘 날짜 7건 존재 확인) — 프로세스 외부(로컬 워커)에서 감지할 때 필요.

### 1.3 이미 존재하는 +5분 체이닝

`backend/app/services/naver_blog_exporter.py:277-288`

```python
def schedule_blog_export_after_brief():
    def _delayed_run():
        time.sleep(300)          # ← 요구사항의 +10분으로 바꿀 지점
        export_all_blog_posts(today_str)
    threading.Thread(target=_delayed_run, daemon=True, name="naver-blog-exporter").start()
```

즉 **"+N분 뒤 체이닝" 구조는 이미 있다.** 300 → 600으로 바꾸고, `export_all_blog_posts`(HTML 파일 쓰기) 뒤에 발행 단계를 붙이면 된다.

### 1.4 배포 환경 (요청서 가정과 다른 부분)

| 항목 | 실제 |
|---|---|
| 호스팅 | Render, `render.yaml` → **`plan: standard`** (상시 구동 맞음. `main.py` 주석의 free-tier sleep 언급은 오래된 내용) |
| 런타임 | Docker `python:3.11-slim` + Node 20 (Claude Code CLI용) |
| 웹 프레임워크 | **FastAPI** (Django/Flask 아님) |
| 워커 | `WEB_CONCURRENCY=1` — 단일 프로세스라 in-process 스레드 스케줄러가 중복 실행되지 않음 |
| **Playwright** | **`requirements.txt`에 없음.** 컨테이너에 브라우저 자체가 없음 |

### 1.5 기존 Gemini 작성 코드 진단 (미커밋 4개 파일)

| 파일 | 방식 | 실패 원인 |
|---|---|---|
| `naver_login_session.py` | Playwright persistent context로 수동 로그인 후 세션 저장 | 세션 저장 자체는 동작. 다만 로컬 Windows 경로 하드코딩 |
| `naver_blog_poster.py` | 저장 세션으로 에디터 열어 `keyboard.type` | 본문에 요약 한 줄만 타이핑하고 **발행 버튼을 아예 누르지 않음** — 미완성 |
| `naver_blog_auto_publisher.py` | 위 + `mainFrame` iframe 처리 + 발행 클릭 | 셀렉터 추측(`button:has-text('발행')` 등)에 의존. SmartEditor ONE 실제 DOM과 불일치 → try/except로 전부 삼키고 "실패" 출력 |
| `naver_blog_edge_publisher.py` | 설치된 Edge 프로필 직접 사용, headless | Edge가 실행 중이면 프로필 락으로 기동 실패. headless는 네이버 자동화 탐지에 가장 잘 걸리는 조합 |

**공통 근본 원인 3가지**

1. **DOM 키보드 타이핑 방식** — SmartEditor ONE은 React 기반이고 실제 문서 상태는 내부 `documentModel` JSON이 갖고 있다. `keyboard.type`으로 넣은 텍스트는 에디터 상태와 어긋나기 쉽고, 셀렉터는 배포 때마다 깨진다.
2. **에디터가 iframe 안에 있음** — `mainFrame` 처리를 한 파일도 있고 안 한 파일도 있다.
3. **`export_all_blog_posts`가 만드는 예쁜 HTML을 결국 못 씀** — SmartEditor는 raw HTML 붙여넣기를 지원하지 않아서, 4개 파일 전부 HTML을 버리고 이모지 몇 줄만 타이핑하고 있다. 리포트 본문이 실제로 발행된 적이 없다.

### 1.6 🚨 즉시 조치가 필요한 보안 문제

```
exports/naver_blog/browser_session/Default/Network/Cookies
exports/naver_blog/browser_session/Default/Login Data
```

**실제 네이버 로그인 쿠키가 저장되어 있는데 `exports/`가 `.gitignore`에 없다.** 현재 untracked 상태라 커밋은 안 됐지만, `git add -A` 한 번이면 네이버 계정 세션이 저장소에 올라간다. 구현 여부와 무관하게 지금 `.gitignore`에 추가해야 한다.

---

## 2. 연동 방식 조사 결과

### 2.1 핵심 결론: **API key 방식은 존재하지 않는다**

네이버는 **2020년 5월 6일자로 블로그 글쓰기 API(`openapi.naver.com/blog/writePost.json`)를 종료**했다. 사유는 정확히 이 프로젝트가 하려는 것과 같은 유형(프로그램에 의한 대량 자동 발행)의 광고성 어뷰징 차단이다.

- 종료 근거: [뉴스핌 2020-04-13 보도](https://www.newspim.com/news/view/20200413000737), [아이보스 공지](https://www.i-boss.co.kr/ab-6141-50946), [넷프로 공지](http://www.netpro.co.kr/bbs/board.php?bo_table=notice&wr_id=78)
- `naver.github.io/naver-openapi-guide/apilist.html`에는 아직 `블로그 글쓰기 / POST / openapi.naver.com/blog/writePost.json`이 살아있는 것처럼 남아 있으나, 이는 **갱신이 멈춘 커뮤니티 미러 문서**다. 실제 서비스는 종료 상태.
- 2026년 6월 25일 출시된 **NAVER API HUB**로 이관된 것은 검색·쇼핑인사이트·데이터랩 계열 **조회 API뿐**이다. 글쓰기/발행 API는 포함되어 있지 않다.
- 네이버 OAuth2(네이버 아이디로 로그인)는 지금도 있으나, 발급되는 access/refresh token에 **블로그 발행 scope가 없다.** 즉 토큰을 받아도 쓸 API가 없다.

> 요약: "키를 발급받아 REST 호출로 발행"하는 정식 경로는 2020년 이후 지구상에 없다.
> 남은 모든 방식은 **로그인 세션(쿠키) 기반**이다.

### 2.2 방식 비교

| # | 방식 | 최초 1회 설정 | 이후 무개입 | 안정성 | 계정 위험 | 평가 |
|---|---|---|---|---|---|---|
| A | 공식 오픈API (`writePost.json`) | — | — | — | — | ❌ **2020년 종료. 선택 불가** |
| B | NAVER API HUB | — | — | — | — | ❌ 조회 API만. 발행 없음 |
| C | 메일로 글쓰기 | — | — | — | — | ❌ 현존 근거 확인 안 됨 |
| D | **RabbitWrite + documentModel** (인증된 브라우저 컨텍스트에서 내부 발행 API 직접 호출) | 로그인 1회 | ✅ (세션 유효 동안) | ★★★★☆ | 중 | ✅ **추천** |
| E | DOM 키보드 자동화 (Gemini가 시도한 것) | 로그인 1회 | △ | ★★☆☆☆ | 중 | ❌ 셀렉터 취약. 이미 실패함 |
| F | 서드파티 자동포스팅 SaaS | 계정 연동 | ✅ | ★★★☆☆ | **높음** | ❌ 계정 위임 필요, 유료, 블랙햇 도구와 동일 취급 |

### 2.3 추천 방식 D 상세 — RabbitWrite + documentModel

SmartEditor ONE이 "발행" 버튼을 누를 때 실제로 나가는 요청을 그대로 재현하는 방식이다.

**엔드포인트**

| 용도 | URL | 비고 |
|---|---|---|
| 발행 | `POST /RabbitWrite.naver` | `tokenId`(ncaptcha 토큰) 필요 |
| 임시저장 | `POST /RabbitTempPostWrite.naver` | `tokenId` 불필요 — **PoC/테스트에 사용** |

**폼 필드 (application/x-www-form-urlencoded)**

| 필드 | 내용 |
|---|---|
| `blogId` | `kospi-predictor` |
| `documentModel` | 글 전체 JSON (제목·본문·이미지 컴포넌트) |
| `mediaResources` | `{"image":[],"video":[],"file":[]}` |
| `populationParams` | 카테고리, 태그, 공개설정, 예약시각, editorSource |
| `productApiVersion` | `v1` |
| `tokenId` | ncaptcha 토큰 (공개 발행 시 필수) |

**documentModel 컴포넌트 구조**

`documentTitle` / `text`(→`paragraph` 자식) / `quotation` / `image` / `imageGroup(collage)`

**왜 순수 HTTP가 아니라 브라우저 컨텍스트가 필요한가**

1. `NID_AUT`, `NID_SES`, `BUC` 쿠키가 **httpOnly** — JS로 못 읽는다. CDP `Network.getCookies`가 필요.
2. `documentModel`은 `window.SmartEditor._editors.blogpc001`의 `setDocumentData()` → `getDocumentData()` 왕복으로 **정규화**를 거쳐야 서버가 받아준다.
3. 공개 발행용 `tokenId`(ncaptcha)는 에디터 페이지가 런타임에 발급받는 값이라 페이지 컨텍스트 안에서 꺼내야 한다.

**이 방식이 Gemini 방식보다 나은 점**

- 셀렉터 의존 제거 → 네이버 UI 리뉴얼에 훨씬 덜 깨짐
- **리포트 본문 전체를 제대로 실을 수 있음** (현재는 이모지 몇 줄만 올라감)
- 성공 검증이 명확: 응답의 `logNo` 추출 → `PostWriteFormSeOptions` 재조회로 서버 반영 확인

출처: [네이버 블로그 자동 발행기 해부 — SmartEditor, RabbitWrite, 이미지 업로드까지](https://dbhyeong.github.io/blog/naver-blog-smarteditor-rabbitwrite-image-upload-automation)

---

## 3. 미해결 쟁점: 발행 워커를 어디서 돌릴 것인가

방식 D를 택해도 **실행 위치**를 정해야 한다. 이게 세션 수명과 직결된다.

| | 안 1: 로컬 Windows PC | 안 2: Render 컨테이너 |
|---|---|---|
| 세션 수명 | **길다.** 쿠키 발급 IP·디바이스·UA가 계속 동일 | **짧다.** 한국 가정용 IP에서 만든 쿠키를 해외 데이터센터 IP로 옮기면 네이버 리스크 엔진이 재인증/차단을 걸 확률이 높음 |
| 자동화 탐지 | 낮음 (headful 실브라우저) | 높음 (headless + 데이터센터 IP) |
| 인프라 작업 | 거의 없음. Playwright만 설치 | Dockerfile에 Chromium + 의존 라이브러리 추가 (이미지 +500MB 내외) |
| +10분 정확도 | PC가 켜져 있을 때만 | 항상 정확 |
| 미발행 따라잡기 | 폴링 워커로 해결 가능 (PC를 늦게 켜도 그날치 발행) | 불필요 |
| 기존 코드 정합성 | `exports/` 경로가 이미 `i:/...` 로컬 하드코딩 → 원래 로컬 전제였음 | 경로 전면 수정 필요 |

**권장: 안 1 (로컬 워커) 우선, 구조는 안 2로 이전 가능하게.**

근거 — 이 기능의 최대 실패 모드는 코드 버그가 아니라 **네이버 세션 만료/차단**이다. 안 2는 그 확률을 크게 올린다. "최초 1회 설정 후 무개입"이라는 핵심 원칙을 실제로 지키려면 세션이 오래 살아야 하고, 그건 로컬이 압도적으로 유리하다.

---

## 4. 제안 아키텍처 (방식 D + 안 1 기준)

```
[Render / FastAPI]                          [로컬 Windows 발행 워커]
market_brief._loop()                         naver_publish_worker.py (상주)
  16:10~16:15  run_all()                       │
      │ 7건 → market_close_briefs 커밋          │ 60초마다
      │                                        ├─ GET /api/market-brief/publish-queue
      └─ (기존 +5분 체이닝 자리)                │     → 미발행 (종목,날짜) 목록
                                               │
                                               ├─ 브리핑 payload → documentModel 변환
                                               ├─ Playwright persistent context
                                               │   (암호화 저장된 쿠키 주입)
                                               ├─ RabbitWrite.naver POST → logNo
                                               ├─ POST /api/market-brief/publish-ack
                                               └─ 다음 종목까지 60~180초 대기
```

### 4.1 구성 요소

| 컴포넌트 | 파일(예정) | 역할 |
|---|---|---|
| 발행 이력 저장소 | `services/naver_publish_store.py` | `naver_blog_posts(report_date, market, log_no, status, attempts, published_at)` PK `(report_date, market)` → **멱등성 보장** |
| 세션 저장소 | `services/naver_session_store.py` | 쿠키를 Fernet 암호화해 Turso에 저장. `kakao_token_store.py`와 동일 패턴 |
| 1회성 로그인 | `scripts/naver_login_setup.py` | headful 브라우저 → 수동 로그인 1회 → 쿠키 암호화 저장. `scripts/kakao_get_refresh_token.py`와 동일 UX |
| documentModel 빌더 | `services/naver_document_model.py` | 브리핑 dict → SmartEditor 컴포넌트 JSON |
| 발행 클라이언트 | `services/naver_rabbit_client.py` | 쿠키 주입 → 에디터 페이지 → `tokenId` 획득 → RabbitWrite POST → `logNo` 검증 |
| 큐 API | `routers/market_brief.py` 추가 | `GET /publish-queue`, `POST /publish-ack` (`NAVER_PUBLISH_TOKEN`으로 보호) |
| 워커 | `scripts/naver_publish_worker.py` | 로컬 상주 루프 + 재시도 3회 + 알림 |

### 4.2 세션 보관 방식 (요구사항 "비밀번호 재요구 금지" 충족)

- 아이디/비밀번호는 **어디에도 저장하지 않는다.** 최초 1회 브라우저에서 사람이 직접 입력하고, 결과로 나온 쿠키만 보관.
- 쿠키는 `NAVER_SESSION_KEY`(env var)로 Fernet 암호화 → Turso `naver_sessions` 테이블 저장. 저장소에는 암호문만 존재.
- `exports/naver_blog/browser_session/` 및 `exports/`를 `.gitignore`에 추가.
- 이 패턴은 이 저장소에 이미 선례가 있다: 카카오 refresh token(`kakao_token_store.py` + `scripts/kakao_get_refresh_token.py`), Claude 구독 토큰(`CLAUDE_CODE_OAUTH_TOKEN`). **동일한 "로컬에서 1회 시드 → DB 보관 → 이후 무개입" 흐름.**

### 4.3 어뷰징 회피 운영 규칙

- 종목 간 발행 간격 **60~180초 랜덤** (7건 발행에 약 7~20분 소요)
- headful(비headless) 실행, 실제 User-Agent 유지
- 1일 7건 상한, 재시도는 지수 백오프 3회까지
- 실패 시 카카오 "나에게 보내기"로 알림 (`kakao_notify.py` 재사용 — 이미 구현되어 있음)

### 4.4 재인증이 필요해지는 경우

세션이 만료되면 자동 복구는 불가능하다(비밀번호를 저장하지 않으므로, 그리고 저장해도 2FA/캡차에 막힘). 대응:

1. 발행 실패가 "인증 만료"로 판정되면 즉시 카카오 알림 발송
2. 사용자는 `python scripts/naver_login_setup.py` 1회 실행 (약 1분)
3. 그동안 미발행 건은 큐에 남아 있다가 세션 복구 후 자동 따라잡기 발행

> **정직한 고지:** 요구사항의 "어떤 상황에서도 재개입 없음"은 네이버에 공식 API가 없는 이상 **100% 보장할 수 없다.** 목표는 재인증 주기를 최대한 늘리고(로컬 실행 + 세션 keep-alive), 필요할 때 1분 내에 끝나게 만드는 것이다.

### 4.5 세션 수명 연장 장치

- 워커가 **6시간마다 `blog.naver.com` 1회 방문**해 쿠키 갱신 (keep-alive)
- 매 발행 후 갱신된 쿠키를 다시 암호화 저장
- 발행 전 로그인 상태 선검사: `nidlogin` 리다이렉트 감지 시 발행 시도조차 하지 않고 알림

---

## 5. 테스트 계획

| 종류 | 대상 |
|---|---|
| 단위 | `naver_publish_store` 멱등성 — 동일 `(종목,날짜)` 2회 요청 시 1회만 발행 큐에 오름 |
| 단위 | `naver_document_model` — 브리핑 dict → 컴포넌트 JSON 스키마 검증 |
| 통합(안전) | `RabbitTempPostWrite.naver`로 **임시저장** 발행 → 블로그 관리에서 확인 → 삭제. 실계정 오염 없이 전 구간 검증 |
| 통합(실발행) | 1개 종목만 실제 발행 → `logNo` 확인 → 수동 삭제 |
| E2E | 리포트 생성 → +10분 → 7건 발행 → 이력 테이블 확인 |

---

## 6. 완료 기준 대비 달성 가능성

| 요구사항 | 달성 | 비고 |
|---|---|---|
| 방식 조사·선택 근거 문서화 | ✅ | 본 문서 |
| 최초 1회 설정 후 계정정보 재입력 불필요 | ✅ | 쿠키 재사용. 단 세션 만료 시 재로그인 필요 (§4.4) |
| 리포트 생성 +10분 뒤 트리거 | ✅ | 기존 체이닝 300→600초 |
| 7개 항목 개별 발행(임시저장 아님) | ✅ | RabbitWrite + tokenId |
| (종목,날짜) 중복 발행 방지 | ✅ | PK 제약 + 이력 테이블 |
| 인증정보 안전 저장, 저장소 미노출 | ✅ | Fernet 암호화 + .gitignore |
| 실패 시 재시도·관리자 알림 | ✅ | 3회 백오프 + 카카오 알림 |
| **"어떤 상황에서도" 무개입** | ⚠️ | 세션 만료 시 1분짜리 재로그인 필요. 공식 API 부재로 원천적 한계 |

---

## 7. 구현 결과

### 7.1 추가된 파일

| 파일 | 역할 |
|---|---|
| `backend/app/services/naver_session_store.py` | 쿠키 Fernet 암호화 후 Turso 저장. 단일 행 |
| `backend/app/services/naver_publish_store.py` | 발행 이력 · 멱등성. `(report_date, market)` PK + `claim()` |
| `backend/app/services/naver_document_model.py` | 브리핑 dict → SmartEditor documentModel |
| `backend/app/services/naver_blog_client.py` | Playwright 발행. RabbitWrite 응답 가로채기로 성공 판정 |
| `backend/app/services/naver_publisher.py` | 배치 오케스트레이션 · 재시도 · 알림 · keep-alive · 따라잡기 |
| `backend/scripts/naver_login_setup.py` | 최초 1회 연동 (로컬 실행) |
| `backend/scripts/naver_publish_now.py` | 수동 실행 · dry-run · 이력 조회 |
| `backend/tests/test_naver_publish.py` | 멱등성 7건 + documentModel 10건 |

삭제: `naver_blog_auto_publisher.py`, `naver_blog_edge_publisher.py`, `naver_blog_poster.py`, `naver_login_session.py`

### 7.2 변경된 파일

- `market_brief.py` — `run_all()` 뒤에 `schedule_publish_after_brief(report_date)` 체이닝. **거래일 기준 날짜를 payload에서 읽어 전달** (§1.2의 캘린더 날짜 불일치 버그 수정)
- `main.py` — keep-alive/따라잡기 스레드 기동
- `Dockerfile` — `playwright install --with-deps chromium`
- `requirements.txt` — `playwright`, `cryptography`
- `render.yaml` — `NAVER_SESSION_KEY`, `NAVER_BLOG_ID`
- `.gitignore` — `exports/` (§1.6 쿠키 유출 차단)

### 7.3 타임라인

```
16:10~16:15  run_all() → 브리핑 7건 커밋
   +5분      HTML 익스포트 (기존 기능, 유지)
   +10분     naver_publisher.run()
               ├ 세션 복호화
               ├ 유령 claim 회수 (release_stale)
               ├ 브리핑 존재하는 종목만 enqueue
               └ 종목별: claim → documentModel 주입 → 검증 → 발행 → logNo 확인
                         → 쿠키 재저장 → 60~180초 랜덤 대기 → 다음 종목
   (총 7~20분 소요)
6시간마다    keep-alive + 미발행 따라잡기(16~23시 KST)
```

---

## 8. 운영 절차 (Runbook)

### 8.1 최초 1회 연동

```bash
cd backend
python -m pip install -r requirements-dev.txt
python -m playwright install chromium

# 1. 암호화 키 생성 → 출력값을 backend/.env 와 Render 환경변수 양쪽에 동일하게 설정
python scripts/naver_login_setup.py --genkey

# 2. 브라우저가 열립니다. 네이버 로그인 + 2단계 인증 완료 ('로그인 상태 유지' 체크 권장)
python scripts/naver_login_setup.py

# 3. 세션 확인
python scripts/naver_login_setup.py --check
```

⚠️ **`.env`의 `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`이 Render와 같아야 합니다.** 로컬에서 암호화해 저장하고 서버가 복호화해 읽는 구조인데, **암호화 키를 `TURSO_AUTH_TOKEN`에서 유도**하므로 양쪽이 자동으로 같은 키에 도달합니다. Render에 따로 등록할 비밀값은 없습니다.

`TURSO_AUTH_TOKEN`을 교체하면 저장된 세션을 못 읽게 됩니다. 그때는 세션 만료와 동일하게 처리됩니다 — 알림이 오고 `naver_login_setup.py` 1회 재실행으로 복구됩니다.

### 8.2 검증 (실제 발행 없이)

```bash
python scripts/naver_publish_now.py --dry-run
```

세션 → 에디터 진입 → documentModel 주입 → 정규화 읽기까지 전 구간을 실계정으로 검증하고 발행 직전에 멈춥니다. documentModel을 수정했다면 항상 먼저 실행하세요.

### 8.3 실제 발행 / 조회

```bash
python scripts/naver_publish_now.py --date 2026-08-17
python scripts/naver_publish_now.py --status
```

### 8.4 세션이 만료되면

카카오톡으로 알림이 옵니다. `python scripts/naver_login_setup.py` 1회 재실행(약 1분)하면 됩니다. 미발행 건은 큐에 남아 있다가 자동으로 이어서 발행됩니다.

### 8.5 문제 진단

발행 실패 시 스크린샷과 페이지 HTML이 `NAVER_PUBLISH_DEBUG_DIR`(기본 `/tmp/naver_publish_debug`)에 남습니다. 로컬에서 눈으로 보려면 `NAVER_PUBLISH_HEADLESS=0`으로 실행하세요.

### 8.6 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `NAVER_SESSION_KEY` | (유도) | 선택. 미설정 시 `TURSO_AUTH_TOKEN`에서 유도 |
| `NAVER_PUBLISH_CHARTS` | `1` | `0`이면 차트 없이 텍스트만 |
| `NAVER_BLOG_ID` | `kospi-predictor` | 대상 블로그 |
| `NAVER_PUBLISH_DELAY_SECONDS` | `600` | 리포트 생성 후 대기 |
| `NAVER_PUBLISH_GAP_MIN` / `_MAX` | `60` / `180` | 종목 간 발행 간격 |
| `NAVER_KEEPALIVE_SECONDS` | `21600` | 세션 갱신 주기 |
| `NAVER_PUBLISH_HEADLESS` | `1` | `0`이면 브라우저 표시 |

---

## 8.7 실전에서 드러난 것들 (2026-08-17 첫 발행)

프로브 스크립트(`scripts/naver_probe_editor.py`)로 **에디터에 직접 스키마를 물어본** 것이 이 작업의 전환점이었다. 추측한 스키마는 전부 틀렸다.

| 발견 | 실제 |
|---|---|
| `documentTitle`의 문단 위치 | `value:`가 아니라 **`title:`**. 틀리면 `setDocumentData`가 `undefined.forEach`로 터져 **7건 전부 실패** |
| 문서 버전 | `2.10.2` (추측했던 2.8.10 아님) |
| 컴포넌트 id | `SE-<uuid4>` |
| URL 자동 링크 | **안 됨.** 타이핑한 URL도 링크 속성 없는 평문 textNode로 남음 |
| 링크 노드 | `"link": {"url": "...", "@ctype": "urlLink"}` |
| 이미지 업로드 | 사진 버튼 클릭 → `input#hidden-file` 생성 → `set_input_files`. 파일 선택기 이벤트는 발생하지 않음 |
| 발행 확인 | `RabbitWrite` 응답 본문은 못 읽음(발행 후 페이지 이동). **최종 URL의 `logNo`**가 확실한 신호 |
| 임시저장 팝업 | `"작성 중인 글이 있습니다"` 모달이 툴바·발행 버튼을 전부 차단. 중단된 실행마다 발생하므로 상시 대응 필요 |

이 경험에서 나온 설계 원칙 두 가지:

1. **스키마를 만들지 말고 받아쓴다.** `merge_into_skeleton()`은 에디터가 준 문서에 내용만 갈아끼운다. `version`/`id`/`di`는 항상 네이버 소유라 스키마가 바뀌어도 우리 문제가 아니다.
2. **검증된 컴포넌트만 쓴다.** `documentTitle`과 `text` 두 가지만 emit한다. 구분선은 박스드로잉 문자, 인용은 굵은 문단으로 표현한다. 스타일 하나 때문에 본문 전체를 잃는 것보다 낫다.

## 8.8 차트 (`naver_brief_charts.py`)

`frontend/src/components/marketBrief.css`에서 색을 그대로 가져와 사이트와 시각 언어를 맞췄다.

- 상승 `#d9424e`/`#ef6b75`, 하락 `#3467bd`/`#5c83d6` — 한국 증시 관례(적=상승)이며 diverging 인코딩
- 팔레트 검증 통과: 인접쌍 ΔE 17.8(protan) / 29.9(정상시각), 대비·명도·채도 전부 PASS
- PNG는 hover가 없으므로 **모든 마크에 직접 라벨**을 찍는다
- 2x 렌더 후 다운샘플

| 차트 | 대상 | 형태 |
|---|---|---|
| `summary` | 전체 | 종가 스탯 + 투자자 수급 diverging bars (+ 지수는 상승비중 도넛) |
| `movers` | 전체 | 거래대금 상위 8종목, 길이=거래대금 / 색=등락방향 |
| `sectors` | 지수만 | 업종별 등락률 diverging bars |

업로드는 순차적으로 한 장씩 한다. 여러 장을 한 번에 넘기면 네이버가 배치(개별/콜라주/슬라이드) 선택을 요구한다.

## 8.9 `no privilege` — 서버에서만 글쓰기가 거부되는 증상 (2026-09-02 확인)

§9의 리스크 1이 실제로 발생한 형태다. **로그인이 풀린 것이 아니다.**

관측된 사실:

- 16:12 브리핑 7건 정상 생성 → 16:22 발행 체인이 첫 타깃(KOSPI)에서 RabbitWrite
  `{"result": {"errorCode": "no privilege"}}` 응답을 받고 런 전체를 중단
- 같은 시각 `naver_login_setup.py --check` 는 **통과**한다. 세션은 살아 있고 읽기도 된다
- 로컬에서 쿠키를 새로 회전시킨 직후 Render의 catch-up 이 그 최신 쿠키로 다시 시도해도
  동일하게 `no privilege`
- **2분 뒤 같은 쿠키로 로컬에서 발행하면 성공한다**

쿠키 신선도가 아니라 실행 환경이 변수라는 뜻이다. 남는 차이는 (a) 출발지 IP —
한국 가정용 vs Render 데이터센터, (b) 브라우저 플랫폼 — Windows vs Linux.

(b)는 코드에서 제거했다: `USER_AGENT` 는 Windows Chrome 으로 고정돼 있었는데
Sec-CH-UA-Platform 과 `navigator.userAgentData.platform` 은 Playwright 가 호스트에서
가져오므로 Render 에서만 "Windows UA + Linux 플랫폼" 이라는, 실제 브라우저는 만들지
않는 조합이 나가고 있었다. 로컬에서는 둘이 원래 일치해서 수동 실행으로는 재현되지
않는다. `CLIENT_HINT_HEADERS` 와 `_PLATFORM_INIT_SCRIPT` 가 이를 맞춘다.

(a)가 남으면 계정 쪽 설정을 먼저 본다 — 네이버 로그인 > 보안설정의 **IP 보안**과
**해외 로그인 차단**. IP 보안이 켜져 있으면 세션이 발급 IP에 묶여 이 증상과 정확히
같은 모양(읽기는 되고 쓰기는 거부)이 된다. 그래도 남으면 §9의 (a) 리전 이전 또는
(b) 발행 워커 로컬 이전으로 간다.

진단을 위해 바꾼 것:

- `NaverSessionExpired` 메시지에 네이버가 준 `errorCode`/`errorMessage`/본문 앞부분을
  실어서 원장(`naver_blog_posts.last_error`)에 남긴다. 이전에는 모든 거절이 똑같은
  문장으로 기록돼 서버 로그를 실시간으로 보고 있지 않으면 구분할 수 없었다
- 카톡 알림도 같은 사유를 싣고, "재로그인" 대신 `--check` 를 먼저 하도록 안내한다
- 세션 거절로 런이 중단될 때 그 종목의 재시도 횟수를 돌려준다
  (`naver_publish_store.release_claim`). 중단은 항상 정렬상 첫 종목에서 일어나므로,
  이전 구조에서는 3일 연속 거절되면 그 종목만 영구히 발행 불가가 됐다

## 9. 남은 리스크

1. **세션 수명** — 최대 미지수. 한국 가정용 IP에서 발급한 쿠키를 Render(기본 Oregon 리전)에서 재생하는 구조라 네이버 리스크 엔진에 걸릴 여지가 있습니다. 실제 만료 주기는 운영하며 관측해야 합니다. 잦으면 (a) Render 리전을 Singapore로 이전(서비스 재생성 필요) 또는 (b) 발행 워커만 로컬로 이전을 검토하세요.
2. **발행 버튼 셀렉터** — documentModel 주입으로 대부분의 취약점은 제거했지만, 발행 트리거 2번의 클릭은 여전히 DOM 의존입니다. 셀렉터 4개씩 폴백을 두었고, 실패 시 `logNo` 미확인으로 **조용히 실패하지 않고** 에러를 냅니다.
3. **`tokenId`(ncaptcha) 미해석** — 이것 때문에 순수 HTTP 발행이 아니라 에디터 UI에 발행을 위임했습니다. 클라이언트가 RabbitWrite 요청/응답을 기록하므로, 실제 운영 로그가 쌓이면 순수 HTTP 경로로 전환할 근거를 확보할 수 있습니다.
4. **네이버 약관** — 자동 발행은 어뷰징 탐지 대상입니다. 1일 7건, 종목 간 60~180초 간격, 실제 시장 데이터 기반 원본 콘텐츠라는 점에서 스팸 패턴과는 거리가 있지만, 제재 가능성이 0은 아닙니다.
