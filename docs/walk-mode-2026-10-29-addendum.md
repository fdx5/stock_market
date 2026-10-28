# 직접 걷기 4차 보충 (2026-10-29 03:50~05:10, 미커밋·미배포)

`walk-mode-2026-10-28.md` 4차 절에 이어서.

- 군중: 모든 패치가 같은 시드(7)로 같은 70명을 복제하던 버그 — 패치 위치로 시드(Ground.ts). 풍선 든 아이·손잡은 엄마와 아이·공 든 아이·러너 화면 확인(npc.py).
- 물: 물 메시 꼭짓점이 지형 높이를 따라가 물가 칸의 마른 꼭짓점이 2.35 m 솟던 문제 — 수역별 수면 높이의 평평한 면으로(tileWorker, 드라이브 공용). 강둑의 파란 경사면이 사라지고 물가선이 둑과 만난다(han2.py, shore.py).
- 바다·해안: 바다(OpenStreetMap 해안선, /realestate/water)를 받는 waterBlock이 어디서도 호출되지 않아 바다가 없었다 — 타일마다 호출해 바다를 물로, 해변(beaches)을 모래로(tileWorker, 캐시 키 water2:). World.beachAt 추가, 걷기 지면은 해변 칸에 Poly Haven coast_sand_01(CC0, public/3d/walk/out, surface-sources.json에 기록)을 깐다. 해운대(엘시티)에서 확인(dsea.py, beach.py).
- 교량: 원형 교각·머리보·거더 2열·강철 난간 — 드라이브 성수대교에서 측면 렌더로 확인(dbridge.py). 걷기 범위(약 600 m) 안에 교량이 있는 단지에서는 아직 못 봄.
- 성능: 측정 시 PC가 잠금 화면(LogonUI, GPU P8 210 MHz)이라 수치 비교 불가 — 잠금 해제 후 stream.py/perf1.py로 다시 측정할 것. 게임 루프 CPU 4.8 ms/프레임, 기능별 A/B에서 단일 병목 없음.
- 남은 것: 물가선의 4 m 격자 계단, 해변 모래 색·입도, 잠금 해제 상태 성능 재측정.
