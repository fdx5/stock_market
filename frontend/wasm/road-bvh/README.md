# Road triangle BVH kernel

The Rust kernel builds a 2D median-split AABB hierarchy over the rendered
asphalt's x/-z triangle bounds. Leaf size is 8. It does not triangulate,
decimate, move, or reorder the Three.js geometry. Plane clipping, paint
clearance and tyre heights use the existing JavaScript narrow phase.

Build (measured compiler: Rust 1.99.0, wasm32-unknown-unknown):

```powershell
rustup target add wasm32-unknown-unknown
node frontend/scripts/build-road-bvh.mjs
node --test frontend/scripts/test-road-bvh.mjs
```

Check in the Rust source, Cargo.lock, generated `road_bvh.wasm` and `build.json`
together. The normal frontend build consumes this verified 28 KB binary and
does not need a Rust compiler on the deployment image. The source/binary
manifest is tested; source hashes normalize CRLF to LF.

ABI: allocate aligned u32 words, fill 4 float32 bounds per triangle, call
`bvh_build`, copy packed 32-byte nodes and uint32 triangle ids, free the tree
and input. Invalid/non-finite bounds return null. Allocations and handles are
internal to the worker; all handles are freed and the worker terminates.

The optional 2-worker experiment builds independent spatial trees for two
triangle ranges; JS searches both trees. This is Web Worker parallelism with
independent WASM instances, not shared-memory Rayon threading. No COOP/COEP
change is required. Benchmarking found one worker best overall, so production
defaults to one. `bvh=wasm2` enables the desktop comparison; iPad stays at one.
`bvh=grid` selects the original algorithm. Timeout is 1 second, then the
existing grid fallback runs. Closing the owner cancels immediately. Input
attributes remain live: only a copied buffer is transferred to workers.

Constrained Apple touch / low-memory devices cap the BVH at 250,000 triangles;
the general input limit is 2,000,000. WASM linear memory is not retained on the
page. The packed tree remains only with the owning road height function.
