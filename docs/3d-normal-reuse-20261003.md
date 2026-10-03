# Loading-stall investigation and normal bitmap reuse

Base: deployed `915f090`. The original 3x loading, zero-drop and loading-time zero-input-delay targets remain unmet.

The raster worker cloned an already decoded normal-map bitmap before creating its final Y-oriented copy. Reuse the job-owned decoded bitmap directly as the input to the orientation copy. This removes one full-image clone per facade/plinth texture set, retaining the original orientation, alpha and colour handling, surface keys and cleanup.

## Verification

Original page painters versus worker/client output: 50 maps at 1x/2x, maximum channel difference 1/255, mean 0.0000614291, no page errors. A second 50-map run intercepted the prepared facade/plinth normal assets with actual 404 responses and verified the original-painter fallback with the same result. Product TypeScript/Vite build passed.

Three alternating fresh-browser production runs, Edge 155.0.4283.33, CPU rate 1, render scale 1.5, WebGPU high, identical 275 neighbours. Baseline selection-to-first-view: 1577/1460/1579ms; candidate: 1417/1498/1445ms. Medians 1577→1445ms (8.4% shorter). Browser-navigation-clock first-shown medians 1978→1886ms (4.7% shorter). These variable samples do not establish a guaranteed gain.

Full scenario drops: baseline 9/10/9; candidate 10/9/10. Loading maximum pointer delay: baseline 123.1/104.2/122.6ms; candidate 118.8/128.1/145.5ms. All three candidates fail the strict all-phase 20ms frame gate. No claim of zero drops or improved worst-case input latency is made. Detailed results are in `3d-normal-reuse-measurements-20261003.json`.

## Rejected experiments

- One raster worker instead of two: diagnostic first view 1622ms versus baseline 1469ms, maximum pointer delay 117.8ms versus 81.7ms. Reverted.
- Decode prepared normals directly with `imageOrientation: flipY`, eliminating both subsequent copies: actual worker/client normal orientation comparison failed (expected first R=178, got 128). Reverted; the original bitmap orientation-copy operation remains.
- Bake the exact original detail-image GPU output and upload decompressed RGBA bytes: removes that image-copy call but retains long GPU tasks. Three-run selection medians 1546→1510ms and navigation-clock medians 1944→1925ms; four downloads grow from 664,320 to 1,873,263 bytes (2.82x). Rejected and archived under local `tmp/raw-detail-experiment`; no raw detail assets or loader changes remain in product code.

Traces still show GPU-process tasks of roughly 100–160ms. A single original detail image copy measured 69.9ms in one diagnostic run. The trace does not establish that all long GPU tasks have that cause. The next experiment targets packing immutable normal/roughness channels without altering the final GPU pixels.
