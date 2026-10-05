# Geometry and instance WASM kernel

The worker builds neighbouring building walls and roofs in f64 and stores f32
attributes. JS retains the original ring orientation and Earcut triangulation.
Owned typed-array copies preserve position, normal, UV, colour and local indices.
This does not replace terrain, road draping or every scene geometry algorithm.

The same binary composes bulk vehicle and forest instance matrices on the main
thread. Input is nine f64 values per instance: x, y, z, Y yaw, X pitch, scale x/y/z,
reserved. Output is sixteen f32 values in Three.js column-major order. Buffers are
allocated once per batch and reused. Traffic simulation, collisions and terrain
sampling remain unchanged. Individual wheels and articulated walkers remain JS.

```powershell
rustup target add wasm32-unknown-unknown
node frontend/scripts/build-scene-geometry.mjs
node --test frontend/scripts/test-hybrid-scene.mjs
```

Commit source, Cargo.lock, generated `src/wasm/scene-geometry/scene_geometry.wasm`
and build.json together. The source hash normalizes CRLF to LF. Production builds
consume the binary directly and do not need Rust installed. No shared memory,
threading or COOP/COEP change is required. Fetch has a one-second timeout and
failure selects the existing JS path. `hybrid=off` selects the JS comparison;
the separately deployed road BVH remains enabled in both arms.

Geometry ABI: `alloc_input`/`free_input` allocate f64 words; `geometry_build`
returns an owned batch handle; `geometry_attrs`, `geometry_ids`,
`geometry_offsets` and `geometry_vertices` expose output metadata. Copy output
before `geometry_free`. Geometry input is capped at 4,000,000 f64 words in JS.
Instance ABI: `alloc_matrices`/`free_matrices` take an instance count;
`instance_compose` takes input/output pointers and an instance count.

All calls are synchronous within their owner, so new views of linear memory are
created after allocations that might grow it. Geometry handles are freed in
finally. Temporary forest batches are freed on success and cancellation. Traffic
batches are freed when disposed. Closing the last 3D owner resets the shared
Instance kernel reference and terminates the geometry worker. GC controls the
actual reclaim time of ArrayBuffer backing stores.

See `docs/3d-geometry-instance-2026-10-05.md` for measured results, tradeoffs and
repeatable browser benchmarks. Computational speedups are distinct from whole
scene loading, main JS heap, GPU allocation and frame intervals.
