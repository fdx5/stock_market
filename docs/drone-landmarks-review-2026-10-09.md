# 3D 드론 랜드마크 마무리 · 2026-10-09

검증 대상은 광안대교, 경복궁, 창경궁, 덕수궁, 서울올림픽주경기장이다.
Claude의 미완성 작업이 있던 `perf/drone-mobile-60` 작업본에서 이어서 수정했다.
운영 배포는 포함하지 않는다.

## 수정

- 음수 타일 좌표가 음수 난수 시드를 만들고 팔레트 조회에서 워커를 중단시키던 오류를 수정했다.
- 세 번 실패한 빈 타일을 완료로 계산하지 않고 지연 재시도를 유지한다.
- VWorld 랜드마크가 실제로 제공된 건물 범위에서만 기존 대체 형상을 숨긴다.
  모델은 늦게 도착한 DEM 높이에 맞춰 위치를 보정한다.
- 서버의 고해상도 JPEG가 없으면 원본 XDO에 포함된 JPEG 썸네일을 사용한다.
  취소된 요청에서는 대체 이미지를 디코딩하지 않는다.
- 광안대교의 복층 차선·난간과 케이블 끝 연결을 완성했다.
- 바다의 높이와 해안 거리 기준을 공유한다. 지역 수면이 준비되면 겹친 타일 수면을
  렌더링하지 않는다. 깊은 바다의 추정 바닥색은 지형 타일의 유무에 영향을 받지 않는다.
- 기존 CDN pin보다 늦게 추가된 드론 전용 파일은 배포 서버에서 직접 읽는다.

## 검증

타입 검사, 랜드마크·CDN 회귀 테스트 10개, 기존 부동산 테스트 12개,
전체 Vite 프로덕션 빌드를 실행했다. DB를 여는 백엔드나 DB 정리 테스트는 실행하지 않았다.

최종 WebGPU 캡처에서 모든 모델의 GPU 표시 준비가 완료됐으며 실행·HTTP 오류는 0건이다.

| 장소 | 모델 또는 구조 그룹 | 사진 적용 | 내장 썸네일 사용 | 주변 타일 |
|---|---:|---:|---:|---:|
| 광안대교 | 5 | 절차적 재질 | 0 | 90/90 |
| 경복궁 | 487 | 487/487 | 5 | 90/90 |
| 창경궁 | 51 | 51/51 | 2 | 90/90 |
| 덕수궁 | 45 | 45/45 | 0 | 77/77 |
| 서울올림픽주경기장 | 3 | 3/3 | 0 | 90/90 |

```powershell
cd I:/ai_root/sm-deploy/frontend
npx tsc --noEmit
node --test scripts/test-drone-landmarks.mjs scripts/test-scene-cdn.mjs
node scripts/test-realestate.mjs
npx vite build --outDir I:/ai_root/stock_market/output/drone-landmarks-20261009/release-build --emptyOutDir false
```

`scripts/landmark-review.html`은 서비스의 DroneWorld, Landmarks, ComplexRenderer를 사용하는
별도 검증 장면이다. `site`는 `gwangan`, `gyeongbokgung`, `changgyeonggung`, `deoksugung`,
`olympic-stadium`이며 `renderer=webgpu`에서 실제 서비스 렌더러를 사용한다.
기본 WebGL 경로도 제공한다. `/review-key`와 `/api/realestate`는 검증 전용 읽기 API
`127.0.0.1:8017`로 연결한다. 공개 지도 키와 번들 해안 자료만 제공했고,
횡단보도 응답은 빈 목록으로 대체해 이번 검증에서 제외했다.

```powershell
$env:LANDMARK_REVIEW_OUT_DIR='I:/ai_root/stock_market/output/drone-landmarks-20261009/review-build'
npx vite build --config vite.landmark-review.config.mjs
npx vite preview --config vite.landmark-review.config.mjs --port 5198 --strictPort
```

검증 브라우저는 사용자 브라우저와 분리된 새 임시 컨텍스트를 사용했다.
기존·운영·백업 DB와 사용자의 기존 브라우저 캐시는 접근하거나 변경하지 않았다.
각 모델의 GPU 표시 준비, 주변 타일 완료, 사진 적용, 실행·HTTP 오류를 확인한 뒤
1600×1000 원본 스크린샷을 저장했다. 이미지 보정·합성은 하지 않았다.

산출물은 `I:/ai_root/stock_market/output/drone-landmarks-20261009/`에 있다.
`report.html`은 다섯 스크린샷을 함께 보여 주고, `final-webgpu/report.json`은 원본 측정값이다.

## 표현 범위

광안대교 모델은 주교량·접속교의 입력 선형 약 4km를 표현하는 절차적 모델이다.
전체 진출입 램프를 포함한 정밀 측량 모델은 아니다.
궁궐·경기장 모델은 VWorld가 제공하는 측량 당시 자료다.
경기장 모델은 현재 공사 현황을 표현하지 않는다.
모델 수는 지정 반경에서 로딩한 모델 수이고, 개별 건축물의 공식 총수는 아니다.
궁궐의 지면과 수목은 기존 지형·지적도 표현이다.
썸네일로 복구한 사진은 원본 고해상도 사진보다 해상도가 낮다.
별도 검증 장면에서 확인한 것으로 운영 UI 전체, 모바일 GPU와 외부 지도 서비스의
지속적인 가용성까지 검증한 것은 아니다.
