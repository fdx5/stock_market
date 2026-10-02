# 3D 건물뷰 최적화와 메모리 관리 — 2026-10-02

**Deployment status (2026-10-03): Performance acceptance criteria remain unmet. Deploying this reviewed revision at the user's explicit request; production verification pending.**

사용자 기준은 품질 저하 없이 첫 화면 표시까지 3배 단축, 로딩 중 마우스 지연 제거, 렌더링 프레임 드랍 제거, 브라우저 메모리 절감이다. 모델 준비 시간만 줄었다고 첫 로딩 전체가 3배 빨라졌다고 판정하지 않는다.

## 구현

- 기존 해상도, 난수 시드, 색상, 발광, 노멀, 재질 맵을 유지한 원본 페인터를 작업 스레드로 이동했다. OffscreenCanvas의 비트맵 소유권을 전달하고 캔버스 저장 공간을 즉시 비운다. CPU 페인터가 원본과 다른 픽셀을 만든 실험은 제외했다.
- 단지에 관계없이 동일한 주변 건물 맵과 표면 노멀을 원본 페인터로 사전 생성했다. 35개 무손실 PNG는 약 3.77MB다. `paintAssetsPlugin.mjs`가 원본 소스 해시를 검사한다. 소스가 바뀌거나 파일 로딩이 실패하면 원본 페인터로 돌아간다. 해시는 Windows/Linux 줄바꿈 차이를 정규화한다.
- 외벽 2종, 기단, 지면 작업을 겹쳐 실행한다. 지면 크기는 기존 float32 건물 경계와 같은 값으로 계산한다. 실제 단지 이름을 얻기 전에 틀린 팔레트를 중복 생성하지 않는다.
- WebGL이 ImageBitmap의 Texture.flipY를 처리하지 않는 경우에도 방향이 같도록, 비트맵에 방향을 적용한 뒤 두 렌더러에 동일하게 전달한다.
- 사용하지 않는 셰이더 함수·리소스 선언을 제거하고 같은 프로그램의 파이프라인을 공유한다. 동일한 무채색 표면 데이터도 공유한다. 색상과 창문 발광의 단지별 차이는 유지한다.
- 동적 해상도/품질 하향 조절과 30fps 유휴 제한을 제거했다. GPU 여유가 있는 경우의 상향 슈퍼샘플링은 유지한다. 런타임 페인트에 무거운 손실 BC7 인코더를 새로 시작하지 않는다. 동적 색상 맵은 원본 texel을 유지하며, 기존 압축 자산은 사용할 수 있다.
- 미리 시작한 밉맵·채널 패킹 파이프라인을 기다려, 준비 중인 프로그램을 다시 동기 컴파일하는 경로를 피한다.

## 메모리 관리 로직

| 소유 범위 | 적용 규칙 | 구현 |
| --- | --- | --- |
| 단지 1개 | dispose 시 GPU 객체뿐 아니라 CPU 소유 참조도 제거. 닫힌 소유자에 늦게 도착한 객체는 즉시 dispose | `sceneResources.ts` |
| 여러 뷰 | rail/modal이 공유 임대를 보유. 마지막 뷰 종료 시 공용 자원 회수 | `sceneMemory.ts` |
| 비트맵 | 업로드 또는 dispose 뒤 close. 취소된 스냅샷·부분 실패 결과도 close | `paintClient.ts`, `paintRasterWorker.ts`, `bitmapTexture.ts`, `groundClient.ts` |
| 작업 스레드 | 마지막 뷰 종료 시 종료하고 대기 요청 완료/취소. 래스터 스레드는 5초 유휴 시 종료 | paint/scene/normal/vehicle 클라이언트 |
| 숨겨진 뷰 | HDR/AO/TAA/bloom 임시 타깃과 캔버스 컨텍스트를 해제. 재개 시 같은 해상도·포맷으로 재생성 | `ComplexRenderer.suspendTargets` |
| 공용 GPU/자산 | 마지막 뷰 종료 시 그림자, 상세 텍스처, 식물·나무·차량·보트 자산 회수. 이전 세대 비동기 결과가 캐시를 채우지 않도록 취소/세대 검사 | renderer 및 scene 모듈 |
| 셰이더 캐시 | LRU 개수·문자열 바이트 예산. 살아 있는 리소스의 품질을 바꾸지 않고 캐시 참조만 퇴출 | `BoundedCache.js`, Shader/MeshRenderer |
| 교체된 모델 | 재질별 바인딩 및 버퍼를 즉시 회수. 동일 표면 맵의 다른 참조가 있으면 GPU 텍스처 유지 | MeshRenderer/ComplexRenderer |
| IndexedDB | 건물 응답 60개, 페인트 40개. 나이 인덱스의 key cursor로 퇴출하여 전체 응답/Blob을 메모리에 읽지 않음 | buildingStore/paintWorker |

공용 GPU device와 제한된 프로그램 캐시는 재방문을 위해 유지한다. 회수 조건과 재생성을 코드로 관리하며, 화면 품질을 줄여 메모리 목표를 맞추지 않는다. 메모리 검증의 JS heap은 메인 페이지 기준이고 GPU 텍스처 수치는 생성 포맷·밉·크기에 따른 추정이다. 브라우저 전체 RSS/작업 스레드 heap과 GPU 드라이버의 실제 할당량을 측정한 값은 아니다.

## 검증과 남은 작업

합성 단지: 자체 건물 9개, 주변 건물 275개, 같은 카메라와 고정 렌더 해상도. Edge/Playwright에서 API 응답을 고정한다. 실제 도시 데이터·저사양 기기·전체 브라우저 메모리와 동등한 증거는 아니다.

- 텍스처 50개: 1x/2x 해상도, 여러 팔레트/시드, 샘플링 설정, WebGL/WebGPU 방향 검증 통과. 최대 채널 차이 1/255, 평균 약 0.0000614/255. 완전한 비트 단위 동일성을 주장하지 않는다.
- GPU 회귀 8개, 메모리 소유권 회귀 2개, 부동산 회귀 12개 통과. TypeScript와 격리한 전체 프로덕션 빌드 통과.
- 모델 준비는 초기 관찰 약 1272ms에서 여러 수정본에서 235–584ms까지 줄었다. 최초 초기 관찰은 개발 빌드이며 중간에 HMR/테스트 문제가 있었으므로 전체 성능 3배 달성의 공식 기준으로 사용할 수 없다.
- 최종 WebGPU 측정(`tmp/complex-perf-request-final/report.json`): 선택→첫 표시 1671ms, 모델 준비 584ms. 로딩 중 포인터 처리 최대 171.6ms, 로딩 rAF 최대 177.6ms. overview에서 36ms 프레임 1회, 거리/반대 방향/단지 전환 뒤 각 180프레임은 20ms 초과 0회. **첫 로딩 전체 3배와 렉/프레임 드랍 0회를 충족하지 못했다.**
- WebGL 대체 경로는 표시·전환과 오류 없음 검증을 통과했지만, 첫 로딩과 overview에서도 긴 프레임이 남아 있다.
- 최종 8회 열기/닫기 검증(`tmp/complex-leak-request-final-memory/report.json`): 매회 GPU 버퍼 857개/텍스처 69개로 돌아왔다. 마지막 뷰 종료 후 캔버스·WebGL 컨텍스트·렌더 루프가 사라지고 GPU 텍스처 추정치가 234.9MB에서 0.7MB로 줄었다. 재개 후에도 텍스처 69개/234.9MB, 오류 0건이었다. 활성 뷰의 브라우저 전체 메모리를 획기적으로 줄였다는 증거는 아직 부족하다.

남은 병목은 최초 프로그램 준비·GPU 업로드와 초기 장식/프로그램 준비 구간이다. 원본 버전과 수정 버전의 동일한 프로덕션 환경에서 각각 3회 이상 냉시작 측정, 로딩 중 입력과 표시 프레임의 긴 구간 제거, 실제 도시/수면/날씨/야간 장면 비교, 저사양 기기와 전체 프로세스 메모리 검증이 추가로 필요하다. 현재 상태에서는 배포 조건이 충족되지 않는다.

## 재실행

```powershell
cd frontend
node scripts/test-complex-gpu.mjs
node scripts/test-complex-memory.mjs
node scripts/test-realestate.mjs
npm run build -- --outDir tmp/request-3d-build
# paintAssetsPlugin을 포함한 Vite 서버가 실행되어 있어야 함
python scripts/build-complex-paint.py --base http://127.0.0.1:5180
python scripts/test-complex-paint.py --base http://127.0.0.1:5180
python scripts/test-complex-performance.py --production --label candidate
python scripts/test-complex-performance.py --production --webgl --label candidate
python scripts/test-complex-leak.py --cycles 8 --port 5180 --label candidate
```

`verify-complex-performance.py`는 전후 각각 3개 이상의 같은 환경 보고서, 첫 표시 3배, 입력/프레임 예산, 텍스처 품질 및 마지막 뷰 종료 후 메모리 회수를 모두 검사한다. 기준 미달 시 종료 코드 1을 반환한다. `modelBuildMs`만으로 배포를 승인하지 않는다.
