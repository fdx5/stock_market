# 부동산 지도 3D 단지뷰 작업 기록 — 2026-09-30

목표: PC에서 지도 진입·단지 클릭 때 3D 로딩이 마우스/페이지를 끊지 않게 한다. (미배포, 로컬 확인 단계)

## 측정 방법
- `frontend/scripts/measure-complex-jank.py`: 실제 마우스를 계속 움직이며 long task, rAF 간격, 입력 지연을 구간별로 기록. `--no-3d`(페이지만), `--no-region`, `--detail`, `--throttle`.
- `frontend/scripts/profile-complex-entry.py`: 비축소 빌드(`vite build --minify false --outDir dist-prof`)의 CPU 프로파일. 함수별·호출자별 시간.
- 브라우저 트레이스(devtools.timeline + gpu)로 GPU 프로세스 주 스레드(CrGpuMain) 점유를 봄. 렌더러 메인 스레드가 한가해도 이 스레드가 막히면 화면 전체가 끊긴다.
- 페이지 자체(트리맵 레이아웃·React 렌더)가 3D와 무관하게 long task 6건·약 0.8초. 이 작업 범위 밖.

## 원인
1. 후속 장식(수면·보트·나무·보행자)이 한 마이크로태스크 체인에서 돌아 한 작업이 376ms.
2. 새 단지의 재질·텍스처(BC7 인코딩 포함)를 첫 프레임에 한꺼번에 생성.
3. 뷰마다 WebGL 컨텍스트 생성이 메인 스레드를 약 130ms(+첫 동기 호출 160ms) 막음. WebGPU만 쓰는데도 만들고 있었음.
4. 지역 3D 지도의 첫 draw가 프로그램 링크를 동기로 기다림(약 250ms).
5. 파이프라인 생성이 프레임당 3개·30fps로 GPU 프로세스 주 스레드를 거의 포화.

## 조치
- `ComplexHologram.tsx`: 장식 단계마다 작업 분리, 지면 격자(`groundGeometry`)·수면(`buildWater`, `waterField`, `sink`)을 조각내 실행(`pace`). 300ms 이상이던 조각 소멸. `dataset.longChunks`에 12ms 넘는 조각 기록. `dataset.renderMaxMs`(제출 CPU 최대). 지면 페인트는 프레임 단위로 넘김(`nextFrame`).
- WebGPU 가능 브라우저는 WebGL 렌더러를 만들지 않음(입력용 스텁). WebGPU 실패·장치 유실·40초 미표시 시 `renderMode="webgl"`로 뷰를 다시 초기화(모델도 다시 지음). `?renderer=webgl`은 종전대로.
- `tidewater/ComplexRenderer.js`: `sync()`에서 새 재질을 프레임당 시간(6ms/표시 후 3ms)·텍셀(150만/100만) 예산으로 생성, 남은 메시는 다음 프레임. 파이프라인이 덜 만들어진 프레임은 "완성"으로 치지 않음(`starved`).
- `vendor/tidewater/engine/render/MeshRenderer.js`: `pipelineGapMs`(12ms) 시간 기준 생성 간격, `starved` 표시.
- `RegionMap3D.tsx`: 첫 draw 전 `compileAsync`.
- `complexScene.ts`: 접지 그림자를 한 경로·한 번의 blur로.
- `tests/realestate.test.tsx`: `buildWater`가 비동기가 된 데 맞춰 수정.

## 결과 (Edge headed, NVIDIA Ampere, 프로덕션 빌드, 콜드 프로필)
| 항목 | 이전 | 이후 |
| --- | ---: | ---: |
| 진입 구간 long task 합계 / 개수 | 2185ms / 15 | 1512ms / 13 (페이지 단독 ≈820ms / 6) |
| 3D 뷰가 만드는 메인 스레드 최대 작업 | 376ms | ≈60ms |
| GPU 주 스레드 30ms↑ WebGPU 작업 (모델 반입 후) | 프레임마다 8건 반복 | 1~2건 |
| 단지 클릭 구간 long task | 0 | 0 |
| 첫 화면(shownAt) | 약 3.9s | 약 3.9~4.3s (편차 내) |

## 남은 것
- 지면 페인트 직후 GPU 스레드 약 140~170ms 작업 1건: 해상도(2048→1024)에 비례하지 않아 Skia 셰이더 첫 컴파일로 추정(콜드 캐시). 재방문 시 줄어들 수 있음.
- 지역 3D 지도의 WebGL 컨텍스트 생성(≈130ms), 페이지 레이아웃(≈0.8초)은 미조치.
- `test-complex-loading.py`는 변경 전에도 30초 타임아웃으로 실패(이번 변경과 무관).
- 전체화면 열기 구간 프레임 간격 최대 230~280ms는 남아 있음.
- 확인 통과: 렌더 회귀(낮/밤/전체화면/모바일/WebGL 폴백/장치 유실→WebGL), 누수(8회 반복 힙 +0.1MB/회), GPU 버퍼 4, 부동산 12.

## 추가: 전체화면 닫은 직후 마우스 렉 (미배포)

증상(사용자, Chrome, 5120×1440): 상세 카드의 "3D 건물뷰"나 레일의 "⤢ 전체화면"을 닫은 직후 몇 초 동안 카드의 ×로 가는 커서가 끊김.

- 재현: `measure-complex-jank.py`에 닫은 뒤 구간을 추가했다(`--size`, `--channel chrome`, `--a11y`, `--close-card`, `--no-full` 대조군). 실제 OS 커서를 움직여 닫자마자 카드 ×로 가는 흐름은 스크래치 스크립트로 쟀다.
- 원인: 전체화면 동안 페이지 전체(카드 포함)에 `inert`를 걸고 닫을 때 풀었다. 그러면 닫는 클릭 한 번에 페이지 전체 스타일 재계산(28ms)과 접근성 트리 재구성(29ms)이 붙는다(열 때도 같음). 접근성 클라이언트(IME, 암호 관리자, 확장 프로그램 등)가 붙은 브라우저에서는 트리 전체가 브라우저 프로세스로 넘어가 입력 처리까지 밀린다.
- 조치: `inert` 제거. 레이어가 화면을 덮어 포인터를 막고, Tab은 레이어 안에 가두며, `aria-modal`이 이미 있다.
- 결과(Chrome, 접근성 켬, 닫은 직후 0.5초): 긴 작업 116~120ms → 0~53ms, 입력 지연 최대 56~63ms → 34ms.
- 참고: 카드가 떠 있으면 3D는 제대로 멈춘다(GPU 제출 0회). GPU·VRAM 가설(5120 폭에서 배율 1.5, VRAM +500MB)은 VRAM을 5GB 채운 상태에서도 닫은 뒤 렉으로 이어지지 않았다.
- 남은 것: 닫을 때 3D 뷰를 레일에 다시 넣는 비용(레이아웃 약 20ms, 접근성 약 25ms)은 남아 있다. 카드 요소를 지날 때 hover 이벤트 표시 지연 56~80ms는 전체화면과 무관한 기존 값이다.
