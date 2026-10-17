# Korean surface commuter-rail geographic data

© OpenStreetMap contributors. This derived geographic database is made available
under the Open Database License (ODbL) 1.0:
https://www.openstreetmap.org/copyright
https://opendatacommons.org/licenses/odbl/1-0/

Source: a complete Overpass response downloaded on 2026-10-10 for Korean subway,
light-rail, monorail and named commuter-train route relations. The exact OSM source
timestamp and SHA-256 are in manifest.json. Coordinates and original way/node IDs
are retained. Tunnel, negative-layer, worksite, inactive and unverified subway
surface geometries are excluded. Very short source fragments are not exported.

Station buildings and platform polygons additionally use a public Korean OSM
Overpass response (OSM base timestamp 2026-10-10T05:23:17Z). Its SHA-256 is
`stationSourceSha256` in manifest.json. Facilities are matched to mapped surface
stops, with mapped layer checks where available. Facility totals are mapped
polygons, not a surveyed count of distinct operating stations.

Reproduction: scripts/download-surface-rail.py creates a NEW public-source snapshot;
scripts/build-surface-rail.py converts it to a NEW version directory. Neither script
opens application databases or environment files. A newer source may have different
ways/coordinates; it must not replace this immutable snapshot in place.

This is map-derived geometry, not a surveyed railway asset inventory. Neither a
tagged layer nor this database provides measured deck elevations. The renderer's
DEM-relative viaduct heights, supports, electrical equipment and vehicle shapes
are representative visual estimates. Train positions and service frequencies are
simulated and do not describe live operations or timetables.
