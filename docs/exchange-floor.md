# 증권 거래소

`/exchange`는 증시 전광판 아래에서 여는 28m × 23.62m, 층고 12.8m의 3D 거래소다. 중앙 시세벽, 거래 포스트 4개, 라운지 2곳, 모니터와 마키 24개, 이동형 티커 3개를 배치했다. Blender와 브라우저가 같은 배치 파일을 읽어 모니터의 물리적 외형과 데이터 화면 위치를 일치시킨다.

- 데스크톱은 WASD·방향키로 이동하고 드래그로 시점을 돌린다. Shift로 빠르게 걷고, 모니터를 클릭하거나 중앙에 놓고 Enter로 관제 화면을 연다.
- 터치 화면에서는 왼쪽 조이스틱으로 이동하고 나머지 화면을 드래그해 시점을 돌린다. 평면도가 위치·방향을 표시한다. 입구와 주요 관제 지점으로 바로 이동할 수 있다.
- 음향을 켜면 위치와 방향을 반영한 실내 환경음과 발걸음, 화면 선택음이 재생된다. 탭이 숨겨지면 렌더링·음향·주기 조회가 멈춘다.

## 데이터와 그래픽

코스피·코스닥은 기존 지수 및 지도 API, S&P 500은 기존 지수 티커와 S&P 500 편입 종목 순위 API를 사용한다. 10초 간격으로 시세를 확인하고, 원자재·환율·비트코인은 기존 Yahoo Finance 티커를 공유한다. 종목 범위와 업종 단순평균은 최대 50개 제공 표본 기준이다. 시가총액이 부족한 S&P 500에는 지수 편입 비중을 표시한다. 지수·종목·자산은 가능한 경우 시세 기준 시각을 표시한다. 거래 포스트 차트는 기존 종목별 일별 종가 시계열을 사용한다.

Three.js가 WebGPU를 우선 사용하고 호환 장치에서 WebGL 2로 전환한다. 3D를 시작하지 못한 경우에도 관제 화면에서 데이터에 접근할 수 있다. 정적 기하와 가구는 재질별 배치와 인스턴싱을 사용하며, 모니터와 티커는 각각 한 번에 그린다. Meshopt로 압축한 GLB에 PBR 텍스처를 넣고 HDR 환경광은 별도 파일로 제공한다. 시장 데이터 변경이나 표시 순서 전환 때 화면 텍스처를 갱신한다. 출력은 기기 픽셀 비율을 사용한다.

## 참고 및 소재

- 거래 포스트, 높은 홀과 대형 시세판의 배치는 NYSE의 거래소 사진과 역사를 참고해 독자적으로 설계했다. [NYSE 거래소 역사](https://www.nyse.com/history-of-nyse/) · [Library of Congress 사진 자료](https://guides.loc.gov/wall-street-history/stock-exchanges/images)
- 대리석, 월넛, 금속, 가죽, 카펫, 미장 소재는 ambientCG의 CC0 원본을 색·거칠기와 용도에 맞춰 가공했다. [Marble012](https://ambientcg.com/a/Marble012) · [Wood067](https://ambientcg.com/a/Wood067) · [Metal032](https://ambientcg.com/a/Metal032) · [Leather037](https://ambientcg.com/a/Leather037) · [Carpet006](https://ambientcg.com/a/Carpet006) · [Concrete034](https://ambientcg.com/a/Concrete034) · [ambientCG 라이선스](https://docs.ambientcg.com/license/)
- 라운지 의자와 테이블, 식재 및 HDR 환경광은 Poly Haven의 CC0 자산을 사용한다. [Modern Arm Chair](https://polyhaven.com/a/modern_arm_chair_01) · [Industrial Coffee Table](https://polyhaven.com/a/industrial_coffee_table) · [Potted Plant 04](https://polyhaven.com/a/potted_plant_04) · [Events Hall Interior](https://polyhaven.com/a/events_hall_interior) · [Poly Haven 라이선스](https://polyhaven.com/license)
- 장면 교환에는 Blender 5.2의 GLB 내보내기와 Three.js WebGPURenderer를 사용한다. [Blender glTF](https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html) · [Three.js WebGPU](https://threejs.org/manual/pages/webgpurenderer)

## 모델 재생성

```powershell
python scripts/fetch_exchange_sources.py <sources>
blender -b --factory-startup --python scripts/build_exchange_floor.py -- <sources> <output.glb> --blend <output.blend>
blender -b --factory-startup --python-exit-code 1 --python scripts/verify_exchange_panels.py -- <sources>
```

`frontend/src/exchange/layout.json`을 수정한 뒤 모델을 다시 내보낸다. 렌더링할 GLB, HDR, 입장 미리보기와 공유 이미지를 기존 `fdx5/kospimap-assets` GitHub Pages에 게시하고, 검증한 해시 경로를 `backend/app/data/asset_cdn.json`에 연결한다. 기존 URL에서 SHA 검증을 거친 정적 자산 주소로 리다이렉트된다.

패널 검증은 화면마다 15개 지점에서 브래킷·기둥과의 간섭을 검사하고 좌측·정면·우측의 보행 가능 위치에서 전체 화면이 보이는지 확인한다.
