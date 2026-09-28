# Tidewater engine

Vendored from https://github.com/dgreenheck/tidewater at
`4811ba48d795197de5621985f404e765c0b7c0ef` (2026-09-27).

Copyright (c) 2026 DRG Software Solutions LLC. MIT licensed; see LICENSE.
Only the engine source is included, not the game's third-party assets.
Local modifications include SPDX/license headers, shared pipeline caching,
per-mesh layout caching, partial attribute uploads, and renderer-owned GPU buffer
cleanup for cached geometry across complex selections, and optional pass timestamps
for shadow cascades, and an adapter request that falls back to the default and
software adapters.
The application adapter is `../../components/tidewater/ComplexRenderer.js`.
Three.js remains responsible for existing CPU geometry and interaction and the
WebGL compatibility path; the WebGPU path uses Tidewater's native GPU renderer
and WGSL shaders. This is not a port of the entire Tidewater game/post chain.
