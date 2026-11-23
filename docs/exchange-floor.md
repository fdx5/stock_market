# 증권 거래소

`/exchange`는 반지름 26.6m의 원형 아트리움(2,223㎡, 672평), 층고 20m의 3D 거래소다(v5, 2026-11-22). 사용자 제공 컨셉 이미지 3장(Gemini 생성, 원본 `I:/ai_root/stock_market/sample`)을 기준으로 만들었다: 3개 층 곡면 갤러리(+5 / +9.5 / +14m, 유리 난간·오크 핸드레일·하부 웜 코브·뒤편 유리 오피스), 12개 분기형 트리 기둥과 늑재 아치, 중앙 오큘러스를 둔 방사형 스카이라이트, 빛 필라멘트가 든 유리 라이트 코어를 감싼 다단 스크린 링, 6개 방사형 통로로 나뉜 3열 곡면 트레이딩 데스크(좌석 90, 모니터 3~6대), 중앙 원형 카운터, 라운지·수경·플랜터. 사람은 만들지 않는다.

- 데이터 패널 58종을 512개 화면에 배치한다: 라이트 코어 링 패싯 54, 갤러리 곡면 보드 14(북쪽 메인 보드 17×6.4m, 세계 시각·세션·시장 지도·세계 지수 등), 갤러리 앞면 티커 리본 4, 코어 티커 링 2, 데스크·카운터 모니터 438.
- 티커 5종: 갤러리 1층 앞면 앰버 도트 매트릭스 리본(360°), 갤러리 2층 핫이슈 리본, 갤러리 3층 시안 세계 시세·원자재 리본, 코어 상·하단 원통 링. 스크롤은 셰이더 uniform이라 텍스처 업로드가 없다. 곡면 보드·리본은 중심을 향한 원호 메시다.
- 목록형 패널(시총·상승·하락·거래대금 상위, 업종, 히트맵, 수급, 핫이슈)은 7초마다 다음 페이지로 슬라이드·페이드 전환한다. 패널마다 시차를 둔다.
- 데스크톱은 WASD·방향키, Shift 달리기, 드래그 시점(보간), 모니터 클릭·Enter로 관제 화면을 연다. 관제 화면은 3D 화면과 같은 페인터를 기기 해상도로 그린다. 터치 화면은 왼쪽 조이스틱과 드래그를 쓴다.

## 공간과 재질 (v5)

컨셉의 낮 시간대 톤: 밝은 웜 그레이 석재 바닥(Marble012 재톤)과 차콜 카펫 타일(데스크 구역), 웜 트래버틴 기둥·갤러리 앞면·늑재(Travertine009 재톤), 오크 슬랫 천장(갤러리 하부·지붕 외곽)과 데스크·핸드레일(WoodFloor051), 웜 화이트 데스크 상판, 그레이 패브릭 프라이버시 스크린, 리넨 라운지 소파(sofa_03 재톤), 머니트리·관엽 식물. 조명은 스카이라이트 주광(Nishita 하늘+태양, 유리는 그림자를 만들지 않음)과 3,000K 코브 라인·다운라이트. 기둥 안쪽 면에는 데이터 LED 스트립(빌드 시 생성한 발광 텍스처).

## 렌더링

- Blender 5.2 Cycles(OptiX)로 전역 조명을 4K 라이트맵 2장(구조/집기)에 굽는다. 브라우저는 실시간 그림자 없이 라이트맵(`uv1`)과 홀 자체를 Cycles로 촬영한 등장방형 HDR(`hall-env-v5.hdr`)을 반사 환경으로 쓴다.
- 화면은 검은 유리(거칠기 0.11, 반사 0.36) 위 발광 텍스처로 OLED처럼 보이게 한다. 패널은 720 설계 단위로 그리고 텍스처 해상도(1,152~3,840px, 저메모리 기기 0.62배)에 맞춰 스케일한다. 다시 그리기는 프레임당 4ms 예산 안에서 나눠 처리한다.
- 모바일 프리징·좌우 회전 랙 대책: 패널은 크기별 공유 OffscreenCanvas에 그리고 `transferToImageBitmap`으로 넘긴다(createImageBitmap(canvas)는 2D 캔버스 GPU→CPU 읽기를 유발). 비트맵은 GPU 업로드 직후 닫는다. 업로드는 프레임당 1장(터치)/2장으로 제한하고 `renderer.initTexture`로 즉시 올린다 — three.js는 바뀐 텍스처를 메시가 다시 그려질 때 올리므로, 예전엔 시점을 돌리는 순간 뒤쪽 패널 여러 장이 밉맵과 함께 한 프레임에 몰렸다. 화면에 보이는 패널을 먼저 그리고, 안 보이는 패널은 백그라운드에서 일정 간격으로 갱신한다. 시계·세션은 보일 때만 매초 다시 그린다. 터치 기기는 페이지 전환 애니메이션 없이 한 번에 넘긴다. 홀 텍스처는 로드 직후 모두 업로드한다. 모니터 선택 가림 판정은 전체 홀 메시 레이캐스트(탭마다 수백 ms) 대신 포스트·갤러리·포디움·장애물의 상자·원기둥으로 한다. 텍스트 폭은 100px 기준으로 캐시해 크기만 비례 환산한다. meshopt 디코딩은 워커에서 한다.
- 모바일 전체화면에서는 거래소가 브라우저 안의 뷰포트를 채운다. 화면 드래그는 카메라를 돌리고 스크롤 목록만 자체 팬을 허용한다. ‘축소’ 버튼을 누르면 기본 화면으로 돌아온다.
- 60fps 유지: 블룸 → 픽셀 비율 상한(1.6 → 1.25) 순으로만 단계적으로 낮춘다. `?exchangeMetrics=1`이면 캔버스 `data-frame-ms`, `data-draw-calls`, `data-paint-ms`에 계측값을 기록한다. `?bloom=0`은 블룸을 끈다.
- 글꼴(OFL): Pretendard Variable, IBM Plex Sans Condensed/Mono, Doto, Big Shoulders Display — `frontend/public/3d/exchange-floor/fonts/SOURCES.md`.

## 데이터

코스피·코스닥은 지수·지도 API(표본 80종목), S&P 500은 S&P 500 순위 API를 쓴다. 공용 티커(원자재·환율·코인·미국 종목·선물), 세계 지수, 원자재 선물 27종, 투자자 수급, 미 국채, 코스피200 주·야간 선물, 오늘의 핫이슈, 세계 시총 TOP 20을 화면이 보일 때만 주기 조회한다. 업종 등락률은 표본의 시가총액 가중 평균이다.

## 통계

`reportExchange`가 `exchange:<동작>` 클릭 이벤트(메뉴 진입, 3D 입장 렌더러·실패, 관제 화면, 이동, 시장 전환, 음향)를 남긴다. 관리자 콘솔 “증권 거래소” 탭(`/api/admin/exchange/stats`, SELECT 전용)에서 조회·세션·3D 성공률·많이 연 화면을 본다.

## 참고 및 소재

- 공간 구성 기준: 사용자 제공 컨셉 이미지 3장(원형 아트리움·트리 기둥·라이트 코어 스크린 링). 상표·로고·인물은 만들지 않는다.
- ambientCG CC0 소재: Marble012(석재 바닥, 웜 재톤), Travertine009(기둥·앞면·늑재, 재톤), WoodFloor051(오크), Fabric030(카펫), Carpet014(리넨·패브릭, 재톤), Plaster001, Leather030, Metal032 · [라이선스](https://docs.ambientcg.com/license/)
- Poly Haven CC0 모델: sofa_03(리넨 재톤), mid_century_lounge_chair, coffee_table_round_01, pachira_aquatica_01, tree_small_02, fern_02, potted_plant_02 (빌드 시 삼각형 예산으로 데시메이트) · [라이선스](https://polyhaven.com/license)

## 모델 재생성

```powershell
python scripts/exchange_layout.py                      # layout.json (원형 평면·화면·동선·가림체)
python scripts/fetch_exchange_sources.py <sources>       # ambientCG·Poly Haven CC0 + 재톤
blender -b --factory-startup --python-exit-code 1 --python scripts/build_exchange_atrium.py -- <sources> <out> --samples 384 --preview
# 빠른 검토: ... -- <sources> <out> --preview-only --preview-samples 48 --shots concept,spawn
python scripts/glb_webp.py <out>/trading-hall-v5.glb <out>/hall-webp.glb
npx gltfpack -i <out>/hall-webp.glb -o trading-hall-v5.glb -cc -kn -km -ke -kv -vt 14 -vp 16
python scripts/exchange_ktx2.py frontend/public/3d/exchange-floor --toktx <KTX-Software>/bin/toktx
```

`-kv`는 필수다(없으면 라이트맵 UV가 지워져 면이 검게 나온다). 빌드는 `frontend/src/exchange/bake.json`(라이트맵 배율)을 갱신한다. 걷기·충돌·모니터 가림 판정은 layout.json의 원·부채꼴 고체(`circles`, `arcs`, `occluders`)로 한다. GLB·라이트맵·HDR·글꼴은 `fdx5/kospimap-assets` GitHub Pages에 추가 게시하고 `backend/app/data/asset_cdn.json`에 연결한다.

## v5 기능 (2026-11-22)

- 4개 층 탐험: 1층 + 갤러리 2·3·4층(+5 / +9.5 / +14m). 북서쪽 공중 스위치백 계단(오크 디딤판·유리 난간, 29/26/26단, 단높이 17cm)과 원형 투명 파노라마 엘리베이터 2대(120°·240°, 유리 슬라이딩 문, 1F~4F 버튼; 운행 중 시점은 중앙 홀을 향함). 보행은 layout.json `walk`(지면·갤러리 링·계단·랜딩·문턱·캐빈)의 높이 표면으로 판정한다.
- 외곽 산책로: 유리 오피스 대신 오크 슬랫 벽과 그림 벽, 벽에 붙인 곡면 소파, 조형물 받침. 통로 최소 폭 3.2m 이상(레이아웃 생성 시 검증).
- 미술관: 퍼블릭 도메인 명화 31점(Wikimedia Commons, `scripts/fetch_exchange_art.py`)과 Poly Haven CC0 조형물 9점(`scripts/render_exchange_sculptures.py`). 모바일 벽에는 공용 미리보기(`python scripts/build_exchange_art_preview.py`)를 먼저 표시하고 실제 액자 위치를 기준으로 시야에 들어오는 작품부터 1K 이미지를 표시한다. 클릭하면 3,840px 원본을 전체 화면에서 감상할 수 있다(휠·핀치 확대, 드래그 이동). 감상 중에는 3D 렌더링을 멈춘다.
- 조경: 화분 일체형 모델만 외곽에 소수 배치(안쪽 데스크 구역에는 없음), 빌드 시 식물·좌석 겹침 검사. 꽃 20종은 버텍스 컬러 한 재질.
- 성능: 패널 그리기는 Worker(OffscreenCanvas)에서, 정적 소품은 8구역 병합(드로우콜 ~130), 첫 화면은 전광판이 다 그려진 뒤 공개. 모델 URL에 베이크 키를 붙여 캐시된 옛 모델을 쓰지 않는다.
- iPadOS와 터치 기기에서는 GPU가 지원하는 경우 원본 텍스처 크기의 KTX2 모델과 4K 라이트맵을 사용한다. WebGPU를 제공하는 브라우저에서는 먼저 WebGPU를 초기화하고, 사용할 수 없거나 렌더링이 실패하면 WebGL 2로 복구한다. 모바일은 모델과 라이트맵을 순서대로 준비하고 시야에 들어오는 메시부터 렌더링한다. 반사 환경과 주변 그림은 입장 뒤에 로드한다. WebGL 2와 모바일은 첫 프레임에서 필요한 재질부터 컴파일한다.
- 티커: 종목명 오른쪽에 기업 로고, 기둥 LED 스트립은 실시간 시세 카드가 위로 흐르는 세로 티커.

## v6 기능 (2026-11-23)

- 그랜드 아트리움 건축 리마스터(`scripts/build_exchange_atrium.py`, `scripts/prepare_exchange_v6_sources.py`): ambientCG CC0 럭셔리 PBR 4종(Calacatta 대리석 `Marble006`, Emperador 다크 대리석 `Marble016`, Brushed Champagne Brass `Metal049A`, American Walnut `Wood067`) 추가. 이중 프로파일 I-빔 볼트 아치, 3단 조각 오큘러스 크라운, 바닥-천장 도심 스카이라인 채광창, 다이아몬드 브라스 인레이 월넛 피처 월, 뮤지엄 리세스 아트 니치, 방사형 브라스 인레이 대리석 광장, 플루티드 월넛 중앙 커맨드 카운터 및 곡면 트레이딩 포드.
- WebGPU/TSL 실시간 셰이더(`frontend/src/exchange/atriumFx.ts`): 수경 잔물결·커스틱스 셰이더(`WaterSurface`), 반투명 홀로그램 유리 코어(`HoloCoreFX`) 및 역회전 궤도 링, 볼류메트릭 빛기둥, 부유 광입자.
- 지수 등락 연동 중앙 네온 발광: 선택 시장 기준 지수의 등락률에 따라 하락 시 블루 계열(스카이→코발트→딥 사파이어), 상승 시 레드 계열(코랄→크림슨→딥 루비), 보합 시 아이스-시안으로 중앙 네온 코어·48개 개별 360° 회전 네온 로드(`InstancedMesh`)·홀로그램 링·바닥 라이트 웰·천장 오큘러스 코브가 낙폭/상승폭에 비례해 채도와 발광 강도·회전 속도·펄스가 강해진다.
- 실시간 3종 조명 무드(`주간` / `골든아워` / `네온나이트`) 및 Catmull-Rom 시네마틱 투어 카메라 추가. 4K Cycles OptiX 라이트맵 2장 + 2K HDR(`hall-env-v6.hdr`) + 16-bit UV meshopt GLB + 모바일 KTX2(`trading-hall-v6-ktx2.glb`).
- 시각·인터랙션 고도화: 트레이딩 데스크 모서리·엘리베이터 천장/캡 공면 z-fighting 완전 분리 리베이크, 명화 클릭 시 1K 상시 유지 + 4K 오프스크린 디코드 크로스페이드로 재깜빡임 제거, 조각상 클릭 시 공유 WebGPU 캔버스·HDR 위에서 즉시 구동되는 360° 3D 인터랙티브 뮤지엄 스튜디오(자유 회전·확대/축소·이동·자동 회전·정면 초기화) 추가.
- 극사실주의 럭셔리 리마스터(2026-11-23): `AgXToneMapping` 저눈부심 고급 조도 캘리브레이션, 1층 Calacatta 대리석 광장 레이어 컬링 실시간 평면 거울 반사(`reflector()`, Layer 1 전용 + 석재 광물결 + 상층/상방 자동 정지로 좌우 360° 고속 회전 시에도 60 FPS 유지), 4K Cycles 레이트레이싱 앰비언트 오클루전(AO) 라이트맵 합성(런타임 0ms 접촉 그림자), 전체 PBR/라이트맵 8× 비등방성 필터링, 천창 실시간 대기·구름 셰이더(`mx_fractal_noise_float`), 1~4층 전 창문 서울 여의도 주·야간 스카이라인(`skyline-day-v6.webp`, `skyline-night-v6.webp`), 저철분 광학 프레넬 유리, 31개 명화 전용 Cycles 뮤지엄 스포트라이트 + 액자 바깥 벽면 컷아웃 2900K 월-워시 + 전 작품 3840px 4K 고화질 통일, 이탈리아 디자이너 곡면 소파(플로팅 월넛 받침·웰트 음영·2단 등받이·가죽 볼스터·사이드 테이블)·가죽 트레이딩 체어·5성급 보태니컬 플로럴 적용.
