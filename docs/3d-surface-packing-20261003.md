# Exact prepared surface uploads

This is an incremental performance release. The 3x loading, zero frame drops and zero loading-time mouse latency targets remain unmet.

Facade and plinth normal/roughness channels are independent of palette and seed. Bake the original GPU packing result into three content-addressed gzip files, validate SHA-256 after decoding, and upload the exact RGBA bytes within the existing shared per-frame texel budget. This bypasses two external-image uploads and their packing pass when the optional download arrives early. Colour maps, sampling, mip generation, resolution and original WebGL inputs remain unchanged. Downloads never delay a paint reply; unavailable, corrupt, unsupported or late data uses the original path. Once original staging starts, optional data cannot restart it. Shared GPU textures keep last-owner leases; pending callbacks and idle CPU caches use weak references, and disposal invalidates late replies.

The three gzip assets total 326,651 bytes: 68,707 bytes for initial facade/plinth and 257,944 bytes for the 2x facade. The painter source hash determines the asset folder; changed source without matching assets falls back.

## Measurements and limits

Three alternating fresh Edge 155.0.4283.33 production runs, CPU rate 1, fixed render scale 1.5, WebGPU high, 275 identical neighbours. Baseline 3D code is deployed 915f090; subsequent main 2612324 changes support analytics, without 3D changes.

| Version | Selection to first view (ms) | Navigation clock first shown (ms) | Full scenario drops above 20ms | Loading pointer maximum (ms) |
| --- | --- | --- | --- | --- |
| Baseline | 1600 / 1533 / 1453 | 2079 / 1987 / 1842 | 8 / 10 / 8 | 117.2 / 134.3 / 249.9 |
| Candidate | 1391 / 1434 / 1473 | 2848 / 1872 / 1874 | 8 / 8 / 7 | 99.7 / 114.8 / 165.8 |

Selection medians 1533 to 1434ms (6.5% shorter), navigation medians 1987 to 1874ms (5.7% shorter). The first candidate artifact had slower navigation/startup (2848ms), so these variable samples do not establish a guaranteed gain. Every candidate used two prepared surfaces and reported no browser errors. All failed the strict all-phase 20ms gate.

After adding late-arrival staging preservation and unused-data release guards, a final fresh production build/run measured selection 1512ms, navigation 1914ms, two prepared uploads, 12 full-scenario drops and maximum pointer delay 170.6ms, with no errors. This confirms remaining input/frame stalls; it is not evidence of zero drops. Detailed measurements and strict gate results accompany this document.

## Validation

- Bake verification: six palette/seed cases reproduce all three assets byte-for-byte.
- Five actual worker/client/renderer cases (facade 1x/2x, plinth, apartment context 1x/2x): every GPU mip matches the original packing with maximum difference zero. Prepared uploads make zero external-image copies. Shared upload budget stays at or below 600,000 texels per shown frame. First-owner release preserves shared textures and last-owner release removes them.
- Repeat the five GPU cases with actual corrupt downloads: original path succeeds and every mip still matches exactly.
- Original painter versus worker/client, 50 maps including normal asset 404 fallback: maximum difference 1/255, mean 0.0000614291, no browser errors.
- Loader/lifecycle regressions cover gzip and HTTP-decoded transport, checksum corruption, 404, body deadline, unsupported browser, nonblocking paint replies, disposed textures, processed sources, released epochs and preservation of existing staging progress.
- Final production native and WebGL scenarios cover overview, extras, camera changes, street view, switching complexes and interaction. Production deployment smoke checks the health commit, original PNGs plus all three prepared assets, desktop/mobile emulation reopen and devgame score controls without submitting scores.

No physical mobile-device measurement is included. Large GPU tasks and asynchronous shader preparation still need further investigation.
