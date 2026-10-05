# Geometry / 대량 Instance WASM 전환 - 2026-10-05

기준 commit: `937dc1ccde9b70cfb24308de8b8df52b8e814fbb`. 운영 반영 commit은 PDF의 운영 검증 항목과 `/api/health`에서 확인한다.

## 완료 범위

- 주변 건물 벽·지붕 attributes/index를 Rust/WASM worker 배치로 생성한다. 기존 Earcut 삼각분할·rings 방향을 유지한다. 실제 618/581개 입력의 모든 float/index 값 불일치가 0이다.
- 차량 위치/yaw/pitch/비균일 scale과 대량 수목 행렬을 WASM 배치로 합성한다. 프레임마다 버퍼를 재사용한다. 이동·충돌·지형 조회, 바퀴와 보행자 관절은 JS에 남는다.
- 변경된 Instance 범위만 업로드하며 같은 최종 pose는 업로드하지 않는다. 미소비 dirty range는 합친다.
- 원거리 crown 셀은 480m/1,024개, trunk 셀은 1,024m/4,096개를 분할 기준으로 사용한다. 퇴화/depth 예외가 있으므로 절대 상한으로 표현하지 않는다. 근거리 crown batch는 유지한다. 카메라 LOD는 native WebGPU 경로에서 적용하며 WebGL은 기기별 고정 단계다.
- 제한 기기의 LOD 정점 attributes를 공유하고 index만 달리한다. 임시 WASM batch는 취소 시에도 해제한다. 마지막 owner 종료 시 texture/photo/scene worker와 pending 작업을 정리한다.
- WASM fetch 실패/차단/1초 timeout 시 기존 JS 경로로 복귀한다. `hybrid=off`는 JS 비교용이며 기존 road BVH는 두 방식 모두 활성이다.

## 계산과 메모리 개선

| 항목 | 기존 JS | WASM | 변화 |
|---|---:|---:|---:|
| Geometry 롯데캐슬 골드포레 (618개) | 10.70ms | 6.90ms | -35.5% |
| Geometry 신동아파밀리에 (581개) | 10.70ms | 6.50ms | -39.3% |
| Instance 1,000개 | 0.154ms | 0.046ms | -70.1% |
| Instance 10,000개 | 1.700ms | 0.588ms | -65.4% |

수목 원형 typed-array: 928,608 → 548,448B (-40.9%). 전체 RSS/VRAM 감소율이 아니다. 반복 합성 동안 WASM linear memory 크기는 증가하지 않았다. 1,000/10,000개 Instance batch 소유 버퍼는 각각 208,000/2,080,000B이며 JS 입력과 WASM 입출력 버퍼를 포함한다.

## 전체 장면 - 설정별 각 방식 3회 중앙값

| 설정 / 단지 | 전체 준비 JS→WASM (초) | JS heap GC 후 (MiB) | GPU 시간 (ms) | renderer CPU p95 (ms) | 업로드/프레임 (KiB) | >25ms 비율 (%) |
|---|---:|---:|---:|---:|---:|---:|
| 일반 / 롯데캐슬 골드포레 | 8.59→8.30 | 55.9→57.6 | 6.19→5.11 | 2.40→2.80 | 365.4→159.5 | 0.00→0.00 |
| 일반 / 신동아파밀리에 | 9.90→12.40 | 74.6→78.4 | 5.28→5.02 | 2.60→3.10 | 510.4→203.2 | 0.00→0.28 |
| 제한 / 롯데캐슬 골드포레 | 6.78→6.73 | 54.2→55.2 | 4.74→4.41 | 2.20→2.80 | 174.9→137.3 | 0.00→0.00 |
| 제한 / 신동아파밀리에 | 9.99→10.23 | 71.4→72.5 | 4.63→4.40 | 2.50→3.00 | 216.1→148.7 | 0.00→0.00 |

GPU 시간은 4.9~17.4% 감소했다. renderer CPU p95와 JS heap은 증가한다. 로딩과 실제 프레임 드랍에 일관된 개선은 없다. 정상 상태의 프레임 p95는 약 16.8ms로 60Hz 제한에 가까워 FPS 향상을 주장하지 않는다. 제한 설정은 기존 고정 원거리 LOD보다 카메라 근처가 상세해져 제출 삼각형이 늘 수 있다. 전체 로딩 증가와 원거리 디테일/draw call 교환 비용을 PDF에 그대로 제시한다.

## 측정 조건과 한계

Windows Edge 155, 1440×1000, DPR 2. 정확한 browser version/UA는 측정 JSON에 보존한다. 제한 프로필은 deviceMemory=4, MacIntel/touch flag로 앱 예산 분기만 재현한다. 실물 iPad CPU/GPU/메모리 측정이 아니다.

장면은 fresh context에서 순서를 교차한다. 최초 warmup을 제외하고 건물 입력 hash, 도로·차선 삼각형 hash, 수목 수가 일치하는 12쌍을 비교했다. 좌표 오차 허용 없이 삼각형 저장/cyclic 정점 순서만 정규화한다. 입력이 다른 1쌍은 원자료에 run=-2로 보존하고 두 방식 모두 재측정했다. 느린 성능 수치를 기준으로 제외하지 않았다.

지리 응답을 동일 내용으로 재사용하므로 실제 네트워크 로딩 예측은 아니다. 기타 CDN/외부 자료/스케줄링 변동은 남고, 움직이는 actor pose는 같은 시각으로 고정하지 않았다. CPU kernel 비교는 7회이며 Geometry에는 packing/Earcut/copy, Instance에는 WASM 입력/출력 copy가 포함된다. Instance packed input 생성과 이동 시뮬레이션은 kernel 측정 밖이다.

Main JS heap은 worker heap, ArrayBuffer/WASM backing store, GPU, OS RSS를 포함하지 않는다. GPU 값은 실제 createBuffer/createTexture 수명의 논리 할당량이며 driver padding/internal cache는 제외한다. 원형 메모리 감소는 별도 비교다. 두 scene arm에는 공통 LOD 공유/worker 해제 수정이 포함돼 전체 메모리 개선율과 합치지 않는다.

## 검증

- 회귀 검사 81개, 부동산 UI 검사 12개, TypeScript/Vite production build 통과.
- Chromium/WebKit/iPad 설정 WebKit에서 WASM 정상·차단 fallback·재열기 복원·취소·마지막 owner 종료 검사 통과.
- WebKit 장면 전환/portrait-landscape 3회, canvas budget 2,000,000 pixels와 WebGL context loss/restore 검사 통과. 실물 기기 성능 측정은 아니다.
- 로컬 실제 3단지에서 rust-wasm Geometry/Instance, rust-wasm-bvh, 바이너리 hash와 도로/차선 누락 0 확인.
- Luceheim 실제 462대의 360초 simulation: overlap 0, 이동 461대. 움직이지 않은 1대와 장기 대기는 남으므로 교통 정체 제거를 주장하지 않는다.
- 지도 이탈 뒤 마지막 owner를 닫으면 worker 0. device cache GPU floor는 남는다. 전체화면 Escape는 side panel owner를 유지하므로 마지막 owner 종료와 다르다.

## 재현

```powershell
node frontend/scripts/build-scene-geometry.mjs
node --test frontend/scripts/test-hybrid-scene.mjs frontend/scripts/test-grove-device-budget.mjs
node frontend/scripts/serve-bvh-preview.mjs  # port 4196, tmp/hybrid-jobs-* fixtures
python frontend/scripts/check-hybrid-browser.py --kernel
python frontend/scripts/check-hybrid-browser.py
node frontend/scripts/preview-hybrid-build.mjs  # first build frontend/dist-hybrid
python frontend/scripts/bench-hybrid-scene.py
python frontend/scripts/verify-hybrid-production.py --commit <release-sha>
python frontend/scripts/report-geometry-instance.py
```

전체 원자료/조건: `docs/3d-geometry-instance-measurements-2026-10-05.json`. API 원본 응답, provider key와 원본 URL은 커밋하지 않는다. 보고서 builder는 검증된 운영 commit/health/asset proof가 있어야 실행된다.
