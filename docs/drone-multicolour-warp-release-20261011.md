# 다색 워프와 지도 드론 검색 공통 적용

검색 이동의 푸른 선·링 위주 연출을 다색 터널로 교체한다. 청록·보라·마젠타·금빛·민트 팔레트가 공간을 따라 흐르는 에너지 표면, 원근 깊이, 휘어지는 광류와 카메라 기울기, 600개 별빛 궤적을 사용한다. 충전 → 광속 진입의 빛 확장 → 워프 항해 → 실제 도착 프레임 뒤 600ms 전환을 구성한다. 5초가 지나도 목적지가 준비되지 않으면 연출을 유지한다. 영화 영상·로고·외부 이미지 다운로드는 사용하지 않는다.

하나의 화면 삼각형과 고정 반복 횟수의 절차적 WebGL shader로 터널을 그린다. 별은 기존 2D canvas의 6회 배치로 처리한다. 양쪽은 최대 30회/초, 실제 화면 DPR로 그리며 배경의 3D canvas 해상도/DPR/품질은 변경하지 않는다. 종료 시 RAF/observer/listener, shader/program/buffer와 canvas backing buffer를 해제하고 분리된 터널의 WebGL context도 종료한다. React effect 재실행 시 연결된 canvas context를 잃지 않도록 처리한다. WebGL 생성/연결 실패나 context loss에서는 기존 별·성운 배경을 사용한다. 움직임 감소 설정에서는 정적인 터널/별을 그린다.

검색 누락 수정(5d7e1b8)을 포함한다. 부동산 지도 → 3D 건물뷰 → 드론플레이와 드론 탐험에 같은 장소/주소 검색이 나타나며, 지도 출발도 공통 검색 이동과 새 워프를 사용한다. touch 검색 헤더의 가림, native 속도·고도 패널이 비어 보이던 문제와 Escape 처리도 유지한다.

검증: TypeScript 및 V2 production build 통과. 음소거 Chrome 154, 독립 브라우저와 읽기 전용 공개 스냅샷 API를 사용했다. tmp/drone-map-search/multicolour-warp-v2/report.json에서 실제 지도 → 건물뷰 → 드론 버튼 클릭 → 강남데시앙 IME 자동완성(스페이스 없음) → 이동 → 목적지 도착을 1440×1000/390×844 touch에서 확인했다. 결과명은 세곡동 강남데시앙파크, 원점/드론 좌표는 37.46068,127.101395로 일치하고 이전 canvas/세션은 종료됐다. 속도 200km/h·자동 고도 1000m 설정과 Escape도 정상이며 오류는 0이다. 워프는 각각 6.588초/5.528초였다.

실제 검색 이동 영상: tmp/drone-warp/multicolour-video-v2/warp-preview.webm. 터널 WebGL/별 canvas 모두 1440×1000 DPR 1, 첫 90회 중 최대 별 2D 그리기는 0.80ms, 실제 목적지 프레임을 확인하고 공개했으며 오류는 0이었다. 이 수치는 WebGL GPU 시간·전체 FPS·로딩 3배 달성을 의미하지 않는다. 로딩 개선 후보는 별도 작업 공간에 보존하며 이 배포에 포함하지 않는다.

추가 성능/수명 검증: tmp/drone-warp/multicolour-performance-v2/report.json. 테스트 페이지에서 실제 준비 콜백을 일시 보류해 실제 워프 컴포넌트가 떠 있는 동안 목적지 렌더러를 예열하고, 자동 속도 73km/h·목표 고도 175m로 6초 동안 98.80m 비행했다. 최저 1초 FPS 53.973, p95 16.8ms/p99 33.3ms/최대 100.1ms, 3D canvas 2520×1750 DPR 1.75/high, 터널 1440×1000 DPR 1이었다. Ryzen 7 3700X/RTX 3070, Chrome 154, tidewater-webgpu 조건이며 단일 예열 구간이다. 실제 콜백을 복원하면 도착 전환이 완료되고, 터널은 DOM 분리·0×0 backing buffer·context lost로 회수됐다. 오류 0이다. 최초 로딩/전국/모든 장비의 50fps나 전체 로딩 3배 달성을 주장하지 않는다.
