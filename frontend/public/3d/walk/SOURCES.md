# 직접 걷기(/walk) 에셋 출처

실내 자재 텍스처는 모두 Poly Haven(https://polyhaven.com)의 CC0 자산이다. 저작자 표시 의무는 없지만 기록해 둔다. 2K JPG(Diffuse·nor_gl·ARM)를 받아 webp로 변환했다. 바닥재 4종은 2048px, 나머지는 1024px이다.

| 파일 접두사 | Poly Haven 자산 | 실제 크기(1회 반복) | 작성자 | 가공 |
|---|---|---|---|---|
| laminate_floor_02 | laminate_floor_02 | 1.70 m | Dario Barresi, Charlotte Baglioni | webp 변환 |
| herringbone_parquet | herringbone_parquet | 3.40 m | Jenelle van Heerden, Sergej Majboroda | webp 변환 |
| marble_white | marble_01 | 1.50 m | Rob Tuytel | 디퓨즈를 회색조로 바꾸고 밝게 들어 올림(흰 대리석). nor/arm은 원본 그대로 |
| granite_tile | granite_tile | 2.30 m | Charlotte Baglioni | webp 변환 |
| plastered_wall_02 | plastered_wall_02 | 2.23 m | Charlotte Baglioni | 노멀·거칠기만 사용(실크벽지 질감) |
| poly_wool_herringbone | poly_wool_herringbone | 0.27 m | colormass, Rico Cilliers | webp 변환 |
| rough_linen | rough_linen | 0.27 m | colormass, Rico Cilliers | 디퓨즈를 무채색으로 바꿈(원본은 파란색). 팔레트에서 색을 입힘 |
| leather_white | leather_white | 0.30 m | Rob Tuytel | webp 변환 |
| white_oak_veneer | white_oak_veneer | 0.50 m | Jenelle van Heerden | webp 변환 |
| walnut_veneer | walnut_veneer | 1.80 m | Jenelle van Heerden | webp 변환 |
| velour_velvet | velour_velvet | 0.28 m | colormass, Rico Cilliers | 디퓨즈를 무채색으로 바꿈(원본은 빨간색) |

라이선스: CC0 1.0 Universal(https://creativecommons.org/publicdomain/zero/1.0/)

## 코드로 만든 것(외부 에셋 없음)

- 가구·설비·인물·고양이·로봇청소기: 코드에서 직접 만든 형상(`src/walkmode/interior/models.ts`, `life.ts`, `player/avatar.ts`). 실존 인물·브랜드 로고는 쓰지 않는다.
- 소리(스위치·문·커튼·발소리·청소기, 녹음을 못 받았을 때의 대체음): Web Audio로 합성한다(`src/walkmode/game/sound.ts`).
- 창밖: 걷기 월드(VWorld 건물·도로·지형)를 해당 층 높이에서 촬영한 큐브맵이다. 데모(`?interior=demo`)에서는 절차 생성 원경을 쓴다.
- TV 화면·액자 그림: 캔버스에 절차적으로 그린다.

## 녹음 소리 (`sfx/`)

BigSoundBank(https://bigsoundbank.com, Joseph Sardin)의 CC0 녹음이다. 원본 WAV를 받아 잘라내고, 루프는 끝과 처음을 겹쳐 이음매 없이 만들고(앞뒤로 0.15초씩 같은 루프를 덧붙여 디코더 지연과 무관하게 이어짐), 음량을 맞춰 모노 MP3로 인코딩했다.

| 파일 | 원본 | 가공 |
|---|---|---|
| flush.mp3 | Flush #4 (s0838) | 첫 번째 물내림 0~6.8초, 끝 1.4초 페이드 |
| basin_loop.mp3 | Gurgling sink #2 (s1027) | 세면대 수전 흐름 0.8~3.1초 루프 |
| basin_end.mp3 | Gurgling sink #2 (s1027) | 잠근 뒤 배수구 꼴깍 소리 3.25초~끝 |
| sink_loop.mp3 | Fill a sink (s0650) | 주방 싱크에 받는 물 4~10초 루프 |
| meow1~7.mp3 | Little meow of a cat #5~#11 (s1475~s1481) | 앞뒤 무음 제거, 음량 정규화 |
| purr_loop.mp3 | Cat purring #3 (s1010) | 10~18초 루프 |
| bark1.mp3 | Barking of a spitz (s0682) | 한 번 짖음, 0.62~1.2초 |
| bark2~6.mp3 | Small dog barking (s0612) | 0.1, 1.65, 5.65, 14.75, 16.45초에서 각 0.45~0.65초 |
| pant_loop.mp3 | Dog's breathing (s1547) | 4~8초 헥헥거림 루프 |

라이선스: CC0 1.0(https://bigsoundbank.com 각 소리 페이지에 "CC0 (public domain)" 표기)

## 데이터

- 평형(전용면적): 국토교통부 아파트 매매 실거래가, 건축물대장 전유공용면적(`/api/realestate/units`)
- 세대수: 공동주택관리정보(K-apt)
- 공동현관·동 번호: VWorld GIS건물통합정보(LT_C_BLDGINFO). PNU는 연속지적도(LP_PA_CBND_BUBUN)에서 얻는다.
- 평면: 공개 자료에 평면도가 없다. 전용면적에 맞춘 국내 표준 평면(판상형 2Bay·3Bay·4Bay)을 추정해 만들며, 화면에 항상 "추정 평면"으로 표시한다. 타사 평면도 이미지는 쓰지 않는다.
