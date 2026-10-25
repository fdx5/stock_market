# 방문자 유입 개선 — 기존 운영 테마 사용

운영 소스 작업트리: `I:/ai_root/sm-deploy`.

운영 사이트의 NEO GENESIS를 그대로 재사용했다. `neo/NeoShell.tsx`, `neo/neo.css`, `neo/NeoComponents.tsx`, `neo/settings.ts`, 전역 테마와 팔레트는 수정하지 않았다. 새 테마·폰트·헤더·하단 메뉴는 만들지 않았다.

## 적용

- `/guides`: 안내 목록.
- `/guides/stock-heatmap`: 히트맵 보는 법.
- `/guides/trading-value`: 거래대금 순위 읽는 법.
- `/guides/etf-comparison`: ETF 비교 기준.
- 기존 `HoloPanel`, `HUDSectionTitle`과 `NeoShell`의 메뉴·Market Pulse·시계·BGM·하단 메뉴를 재사용한다.
- 신규 CSS는 안내 본문의 그리드·간격·목차·반응형 배치만 정의하며 기존 디자인 토큰을 참조한다.
- 각 안내에서 실제 도구와 다른 안내로 이동할 수 있다. 모바일 기본 공유·링크 복사·수동 복사를 제공한다.
- 서버가 초기 HTML에 전체 본문과 링크, 페이지별 메타정보와 구조화 데이터를 제공한다. 동적 사이트맵에는 편집 날짜로 등록한다.
- 기존 통계의 페이지명과 RSS 자동 발견 링크를 추가했다.

## 검증

- TypeScript 검사와 Vite 운영 빌드 통과. 기존 대형 청크 경고가 남아 있다.
- 독립된 카탈로그를 사용하는 `backend/tests/test_market_guides.py` 6개 통과. DB를 열거나 앱 서버를 기동하지 않았다.
- 브라우저에서 기존 운영 테마와 새 안내 화면을 확인했다. `data-design=neo`, 공통 헤더 1개·하단 메뉴 1개, 네 개의 안내 본문 섹션, canonical, 가로 넘침 없음을 확인했다.
- `git diff --quiet`로 기존 테마 CSS·NeoShell·공통 컴포넌트·설정·전역 테마가 변경되지 않았음을 확인했다.

로컬 미리보기: `http://127.0.0.1:5192/guides`.

운영 배포는 실행하지 않았다. 방문자 증가 성과는 아직 측정하지 않았다.
