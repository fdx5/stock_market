# Nationwide named commerce, markets and distinctive districts

© OpenStreetMap contributors, Open Database License 1.0 (ODbL).
Source and license: https://www.openstreetmap.org/copyright
Database license: https://opendatacommons.org/licenses/odbl/1-0/

This adapted database contains selected named commercial facilities, markets and
distinctive streets/areas in South Korea. Exported on 2026-10-18 using read-only
Overpass `area[ISO3166-1=KR]` queries (`out geom`) and the public OSM API v0.6
multi-fetch GET endpoint for building relation member tags. No account,
contributor, changeset or personal profile fields are published.

The original data is community maintained; coverage, names, business hours and
building heights may be incomplete or out of date. A named area does not imply
a building. Only mapped building/building-part outlines produce geometry.
`height` and `min_height` are preserved; absent heights use floor-based estimates
marked `estimated: true`. No claim of surveyed accuracy for estimated heights.

Rebuild a NEW versioned directory with `scripts/build-drone-places.py`. The JSON
cells are the adapted database in machine-readable form, distributed under ODbL.
