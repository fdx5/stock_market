# 인수인계: 대형 건물 실내 (2026-10-30, Claude → Codex)

먼저 `AGENTS.md`를 따른다. 데이터 삭제 금지 규칙과 네온 디자인 규칙이 적용된다.
배포는 사용자가 "배포해"라고 할 때만 한다. 작업 위치는 `I:/ai_root/sm-deploy`이고 `origin/main` 기준이다.

## 현재 상태

- **운영:** `44f9b1ee`가 배포됐다. `https://kospimap.com/api/health`의 commit 값으로 확인한다.
  내용은 `docs/walk-large-floors-2026-10-30.md`에 있다. 대형 층 전체 렌더링, 마감재, 병원 단지 1층,
  드론 걷기 중 '드론' 이륙 버튼, 3인칭 카메라 6m가 포함됐다.
- **커밋하지 않은 로컬 변경:** 타입 검사는 통과했고 브라우저 확인은 아직 하지 않았다.
  - `frontend/src/walkmode/interior/npcTalk.ts` (새 파일): 조합형 NPC 대화 생성기다.
    6개 역할에서 서로 다른 문장 47,150개가 나온다. 기존에는 역할마다 3문장이었다.
  - `facilityPeople.ts`: `talk()`를 사용한다. 말풍선은 최대 4줄로 줄바꿈하고, 표시 시간은 글자 수에 비례한다.
    `People`에 `hour` 인자를 추가했다.
  - `Interior.ts`: `new People(..., this.o.hour)`.
  - `WalkPage.tsx`: 디버그 모드에서 `window.__walkFloor(level)`로 층을 바로 연다.
  - `backend/app/data/system_inventory.json`은 이 작업 전부터 수정돼 있었다. 커밋하지 않는다.

## 남은 작업 (사용자 요청 순)

1. **간판·안내문 다양화.** 사용자 평가는 "너무 단조롭고 별로"다. 손댈 파일은 `interior/facilitySigns.ts`의
   `SignAtlas.sign`과 `facilityFurnish.ts`의 `signOn`, `doorSign` 부근(파일 끝 근처)이다.
   - **문패(plate):** 라벨 해시로 4가지 디자인 중 하나를 고른다(밝은 판+강조 띠 / 차콜 / 강조색 전면 /
     테두리+영문 병기). 라벨 키워드에 맞는 픽토그램을 넣는다(화장실 남·여, 엘리베이터, 계단, 약국, 카페,
     안내 i, 진료 십자, 검사 플라스크, 영상, 병실 침대, 대기 의자, 창고, 주차 P). 흔한 단어는 영문을 함께
     쓴다(약국 Pharmacy, 화장실 Restroom, 검사실 Laboratory 등).
   - **매장 간판(fascia):** 5가지 변형을 둔다(강조색 그라데이션 / 검정+흰 발광 글자 / 석재+진한 글자 /
     네온 글로우 / 목재). 폭은 이미 6m로 제한했다.
   - **천장 걸이 안내판:** 대형 층의 긴 복도(>12m)에 화살표와 가까운 목적지 2~3곳을 표시한다.
   - **포스터 스타일:** 병원은 손씻기·진료시간·금연, 판매는 SALE·NEW·이벤트. 복도 벽의 빈 곳은
     `pl.against`로 찾는다.
   - 같은 간판은 아틀라스 자리를 공유한다(`made` 맵). 아틀라스는 2048이고, 2/3가 차면 해상도를 절반으로 낮춘다.
2. **NPC 대화:** 위의 미커밋 변경을 브라우저에서 확인한다. 말풍선 크기와 위치가 맞는지 본 뒤 커밋한다.
   더 늘리려면 `npcTalk.ts`의 `TOPICS`와 `CLERK_BY` 배열에 문장을 추가하면 된다.
3. **음료 자판기:** 대형 건물에만 둔다. 구석에 과하지 않게 층당 1~3대를 놓는다.
   E키로 수십 종 메뉴(UI)가 열리고, 고르면 음료가 나오는 연출(캔이 떨어지는 애니메이션과 소리)이 있다.
   - 상호작용 패턴은 `furnish.ts`의 `Interactable`(id, hit, label, act)과
     `Interior.interact()`를 참고한다.
   - 메뉴 UI는 `WalkPage.tsx`의 `liftPanel` 패턴처럼 React 오버레이로 만든다.
   - 모델은 `facilityModels.ts`의 `cooler`를 참고한다.
4. **브라우저 확인이 필요한 배포분:**
   - 드론 → 직접 걷기 → '드론' 버튼과 Esc: 그 자리 상공으로 이륙해야 한다.
   - 3인칭 카메라 거리, 건물에서 나온 직후 카메라 위치.
   - 병원 단지 1층: `tmp/large-floors/hosp_check.py campus`에는 테스트용 가상 동이 들어 있다.
   - 의정부 3층 간판 폭 제한.
   - 모바일 성능: 실기기와 CPU 감속 모두. 해상도는 낮추지 않는다(메모리 규칙).
5. **알려진 문제:**
   - 로딩 중 가구 배치(furnish)에 약 4초가 걸린다. 방마다 걸리는 시간을 재서 최적화한다.
   - 로비 의자 열에서 사람이 의자 앞쪽에 떠 보인다(`facilityFurnish.ts` lobby 블록의 `spot(at(g, -0.28, 0, 0.08)...)`).

## 검증 도구: `tmp/large-floors/` (git 제외)

- **개발 서버:** `cd frontend && REALESTATE_API_TARGET=https://kospimap.com npx vite --port 5321 --strictPort --host 127.0.0.1`.
  운영 API는 읽기만 한다. 로컬의 `/api/market` 등 500 오류는 무관하다.
- `python -I tmp/large-floors/hosp_check.py`: 삼성서울병원 본관 1층. headful Chrome 전체화면으로 로딩 단계,
  걷기 8초, 순간이동 6곳의 fps를 재고 스크린샷을 남긴다.
- `ujb_check.py`: 의정부민자역사(신세계) 3층. `ujb_diag.py`는 조명 풀 상태를 진단한다.
  `fin_check.py`는 마감재를 확인한다.
- **생성기 단독 측정:** `esbuild plantest.ts --bundle --platform=node --outfile=plantest.cjs` 후
  `node plantest.cjs tmp/large-floors 1`. `samples/ssh`에 plan1.json이 생기며, `talktest.ts`가 이 파일을 쓴다.
- **기준 수치 (RTX 3070, 2514×1277):**
  - 병원 1층: 12,281㎡, 로딩 11.8초, 평균 59.8fps, 최악 33ms.
  - 의정부 3층: 18,687㎡, 로딩 9.2초, 최악 18ms.

## 구조 메모

- **대형 판정:** `Interior.ts`의 `LARGE`가 48m 초과이고, 이때 `nearFrame`이 돈다. 조명 풀 28개,
  채움광은 `lightZones.ts`의 zone 텍스처(구역 최대 4096), 컬링 거리는 `SHELL_FAR`/`FURN_FAR`.
- **SGIS 구획 코드:** 10 사업체, 20 빈 공간, 31~37 기타 시설물(시설 포인트 0001~0007 순서와 일치),
  40 덕트(VOID). 근거는 공식 정의서(`docs` 출처 링크 참조).
- **간판 아틀라스:** 층마다 하나, 2048px. 넘치면 회색 판으로 대체한다.

## 추가 요청: 시설 컴퓨터 웹 브라우저 (아파트 제외)

사용자 요청 원문은 "실제 검색까지 하고 다른 사이트 방문도 가능하게 해줘"이다.

**요구 사항**
- 아파트를 제외한 시설의 모든 컴퓨터 모니터에 google.com을 홈페이지로 띄운다.
- 모니터를 보고 E를 누르면 화면을 확대하고, 키보드로 검색하고 다른 사이트로 이동할 수 있어야 한다.

**구현 방향**
- 기존 `ScreenApps.tsx`의 `TvBrowser`와 `LaptopScreen` 패턴을 따른다. 3D 화면 네 모서리에 맞춘
  오버레이 iframe을 쓰고, 확대·축소와 포인터 해제를 처리한다.
- 모니터는 `facilityFurnish.ts`에서 `X.monitor` 재질로 놓인다. 각 모니터의 모서리 좌표를 기록해
  `Interactable`(label "컴퓨터 사용하기")로 등록한다. `Interior`에 `onMonitor` 콜백을 추가한다.
- 홈은 `https://www.google.com/webhp?igu=1`이다. 일반 google.com은 X-Frame-Options 때문에
  iframe 안에서 열리지 않는다.
- 주소창, 뒤로, 홈 버튼을 둔다. 검색 결과에서 들어간 사이트도 상당수가 iframe을 막는다. 로드에
  실패하면 "이 사이트는 화면 안에서 열 수 없음 → 새 탭에서 열기" 버튼을 보여 준다.
- 서버 프록시로 프레임 차단을 우회하는 방식은 하지 않는다. 보안과 약관 문제가 있고, 외부 요청을 대신
  보내는 구조가 된다.
- 쿠키와 로그인 정보는 저장하거나 로그로 남기지 않는다(AGENTS.md의 최소 정보 원칙).

### 변경 (사용자 결정): 홈페이지는 `https://www.kospimap.com`

- 구글은 일반 주소의 끼워 넣기를 막고, 네이버는 `X-Frame-Options: DENY`로 완전히 막는다.
  그래서 홈은 자사 사이트로 한다. 구글 내장용 주소는 홈에 쓰지 않는다.
- 모니터 안에서는 3D 페이지(`/walk`, 드론, 단지 3D)를 막거나 새 탭으로 연다. 3D가 이중으로 돌면 무거워진다.
  예: iframe URL에 `?inframe=1`을 붙이고, 앱이 이 값을 보고 3D 진입을 새 탭으로 돌린다.
- 그 밖의 외부 사이트는 주소창으로 시도하고, 열리지 않으면 "새 탭에서 열기"로 처리한다.
