# 3D loading: bounded bitmap copies, 2026-10-03

This continues `c8faafb` in `tmp/frame-budget-dev`. The target of 3x loading, zero frames over 20ms, and no loading-time pointer delay is **not achieved**. This is a local checkpoint, without a merge, push, or deployment.

## Accepted changes

- A decoded ImageBitmap copies all rows admitted by the existing shared texel budget in one call, rather than re-entering `copyExternalImageToTexture` every 128 rows. CPU canvas readback retains its 128-row bound. Visible/initial budgets remain 600,000/1,200,000 texels per frame.
- When the remaining budget cannot fit one complete row, upload resumes in the next frame. The previous minimum of one row could exceed the budget.
- Detail bitmap cleanup now covers background admission and texture allocation as well as copying, so a failed allocation closes every decoded bitmap. The original decode settings, textures, mip generation, and initialization ordering remain in use.

## Measurement

Production fixture, Edge 155.0.4283.33, fixed render scale 1.5, CPU rate 1, WebGPU high, 9 own buildings and 275 neighbours. Fresh browser per run. Baseline/candidate repetitions were alternated after the first pair. Baseline reuses the c8faafb production artifact; candidate reuses `improve-copy-final-1/build`. Heavy checks did not run alongside these measurements.

| Metric | c8faafb baseline, runs 1 / 2 / 3 | Candidate, runs 1 / 2 / 3 |
|---|---|---|
| Selection to first shown frame (ms) | 1485 / 1620 / 1676 | 1487 / 1661 / 1485 |
| Median first shown time (ms) | 1620 | 1487 |
| Loading maximum pointer delay (ms) | 129.1 / 114.8 / 131.9 | 112.2 / 121.5 / 187.4 |
| Loading maximum frame gap (ms) | 133.5 / 116.8 / 116.7 | 116.7 / 133.4 / 132.2 |
| Loading frames over 20ms | 8 / 8 / 8 | 9 / 8 / 9 |
| All measured frames over 20ms | 9 / 8 / 8 | 9 / 9 / 9 |

The observed first-frame median is 8.21% shorter (1.089x). Three repeats are variable and do not establish a guaranteed speed gain. Input latency and drop counts did **not** achieve the target; the worst candidate pointer delay increased. All three candidates fail `check-complex-frames.py` (exit 1), which includes all nine required loading, extras, camera, switching, and interaction phases. Candidate run 2 also has one extras drop. The overview GPU buffer measurement is unchanged at 25,980,356 bytes, and browser errors are zero.

The old project's comparable 3x threshold remains 583ms; the latest baseline's 3x threshold would be 540ms. Neither is met. No memory leak fix or end-to-end zero-drop claim is made.

## Validation

- GPU QA compares the candidate to the independent original staged method from c8faafb, as well as direct upload and channel packing. Eight combinations cover two sizes, both Y orientations, and opaque/transparent pixels. Candidate versus original staged output is byte-exact, including transparency; channel packing is byte-exact. The transparent direct sRGB upload differs by up to 1/255 from **both** staged paths, an existing format-path difference rather than a new change.
- For two 512x1536 images, native copy calls decrease from 28 to 4; for two 1024x768 images, from 16 to 4. Both complete in 3 visible frames, with maxima of 599,552 and 599,040 texels per frame. No pixel-budget increase is used.
- 32 Node regressions pass, including allocation failure, upload failure, and closing while admission is pending. TypeScript and the product production build pass.
- The upload harness uses unique filenames per process to prevent Vite from serving a previous temporary fixture.

Additional runs reuse the final production artifact. WebGL compatibility renders successfully with no browser errors: first shown time 1784ms, maximum pointer delay 355.3ms, maximum loading frame gap 883.7ms. The native stress run uses CPU rate 4, a 5-second detail CDN delay, and removal of the optional feature marker; it does **not** include a paused rail. It renders WebGPU high with zero browser errors: first shown time 2774ms, maximum pointer delay 318.5ms, maximum loading frame gap 300.2ms. These validate compatibility under those conditions, not the performance targets; they are not paired comparisons to the earlier stress fixture.

## Rejected trials

- Worker CPU canvases: original-painter texel comparison failed. Reverted.
- Flush worker GPU paint in smaller batches by reading one pixel: quality passed, but traced first loading took 1680ms and maximum pointer delay rose to 220.6ms. Reverted.
- Disable ImageBitmap strip staging: first loading took 1592ms, maximum pointer delay was 190.3ms, and overview acquired two frame drops. Reverted.
- Download/decode detail maps during GPU initialization: selection-relative times looked similar, but startup-to-first-shown shifted from roughly 1.9-2.1 seconds to roughly 3 seconds. Moving only downloads early did not remove that delay. Both variants were reverted; startup delay was not hidden by reporting only selection-relative timing.

The latest browser trace still contains GPU tasks lasting roughly 100-150ms. The trace establishes the stalls but does not by itself establish that every task is rasterization or shader compilation. Further work needs to correlate these GPU tasks with initialization/copy/pipeline activity while retaining the original pixels and full phase gates.

Machine-readable results: `3d-loading-copy-measurements-20261003.json`. Raw paired reports: `tmp/complex-perf-improve-paired-before-{1,2,3}/report.json` and `tmp/complex-perf-improve-copy-final-{1,2,3}/report.json`. Diagnostic trials remain under `tmp/complex-perf-improve-*`.
