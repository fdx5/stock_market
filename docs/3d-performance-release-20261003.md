# 3D loading performance release, 2026-10-03

Integrated on production main `c17f6e17e8c577ee3def456c9429bb0f3042d499`, preserving its support UI, driving controls, landscaping, and surveyed-road neighbour exclusion. This is an incremental improvement released at the user's explicit request. The original 3x loading, zero-drop and delay-free loading targets are **not achieved**.

Changes: transfer neighbourhood geometry construction to the scene worker; overlap terrain-grid work; avoid unused normal-map preparation; combine bitmap-copy rows within the existing frame texel budget; reuse exact prepared steel pixels with the original fallback; share immutable channel textures with last-owner release.

## Matched production-build measurements

Three alternating baseline/candidate runs, fresh Edge 155.0.4283.33, CPU rate 1, fixed render scale 1.5, high quality, identical 275-neighbour fixture. No other builds or browser tests ran during measurement.

| Metric | Baseline | Release |
| --- | --- | --- |
| First-view ms, three runs | 1882 / 1784 / 1934 | 1562 / 1652 / 1798 |
| Median first-view ms | 1882 | 1652 |
| Full scenario drops, three runs | 12 / 11 / 12 | 10 / 11 / 11 |
| Loading pointer maximum ms, three runs | 133.5 / 130.7 / 207.3 | 103.6 / 173.4 / 130.2 |

Observed median loading time is 12.2% shorter (1.139x). The strict 20ms frame gate fails on all three candidate runs; loading frame maxima are 116.7 / 183.3 / 133.4ms. These measurements do not establish zero drops or zero input latency. Raw summaries and gate results are in `3d-performance-release-measurements-20261003.json`.

## Validation

- Production TypeScript/Vite build passed.
- 36 geometry, frame-budget, GPU, memory, recovery, detail-loading and steel-lifetime Node regressions passed; 12 real-estate tests passed.
- Browser paint comparison passed for 50 maps (maximum channel difference 1/255).
- Eight bitmap upload cases matched the original staged path exactly; native copy calls reduced from 16–28 to 4 while keeping the texel budget and three-frame staging.
- Prepared steel CPU pixels, GPU pixels and shared channel matched exactly. Last-owner release, bitmap release and missing-asset fallback passed.
- 275-neighbour worker geometry, cancellation, reopen and fallback passed without browser errors.

Deployment verification uses `frontend/scripts/verify-3d-deployment.py` to verify the running commit, all prepared PNG hashes, real-complex desktop and mobile-emulation 3D, close/reopen, and enabled devgame controls with a read-only score dialog. Mobile emulation is not a physical-device performance measurement.

## Production testing

Open `https://kospimap.com/realestate-map?devgame=1`, select a complex and open **3D 건물뷰**. For a URL with existing parameters, append `&devgame=1`. The setting persists in this browser's local storage. Use `devgame=0` to disable it. The Coupang truck and Cybertruck controls become enabled once road/street preparation completes; score is available in devgame mode.
