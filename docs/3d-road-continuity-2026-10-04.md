# Road continuity repair

Roads could disappear in patches because their DEM-sampled triangles intersected
the independently triangulated ground. In the Shindo 6 candidate audit, 1,229 of
50,177 asphalt triangle centroids were below the rendered ground, by up to 0.721 m.
Increasing sample density alone did not fix this.

The repair partitions affected asphalt and marking triangles at rendered-ground
triangle edges and interpolates the maximum of the road and ground planes, with
clearance. This clears triangle interiors as well as vertices. Triangles whose
clipped polygons prove adequate clearance retain their original geometry.
The asynchronous builder yields while clipping and cancels with its scene.

Additional continuity repairs:

- A >3 m DEM correction no longer disables road grading. Symmetric slope envelopes
  bound the core grade, with a smooth transition to untouched terrain outside roads.
- Two-arm joints receive a shared asphalt surface across width/bearing changes.
  These joints do not participate in the wider 35 m major-intersection clustering.
- Wide roads and intersection fans are sampled across their surfaces.
- Bridge approaches use available road on the banks rather than a fixed 12 m ramp.
  Overlapping approaches use their upper height envelope, independent of list order.
- Markings receive their own higher ground clearance.

Validation:

```powershell
cd frontend
node scripts/test-road-continuity.mjs
node scripts/test-complex-frame-budget.mjs
npm run build
python -X utf8 scripts/test-road-scene.py --base http://127.0.0.1:4192 --iterations 1 --seconds 65 --out ../tmp/roads-release-candidate.json
```

Eight road regressions cover DEM steps, normal inclines, preservation of distant
terrain/input data, joint coverage, width sampling/markings, bridge ramps and
overlaps, exact ground partitioning with preserved road area, and unchanged
triangle counts for roads already clear of the ground. Nine existing
frame/lifetime tests also pass. Product build passes.

The full-partition candidate's actual-data audit had 302,455 road triangles,
zero buried centroids, no application errors, and completed landscaping. The final
candidate keeps unaffected road triangles to avoid that unnecessary geometry.
The final local-preview audit had 57,853 road triangles, zero buried centroids,
zero maximum burial, and no app errors. Completed-scene display-frame p95 was
16.8 ms in both the first candidate and final candidate on this machine. These
figures do not establish zero drops or faster cold external-data loading.
Final candidate and deployed measurements are recorded in the accompanying JSON
reports; centroid samples alone are not a proof for every map location. This
change does not establish the earlier all-elements-in-three-seconds target or
resolve the separately reported persistent black-facade bug.
