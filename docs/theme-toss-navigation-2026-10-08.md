# 테마 통일 · Toss 호출 안정화 · 1면 이동 정리

## 원인과 수정

- `site_theme`를 테마의 우선 기준으로 유지한다. 기존에는 현재 기본값과 같은 테마를 선택하면 저장하지 않았고, 다른 탭의 변경을 구독하지 않았다. 저장 예외도 앱 초기화/전환을 중단시킬 수 있었다. 동일 값도 저장하고, storage/focus/pageshow 및 라우트 이동에서 HTML 속성·React·캔버스 구독을 동기화한다.
- 페이지 기본값은 라우터에서 관리한다. 지면의 지연 로드와 마운트 해제 과정이 저장된 선택을 바꾸지 않는다. HTML 초기 적용도 같은 기본값/검증 규칙을 쓴다.
- 주식 지도와 부동산 지도는 강제 야간 팔레트가 있었다. 지도 타일, 무거래 타일, 배경과 PNG 내보내기를 선택한 테마로 바꾼다.
- `ReadTimeoutError(read timeout=4)`는 Toss 응답 대기가 기존 4초 제한을 넘었음을 뜻한다. 공용 `HTTPAdapter(max_retries=1)`가 즉시 재시도했고, 실패한 캐시 갱신에는 대기 시간이 없어 후속 요청도 반복해서 upstream을 호출했다. ETF 토론 요약은 최대 8개 작업을 병렬로 실행하여 이 현상을 증폭할 수 있었다. 조사 시 동일 NVDA 댓글 endpoint는 정상 응답했고, 새 fetcher의 실제 조회도 댓글 10개를 정상 반환했다. 지속적인 endpoint 주소 오류는 확인되지 않았다.
- Toss 세션만 전송 계층 재시도를 끄고 연결 3.05초/읽기 8초로 분리한다. JSON 요청 동시 실행은 3개까지 허용하고, endpoint 장애 시 30→60→120→240→300초 동안 호출을 중단한다. 대기 종료 뒤에는 단일 복구 요청만 허용한다. 429의 Retry-After는 이 제한 내에서 반영한다. 다른 endpoint의 정상 호출은 유지한다.
- 실패한 종목 코드 조회를 정상적인 빈 토론방으로 저장하지 않는다. 마지막 정상 댓글·커서는 기존 stale-while-revalidate 캐시에 남기고, 정상 응답이 없는 경우 기존 빈 목록 응답을 유지한다. 장애 진단 경고는 복구 시도당 한 번만 기록한다. 외부 서비스의 장애 자체를 제거하는 것은 아니며, 장애 시 반복 호출과 화면 오류 전파를 차단하는 변경이다.
- 1면은 항상 `/desk`로 연결한다. 해외 지도·종목·ETF·해외증시 페이지나 이전 `d2:edition` 세션 값이 1면을 `/global`로 바꾸던 `edition.ts` 분기를 제거한다. 해외증시 링크는 `/global`로 유지한다.

## 검증

- 프로덕션 빌드(TypeScript 포함) 성공.
- `node --test frontend/scripts/test-theme.mjs`: 7개 통과. 동일 기본값 저장, 두 테마의 우선 적용, 다른 탭 알림, 저장소 제한, 페이지 복원, 초기 HTML/React 일치 등을 검증.
- `python -m pytest backend/tests/test_toss_resilience.py backend/tests/test_stock_discussions.py -q`: 19개 통과. 실제 소켓 읽기 타임아웃을 재현하여 전송 재시도 없이 1회 호출, 동시 실패 요청의 단일 호출, 이전 댓글 보존, 복구·상태코드·잘못된 응답 등을 검증.
- `python frontend/scripts/test-theme-navigation.py`: 25개 페이지 × 두 테마 = 50회 페이지 검증, 해외 관련 6개 경로의 1면 복귀, 다른 탭 동기화, 모바일 전환/새로고침 통과. API 데이터를 읽기 전용으로 공급하며 사용자 활동·결제 등 쓰기 요청은 실행하지 않는다.
- 지도 주간판/야간판 및 부동산 주간판 이미지를 시각 확인.

재시도/타임아웃 동작 참고: [urllib3 Retry](https://urllib3.readthedocs.io/en/stable/reference/urllib3.util.html#urllib3.util.Retry), [Requests timeouts](https://requests.readthedocs.io/en/latest/user/advanced/#timeouts).
