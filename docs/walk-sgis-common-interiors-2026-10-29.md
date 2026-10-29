# SGIS common interior renderer, 2026-10-29

The server uses SGIS_CONSUMER_KEY and SGIS_CONSUMER_SECRET. Tokens stay in memory;
no credentials are returned by the public geometry endpoints. No database migration,
stored-data modification or cleanup is introduced.

## Data flow

SGIS building polygons identify the containing building, never a neighbouring building.
Building attributes, floor boundaries, business polygons, facility points and business
attributes are fetched through the server. EPSG:5179 coordinates retain metre distances.
The same planner interprets business areas, empty areas, entrance/elevator/escalator/
stair/toilet areas and ducts. It generates geometry, collision segments, walking grids,
facility approaches and floor navigation without building-name-specific layouts.

Lift doors face the reachable corridor; E opens a floor panel. Loading a selected floor
fetches its data and replaces the previous floor's geometry, materials and crowd.
Guidance appears on the floor and minimap. Medical NPCs have separate roles, uniforms
and conversations; public, museum and station uses have separate furnishing profiles.
Non-residential exterior entrance architecture is separate from apartment thresholds.

## Accuracy boundaries

SGIS's published deployment-chart data uses a 2019 reference year. It is not a national
structural BIM/CAD inventory. Furniture, finishes, people and door opening details are
reconstructed; supplied boundaries, room polygons and facility points are identified
separately in the HUD. Missing room data is never called a measured interior.

The operational Samsung Seoul Hospital building `200709633253781943302550`, floor 1,
returns a boundary but no business polygons or facility points. Its interior remains a
labelled reconstruction; exact columns, partitions, furnishings and current interior
cannot be established from that response. No Samsung-specific hand-drawn layout was
added. Detailed structural data remains necessary to claim an exact hospital interior.

The SGIS documented example `201009627135471957239550` returns 74 space regions,
27 businesses and 30 facilities on floor 1. The common engine renders 27 business
zones, 461 wall/detail segments, 10 lifts and 8 stair/escalator connections. Floor 2
returns 59 regions and yields 8 lifts. A real-API Chrome check exercised 1→2→1,
NPC population, guidance, walking, and floor resource replacement without page errors.

## Validation

- 8 common-planner tests: metre geometry, reachability, holes/ducts, missing coverage,
  medical dialogue and uniforms, large entrance sizing and semantic facility profiles.
- 24 existing car, bicycle and parking regression tests.
- 13 backend SGIS/register/unit tests; one public-places merge regression test.
- Full TypeScript and Vite production build.
- Chrome --mute-audio, RTX 3070 / ANGLE D3D11, 1440×900, DPR 1: the measured-layout
  interior sample averaged 59.99 FPS, minimum one-second 59 FPS, p95/p99 16.8 ms,
  worst 34.4 ms over 10 seconds, 74 draw calls / 419,493 triangles. This is one
  interior sample, not a guarantee for all places, devices or the outdoor world.

Sources: https://sgis.mods.go.kr/developer/html/newOpenApi/api/dataApi/deploymentChart.html
and https://sgis.mods.go.kr/developer/upload/doc/DataAPI-definition.pdf
