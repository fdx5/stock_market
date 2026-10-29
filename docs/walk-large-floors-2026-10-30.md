# 대형 건물 층 전체 렌더링 (2026-10-30)

No database migration, stored-data modification or cleanup is introduced.

## What changed

- `plan/surveyed.ts`: the whole floor is laid out. The previous version cut the floor to the
  46 × 34 m around the way in. Rasterisation runs per polygon bounds. Rectangles are searched
  within each region's bounds, and neighbours are found through a coarse grid.
  - SGIS partition types follow the definition document (10 사업체, 20 빈 공간, 3x 기타 시설물,
    40 덕트). 31, 36 and 37 are walkable areas and were previously dropped as void.
  - A large floor (> 2,500 m²) with only an outline gets a lobby, a 6 m main hall, cross
    corridors, cores, services round the lobby and departments, each with its own wall colour.
- `Interior.ts` (engine):
  - Plans over 48 m are "large". Their lamps share the 28 area lights by distance and fade
    across; far zones get an even fill from a zone texture (`lightZones.ts`), not a 32-entry
    uniform array.
  - Walls and furniture are batched in 16 m chunks and culled by distance (95 m for the shell,
    48 m for furniture).
  - Segments are queried through a 4 m grid. The sun's shadow follows the walker.
  - All geometry is uploaded once behind the loading screen.
  - Large-lamp intensity uses the exact view factor of a rectangle.
  - The probe is taken where the walker enters. Floors use a soft sheen instead of a mismatched
    sharp reflection.
- Finishes (`facilityMaterials.ts` finishes, `Room.finish`): lobby marble, hall terrazzo,
  wood-look vinyl, clinic sheet flooring and 8 department tones.
- Lobby furnishing: an 8.4 m column grid, seat rows, planters and kiosks. Retail open floors get
  display islands.
- Signs: identical signs share one atlas place. Detail is halved once the atlas is two thirds
  full. A full atlas gives a plain plate. Fascia signs are at most 6 m wide.
- People: up to 36 on a large floor, nearest the way in first. Those beyond 42 m are hidden and
  not updated.
- Hospital campus: blocks within 30 m of the entered one (drone footprints) are joined on the
  ground floor by 4 m passages, labelled 연결통로 (재구성). SGIS charts only the main block of
  삼성서울병원.
- Drone: while walking, the 착륙 button reads 드론 and takes off over the current spot (Esc too).
  The third-person distance is 6 m on foot and 6.5 m by bike. Leaving a building steps out until
  the camera line behind is clear.

## Local measurements

Chrome full screen, RTX 3070 / ANGLE D3D11, 2514 × 1277, DPR 1, Vite dev with the real-estate
API proxied to production.

| Floor | Area | Rooms | Load | Walk |
|---|---|---|---|---|
| 삼성서울병원 1F | 12,281 m² | 238 | 11.8 s | avg 59.8 fps, p99 16.8 ms, worst 33 ms |
| 의정부민자역사 3F | 18,687 m² | 185 | 9.2 s | avg 60.0 fps, worst 18 ms |

Not yet verified:

- the campus join, the take-off button and the third-person camera in a browser
- mobile devices
- the 6 m fascia cap

Known issues:

- Furnishing takes about 4 s of the load.
- One lobby seat's sitter is off the seat.
