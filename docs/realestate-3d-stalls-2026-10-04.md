# Repeated Shindo 6 rendering stalls

Reproduction: `realestate-map?sido=41&period=3m&sgg=41150&dong=호원동&complex=41150:호원동:401-1:신도6&area=60&3d=1`.

## Causes and changes

- The frame queue admitted work only when the current frame had spare time. Sustained drawing could postpone builders forever. Its background-priority `scheduler.postTask` could itself starve before the admission check ran. Use the ordinary message task queue after animation frames, retain FIFO/one admission per frame, and allow one overdue continuation per 100 ms.
- The 66 tree variants required 198 frame continuations merely to decode geometry. Decode in a module worker and transfer typed arrays, retaining the sliced fallback. Compare every original geometry attribute, index, bound and shared geometry identity before applying intentional tree grouping.
- Larger twig cards retain tree species, trunks and flowers. Twenty-one tree variants use 55% fewer near-level indices. Shrubs/flower heads keep their original geometry; bounds remain checked.
- Registered landscaping waited behind walkers and an external water request. Draw registered planting independently, retain the actual water answer for subsequent masking, and start water/crossing requests alongside building/terrain preparation. The former 25-second race could mark planting complete before a late water response was applied.
- Changing a visible material before its asynchronous replacement pipelines existed could leave meshes out of a draw. Prepare colour and shadow pipelines while keeping the previous material and its bindings alive.
- Share VWorld file downloads and bounded reusable bytes (32 MiB, 512 entries, 24-hour expiry) in memory/IndexedDB. Consumers receive their own transferable buffers. Cache failure, stalled storage, aborted views and eviction are covered. Share pending registry reads; restrict photo analysis to the selected complex. This reduces repeat traffic; it does not aggregate all cold model files into one request.
- Remove TAPE from the real-estate page. Clear readiness telemetry on each selection to avoid interpreting a previous complex's completion as the next one's.

The two latest surface/normal experiments were reverted as a precaution. They are not proven to explain every reported regression; the scheduling starvation predates those experiments.

## Validation and limits

Production build and 29 regression tests pass. `frontend/scripts/test-shindo-scene.py` opens fresh pages with the exact production URL, uses real production APIs for the local candidate, checks native registration and leaf instance counts, records pointer/frame timings and VWorld request counts, and captures central-screen black frames. Captures do not prove the absence of partial or very brief flicker.

Baseline `cc5defa`, two ordinary-CPU loads: 506/498 VWorld requests; planting completion signals at 29.05/28.18 seconds. Those signals include the old water timeout and therefore do not prove actual water completion.

The final ordinary-CPU candidate's two loads: 508/113 requests; native verified planting at 9.89/5.18 seconds, tracked scene milestones at 13.37/11.49 seconds. Both ended with 7,650 source and native leaf instances, no missing native meshes, no application errors, no TAPE, and no detected full-black central captures across 8,573 frames. Repeat requests fell 77% compared with baseline; cold requests did not improve. The 95th-percentile displayed-frame interval was 16.8 ms in both runs, but each had two intervals over 50 ms.

In CPU-4x validation, the intermediate background-priority candidate was still at initial planting after 75 seconds. The ordinary-queue fix reached native verified planting at 51.27 seconds and tracked milestones at 57.34 seconds, with no missing native meshes or leaf instances at the end. Frame drops remain on the slow CPU.

**All elements within three seconds and zero frame drops are not achieved.** Tracked milestones are stronger than first-building readiness but do not prove that every asynchronous enrichment has finished. Do not present this repair as fulfillment of those targets. Reports and screenshots are retained under the isolated release worktree's `tmp/` directory.
