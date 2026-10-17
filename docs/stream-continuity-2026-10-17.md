# Small/medium stream continuity

Common failures reproduced before changing code:

- Circular 15 m closing could not fill a DEM bridge ridge in a channel narrower
  than its 30 m erosion disk. Widths 4, 12 and 28 m all failed a 44 m crossing.
- A one-row stream's plane fit fell back to a horizontal surface when its 2D
  covariance was singular; sloping open water was classified as dry.
- The 300 m² per-polygon cutoff discarded real short links and tile fragments.
- Drone ground sinking required more than 6 m to either bank; a whole small
  stream could therefore keep a DEM ridge above its water surface.

Changes:

- Reconnect a narrow mapped corridor only between existing water on both sides,
  within 64 m, interpolating those levels instead of keeping the DEM road ridge.
  The whole path must remain in mapped water, with a cross section <=128 m.
  Original seeds remain immutable so connections cannot grow recursively.
- Fit rank-one sloping channels along their line.
- Keep nondegenerate open fragments from 1 m². Explicit covered-stream flags
  still exclude culverts; land-use alone is not inferred from fragment size.
- Sink existing wet channel vertices regardless of distance to the bank.
  Dry banks retain their contour rule; no retaining walls are added.
- Carry 80 m of river context beyond streamed tile edges, inside the existing
  160 m DEM margin, and cut only the final surface to the tile square.

Verification: the 4 previously failing fixtures now pass. Existing floodplain,
reed-field, weir and island controls still pass. Adjacent 340 m tiles reconnect
the same crossing with water levels within 5 cm. A real `buildWater` 180 m²
fragment produces visible triangles; covered and degenerate controls stay
excluded. 45 combined water/coast/road tests passed, plus the fragment checks.

Limits: no water is invented across missing polygons or mapped islands. The
existing broad-parcel floodplain/DEM floor rules remain; these tests do not
establish that every steep mountain stream or missing-source waterway is fixed.
Production render verification and deployment are recorded separately.
