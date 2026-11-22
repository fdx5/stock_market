# 증권 거래소

`/exchange`는 42m × 31.5m(1,323㎡, 400.2평), 층고 20m의 3D 거래소다. 뉴욕 증권거래소 메인 플로어의 공간 문법(금박 격자 천장과 라이트, 대리석 필라스터와 코린트풍 금박 주두, 벽면 빅 보드, 벨 포디움 발코니, 방문객 갤러리, 원형 트레이딩 포스트와 머리 위 모니터 링, 벽면 브로커 부스)을 따라 독자적으로 설계했다. 상표·로고는 사용하지 않는다.

- 데이터 패널 58종(기존 16종)을 229개 화면에 배치한다: 빅 보드(지수·대형 차트·자매 시장), 시장 지도(업종별 트리맵), 히트맵, 시장 폭, 등락률 분포, 업종, 시총 비중, 투자자별 수급, 3대 시장, 세계 시각(아날로그 6개 도시), 거래 세션(카운트다운), 시총·상승·하락·거래대금 상위, 세계 지수, 세계 시총 TOP, 반도체·빅테크·디지털 자산 데스크, 지수 선물, 미 국채 금리(2s10s), 핫이슈, 핵심 지표·일정, 환율, 귀금속, 에너지, 농산물, 자산 단일 시세판 8종, 포스트 종목 16종.
- 티커 5종: 북벽 앰버 도트 매트릭스(Doto), 갤러리 시안 세계 시세, 동벽 원자재, 서벽 핫이슈 헤드라인, 포스트 원통형 링. 스크롤은 셰이더 uniform으로 처리해 텍스처 업로드가 없다.
- 목록형 패널(시총·상승·하락·거래대금 상위, 업종, 히트맵, 수급, 핫이슈)은 7초마다 다음 페이지로 슬라이드·페이드 전환한다. 패널마다 시차를 둔다.
- 데스크톱은 WASD·방향키, Shift 달리기, 드래그 시점(보간), 모니터 클릭·Enter로 관제 화면을 연다. 관제 화면은 3D 화면과 같은 페인터를 기기 해상도로 그린다. 터치 화면은 왼쪽 조이스틱과 드래그를 쓴다.

## 색과 재질 (v4, 2026-11-22)

v3의 금박·황동·장밋빛 대리석 위주 배색을 바꿨다. 미드나잇 네이비(천장 우물 반자·프리즈·하부 벽 울 패브릭·포스트 캐노피), 그레이지 트래버틴 벽, 화이트 스태추어리 필라스터, 샴페인 니켈 몰딩·난간·띠, 스모크드 오크 가구(포스트 캐비닛 패널은 토프 나파 가죽 — 월넛·네이비 패널 조합은 서로 부딪혀 제외), 다크 베르데 바닥. 금색은 정면 브론즈 황소의 뿔에만 남긴다(텍스처가 밝은 뿔 면에만 금 재질). 조명은 3,500K 전후(앰버 없음). 창틀은 그래파이트. `derive_exchange_palette.py`가 CC0 원본에서 채도·평균색만 바꾼 텍스처(greige, statuary, nickel, pnickel, smokedoak, hide, 니켈 샹들리에)를 추가로 만든다. 화면 주변이 어두워져 전광판 대비가 커졌다.

## 렌더링

- Blender 5.2 Cycles(OptiX)로 전역 조명을 4K 라이트맵 2장(구조/집기)에 굽는다. 브라우저는 실시간 그림자 없이 라이트맵(`uv1`)과 홀 자체를 Cycles로 촬영한 등장방형 HDR(`hall-env-v4.hdr`)을 반사 환경으로 쓴다.
- 화면은 검은 유리(거칠기 0.11, 반사 0.36) 위 발광 텍스처로 OLED처럼 보이게 한다. 패널은 720 설계 단위로 그리고 텍스처 해상도(1,152~3,840px, 저메모리 기기 0.62배)에 맞춰 스케일한다. 다시 그리기는 프레임당 4ms 예산 안에서 나눠 처리한다.
- 모바일 프리징·좌우 회전 랙 대책: 패널은 크기별 공유 OffscreenCanvas에 그리고 `transferToImageBitmap`으로 넘긴다(createImageBitmap(canvas)는 2D 캔버스 GPU→CPU 읽기를 유발). 비트맵은 GPU 업로드 직후 닫는다. 업로드는 프레임당 1장(터치)/2장으로 제한하고 `renderer.initTexture`로 즉시 올린다 — three.js는 바뀐 텍스처를 메시가 다시 그려질 때 올리므로, 예전엔 시점을 돌리는 순간 뒤쪽 패널 여러 장이 밉맵과 함께 한 프레임에 몰렸다. 화면에 보이는 패널을 먼저 그리고, 안 보이는 패널은 백그라운드에서 일정 간격으로 갱신한다. 시계·세션은 보일 때만 매초 다시 그린다. 터치 기기는 페이지 전환 애니메이션 없이 한 번에 넘긴다. 홀 텍스처는 로드 직후 모두 업로드한다. 모니터 선택 가림 판정은 전체 홀 메시 레이캐스트(탭마다 수백 ms) 대신 포스트·갤러리·포디움·장애물의 상자·원기둥으로 한다. 텍스트 폭은 100px 기준으로 캐시해 크기만 비례 환산한다. meshopt 디코딩은 워커에서 한다.
- 몰입·전체화면에서는 화면 위 터치 이동이 페이지 제스처(스크롤·당겨서 새로고침·스와이프 전체화면 종료)가 되지 않게 막고, 스크롤 목록만 자체 팬을 허용한다. 브라우저가 전체화면을 풀어도 몰입 모드면 다음 탭에서 복구한다(‘축소’로만 나감).
- 60fps 유지: 블룸 → 픽셀 비율 상한(1.6 → 1.25) 순으로만 단계적으로 낮춘다. `?exchangeMetrics=1`이면 캔버스 `data-frame-ms`, `data-draw-calls`, `data-paint-ms`에 계측값을 기록한다. `?bloom=0`은 블룸을 끈다.
- 글꼴(OFL): Pretendard Variable, IBM Plex Sans Condensed/Mono, Doto, Big Shoulders Display — `frontend/public/3d/exchange-floor/fonts/SOURCES.md`.

## 데이터

코스피·코스닥은 지수·지도 API(표본 80종목), S&P 500은 S&P 500 순위 API를 쓴다. 공용 티커(원자재·환율·코인·미국 종목·선물), 세계 지수, 원자재 선물 27종, 투자자 수급, 미 국채, 코스피200 주·야간 선물, 오늘의 핫이슈, 세계 시총 TOP 20을 화면이 보일 때만 주기 조회한다. 업종 등락률은 표본의 시가총액 가중 평균이다.

## 통계

`reportExchange`가 `exchange:<동작>` 클릭 이벤트(메뉴 진입, 3D 입장 렌더러·실패, 관제 화면, 이동, 시장 전환, 음향)를 남긴다. 관리자 콘솔 “증권 거래소” 탭(`/api/admin/exchange/stats`, SELECT 전용)에서 조회·세션·3D 성공률·많이 연 화면을 본다.

## 참고 및 소재

- 공간 구성 참고: [NYSE 거래소 역사](https://www.nyse.com/history-of-nyse/) · [Library of Congress 사진 자료](https://guides.loc.gov/wall-street-history/stock-exchanges/images)
- ambientCG CC0 소재: Marble016(바닥), Marble020(벽, 그레이지로 재톤), Marble014(필라스터), Metal048A·Metal042A(니켈로 재톤), Wood066(스모크드 오크 톤으로 재톤), Carpet012, Leather026, PaintedPlaster017, Metal032 · [라이선스](https://docs.ambientcg.com/license/)
- Poly Haven CC0 모델: Chandelier_03, bull_head, sofa_02, mid_century_lounge_chair, potted_plant_02, marble_bust_01, vintage_grandfather_clock_01, modern_coffee_table_01 · [라이선스](https://polyhaven.com/license)

## 모델 재생성

```powershell
python scripts/exchange_layout.py                      # layout.json (화면·동선·장애물)
python scripts/fetch_exchange_sources.py <sources>
python scripts/derive_exchange_palette.py <sources>      # v4 팔레트 텍스처(추가 파일만 생성)
blender -b --factory-startup --python-exit-code 1 --python scripts/build_exchange_floor.py -- <sources> <out> --samples 384
python scripts/glb_webp.py <out>/trading-hall-v4.glb <out>/hall-webp.glb
npx gltfpack -i <out>/hall-webp.glb -o trading-hall-v4.glb -cc -kn -km -ke -kv -vt 14 -vp 16
blender -b --factory-startup --python-exit-code 1 --python scripts/verify_exchange_panels.py -- <sources>
```

`-kv`는 필수다(없으면 라이트맵 UV가 지워져 면이 검게 나온다). 빌드는 `frontend/src/exchange/bake.json`(라이트맵 배율)을 갱신한다. GLB·라이트맵·HDR·글꼴은 `fdx5/kospimap-assets` GitHub Pages에 추가 게시하고 `backend/app/data/asset_cdn.json`에 연결한다.
