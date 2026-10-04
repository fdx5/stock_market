# 건물 검은 면·거울 반사 / Safari 메모리 공통 수정 — 2026-10-04

## 제보와 판정 범위

`I:/ai_root/소셜/error.png`는 신동아파밀리에에서 주변 **신일1**을 선택한 뒤 벽 전체가 반사면처럼 보이고 각도에 따라 검어지는 제보다. 신일1 ID는 `41150:신곡동:456:신일1`이다. 이전 `I:/ai_root/test/TEST1.png`는 뉴삼익호원2의 창문 면이 검게 남는 사례다. 정상적인 밤 표현으로 분류하지 않는다.

새로 연 Edge에서 단지·시간 전환만으로 제보 이미지의 자연 발생 조건은 아직 재현하지 못했다. 아래의 확인된 코드 결함 수정과 제보 화면의 단일 원인 확정을 구분한다. 화면 전체가 검지 않았다는 사실만으로 특정 건물 면의 정상 여부를 판정하지 않는다.

## 재질 수명 결함

이전 `ComplexRenderer.sync`는 단일 재질의 `srcVersion`만 비교했다. 서로 다른 재질 객체가 같은 버전 번호를 가지면 교체하지 않았고 배열 재질의 교체도 검사하지 않았다. 이후 정리 작업은 실제 화면의 네이티브 재질 대신 Three 객체의 현재 재질 목록으로 사용 여부를 계산했다. 교체가 지연되거나 누락되면 그려지고 있는 이전 재질·uniform buffer를 해제할 수 있었다.

공통 수정:

- 재질 **객체 동일성 + 버전 + 배열의 모든 슬롯**을 비교한다.
- 새 재질의 GPU 파이프라인이 준비될 때까지 이전 재질을 유지한다.
- 실제 메시가 그리는 재질의 원본도 사용 중인 목록에 포함한다.
- 텍스처 정리 시 원본의 현재 map 목록과 실제 네이티브 binding을 모두 확인한다. 실제 binding에 있는 텍스처는 추적 목록에도 유지해 마지막 사용 후 해제한다.

`test-native-material-lifetime.mjs`는 `git show 4e3b741:.../ComplexRenderer.js`의 **실제 이전 sync 함수**와 수정 함수를 실행한다. 이전 함수는 같은 버전의 다른 객체로 교체된 상황에서 여전히 그리는 재질을 dispose했다. 수정 함수는 컴파일 대기 중 재질을 유지하고 준비 완료 후 교체했다. 배열 슬롯과 binding 유지도 별도로 검증한다.

신일1/신동아파밀리에 실제 WebGPU 장면에 같은 버전의 다른 재질 객체를 주입했다. 초기 3회와 최종 2회 검사에서 새 객체 반영, 실제 GPU 텍스처 유지, 재질 생존을 확인했다. 최종 검사에서는 해당 재질을 쓰던 모든 메시(각각 3개, 1개)를 바꿨다. 브라우저 오류 0건이었다. 주입 검사는 결함 경로 검증이며 자연 발생 제보의 재현으로 기재하지 않는다.

재질 검사는 기존 버전 비교에 객체 비교를 추가하는 수준이다. 실제 binding 보존 검사는 자원 정리 시 수행하며 프레임마다 GPU 픽셀을 읽지 않는다.

## WGSL 미분 연산 결함

창문 내부 셰이더는 픽셀마다 달라지는 `roomOpen` 분기 안에서 `dpdx`, `dpdy`, `fwidth`를 호출했다. 미분을 분기 앞에서 계산해 전달하도록 바꿨다. 실제 이전/수정 interior 코드 조각을 `diagnostic(error, derivative_uniformity)` 조건으로 GPU에서 컴파일한 결과, 이전 코드 오류 1건(`fwidth must only be called from uniform control flow`), 수정 코드 오류 0건이었다. 원래 엔진의 경고 비활성화가 이 결함을 숨기고 있었다.

규칙 출처: [W3C WGSL derivative built-in functions](https://www.w3.org/TR/WGSL/#derivative-builtin-functions). 이 결함과 사용자 사진의 직접적인 인과관계는 아직 확정하지 않는다.

## Safari / Apple 터치 기기 메모리 정책

기존에는 `deviceMemory` 미제공 시 8GB로 간주했고, 픽셀 제한을 `hq` 데스크톱에만 적용했다. iPad의 데스크톱 Mac UA나 외부 마우스 사용도 고려해야 한다. 단지 이동은 이전 장면을 유지하면서 새 장면을 만들었고 WebGL HDR target은 MSAA 4 samples를 항상 사용했다.

`sceneDeviceBudget.ts`로 정책을 통합했다. iPad/iPhone UA, `MacIntel + maxTouchPoints > 1`, 보고된 메모리 4GB 이하를 제한 대상으로 취급한다.

| 자원 | 제한 기기 정책 |
| --- | --- |
| 시작 렌더 목표 | 125만 픽셀 |
| 화면 버퍼 상한 | 200만 픽셀, DPR 최대 1.5, 축별 반올림도 고려 |
| 강제 pr / 확대 / 화면 크기 변경 | 같은 절대 상한 적용 |
| 회전·확대 중간 버퍼 | 위험한 이전 축을 먼저 축소, WebGL은 크기+배율 동시 설정, composer는 물리 픽셀 단일 설정 |
| 네이티브 그림자 | 1024, AO/bloom 등 low 정책 |
| WebGL 그림자 / HDR MSAA | 1024 / 0 samples |
| 전경 건물 paint | 최대 긴 변 768, 월드 repeat/offset 유지 |
| 주변 건물 raster | scale 최대 0.5 |
| raster worker | 1개, 생성 작업 큐잉 |
| 단지 전환 | 이전 모델 해제 후 새 모델 생성, 동시 보관 방지 |
| 단지 이름 2D 캔버스 | 같은 픽셀 상한, sprite DPR 제한 |
| WebGL context loss | 복구 대기 표시, 복구 시 모델 재생성 |

작업 해상도도 낮추며 준비된 atlas·캐시·worker 미지원 canvas 결과까지 공통 크기 검사한다. GPU 공유 키에는 크기를 포함하고 축소 전 bitmap/canvas를 해제한다. 축소 대기 중 화면이 닫히면 결과도 해제한다. architecture normal/roughness는 동일한 축소 크기를 유지해 단일 packed GPU surface를 계속 사용한다. 저장 캐시도 architecture surface 공유 메타데이터를 보존하도록 했다.

제한 기기는 이전 모델을 보관하지 않으므로 새 장면 준비 상태를 표시한다. 건물·조경 요소를 새로 삭제하는 규칙은 추가하지 않았다. 텍스처 세밀도와 그림자/후처리 정밀도를 메모리 예산에 맞춘다.

## 검증과 해석

- 정책 검사: 데스크톱 iPad UA, 일반 iPad/iPhone UA, Mac 데스크톱, 작은 메모리 장치, `pr=100`, 큰 화면의 실제 반올림된 크기까지 상한 확인.
- 실제 WebGPU에 데스크톱 iPad navigator profile을 적용한 4회 단지/시간 전환: 약 176만 화면 픽셀, low 정책, 전경 paint 긴 변 최대 768, GPU binding 원본 객체 동일성 유지, 조경 complete, 오류 0건.
- 같은 프로필의 Chromium WebGL 3회 전환: 조경 complete, 오류 0건.
- WebGPU 카운터는 unique texture texels 약 2,958만~3,225만이었다. 포맷·mipmap·임시 target·브라우저 내부 복사까지 합친 실측 GPU RAM이 아니므로 총 메모리 감소율로 발표하지 않는다.
- Windows Playwright WebKit 3회 단지 전환과 WebGL context loss/restore를 통과했다. 복구 후 모델 재생성과 오류 0건을 확인했다. **물리 iPad Safari의 OS 메모리 종료 여부를 검증한 결과로 대체하지 않는다.**
- WebKit 검사에서 단지 이름 캔버스가 별도로 454만 픽셀을 사용하는 것을 발견해 같은 상한을 적용했다. 검사 도중의 장면 준비 화면과 완료 화면을 구분하도록 각 단지의 새 `shownAt`을 기다린다.
- GPU readback과 교체 주입은 진단 부하가 있으므로 FPS/로딩 벤치마크로 사용하지 않는다. 7초 전체 로딩 또는 드랍 0 달성으로 발표하지 않는다.

재검증은 저장소 루트 기준이다.

```powershell
node --test frontend/scripts/test-native-material-lifetime.mjs frontend/scripts/test-scene-device-budget.mjs
python frontend/scripts/test-interior-wgsl.py
python -X utf8 frontend/scripts/test-safari-scene.py http://127.0.0.1:4195
python -X utf8 frontend/scripts/test-facade-timeline.py --target 신일1 --url <신동아파밀리에 URL> --material-swap --iterations 3
```

상세 JSON/이미지는 `tmp/local-final-material-after*`, `tmp/local-ipad-native-after*`, `tmp/local-ipad-webgl-after*`, `tmp/interior-wgsl-validation.json`, `tmp/local-webkit-safari-after*`에 보관한다. 원본 API 키가 들어간 요청 URL은 커밋하지 않는다. 새로운 기기·반복 조건 증거가 확보되면 미확정 항목을 갱신한다.
