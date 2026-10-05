# 3D 건물뷰 성능 개선 — 2026-10-05

드라이브 게임을 독립 서비스(`/drive`)로 분리한 뒤 진행한 3D 건물뷰 작업 기록이다. 측정 근거는 두 가지다. Sol 하네스(`frontend/scripts/test-complex-performance.py --production`, 합성 단지, 3회씩)와 실데이터 측정(`tmp/dg/real_view.py`, 길음 래미안센터피스, 프로덕션 빌드)이다.

## 변경

1. **워커 캔버스를 CPU 래스터로 전환** (`components/workerCpuRaster.ts`): 페인트·장면·텍스처·사진 워커의 OffscreenCanvas 2D를 `willReadFrequently`로 바꿨다. 이전에는 GPU 래스터라서 획·그라디언트 종류가 처음 나올 때마다 GPU 프로세스가 Skia 셰이더를 컴파일했다(트레이스 `RendererBlinkWorker` 75–145ms). 이 작업이 페이지 프레임을 막았다. 페이지 자체 캔버스는 GPU 그대로 둔다(메인 스레드 CPU 래스터가 더 나빴던 이전 측정 유지). `complexScene.ts`는 수정하지 않았다(사전 페인트 자산 해시 보존).
2. **뷰 교통에서 게임 차량 제거** (`sceneStreet.ts`, `heroVehicles.ts` 삭제): 쿠팡트럭·사이버트럭 생성(리버리·바퀴·creased normals 약 100ms)과 수동 운전·경로 탐색 코드는 게임 전용이었다. 네트워크 계산 단계 사이에 양보(frameSlice)를 넣었다.
3. **차량 모델 디코드 분할** (`sceneCars.ts`): `cars.bin` 17종을 한 번에 디코드하던 작업(95ms 한 프레임)을 프레임 단위로 나눴다.
4. **버그 수정: `Buffer "complex N" used in submit while destroyed`** (`tidewater/ComplexRenderer.js`): 재질 소스 버전이 바뀌면 옛 재질을 다음 프레임에 바로 파괴했다. 그런데 프레임 예산 때문에 교체가 미뤄진 메시와 다중 재질 메시는 옛 재질로 계속 그려졌다. 이제 retired 재질은 이를 참조하는 메시가 없을 때만 파괴하고, 다중 재질 메시도 교체한다. 4회 중 1회 나던 오류가 이후 9회(실데이터 4, 하네스 5×3 로드)에서 0회다.
5. 게임 코드 제거: ComplexHologram −1,111줄, 뷰 청크 353→336KB(gz 134.7→128.4KB).

## 측정

| 지표 | 이전 | 이후 |
|---|---|---|
| 선택→첫 표시 (합성, 3회) | 1,536–1,569ms | 1,257–1,337ms (약 −17%) |
| 로딩 중 20ms 초과 프레임 (합성) | 11–12 | 6–9 |
| 표시 후 10s, 20ms 초과 (합성) | 3 (최대 83ms) | 0 (최대 17.8ms) |
| 표시 후 12s 최대 프레임 (실데이터) | 133–188ms | 67ms |
| 실데이터 드로우 | 641–655 | 438–446 |
| WebGPU 검증 오류 | 간헐적 | 0 |

## 검토 후 채택하지 않은 것

- 비동기 파이프라인 컴파일 동시 실행 제한(코어 1/3): 첫 표시가 약 0.3s 늦어졌고 로딩 최대 프레임은 같았다. `?plimit=N` 실험용으로만 남겼다(기본값 무제한).

## 남은 병목 (트레이스 근거)

- 로딩 중 116–150ms 프레임: Dawn의 DXC 파이프라인 컴파일이 모든 코어를 사용하는 동안 GPU 프로세스와 컴포지터가 지연된다(`RasterImplementation::Finish` 대기). 브라우저 내부 작업이고, 새 프로필(셰이더 디스크 캐시 없음)의 최악 조건이다. 재방문자는 캐시 덕분에 줄어든다. 근본 대책은 단지 선택 전(지도 유휴 시간)에 공통 파이프라인을 미리 컴파일하는 것이다(보고서 P1).
- 첫 표시 3배 목표(≤620ms)는 아직 미달이다.

## 재현

```bash
python frontend/scripts/test-complex-performance.py --production --label X [--trace] [--query plimit=0]
bash tmp/ab.sh <label> "<query>" 3      # 3회 반복 요약
python tmp/trace_gpu.py tmp/complex-perf-X/trace.json
RUNS=2 BASE=http://127.0.0.1:5191 python tmp/dg/real_view.py   # 실데이터 (vite preview)
python tmp/dg/buf_hunt.py              # 파괴된 버퍼 사용 추적
```
