# Driving game streaming and private development controls

The driving viewer now follows a separate loading and frame budget from the architectural viewer.

- Load east, west, north and south around a stable 300 m anchor, 480 m away, before a direction is chosen. Queue two area preparations at a time; promote the active direction. Reuse completed surrounding areas during a turn instead of downloading a slightly different point. Keep at most 16 prepared areas and eight queued requests, with ten-second failure backoff.
- Prepare roads and terrain together; limit VWorld JSONP requests to four at a time. Bound nearby-building parcel discovery to the closest 96 towers. Late responses after timeouts have a harmless callback for ten minutes.
- Discover nearby complexes for every region, including `pt:latitude,longitude` areas. Match parcel PNUs to each parcel's own district. Delivery selection uses accumulated geographic positions, updates local coordinates after a transition, and retries after nearby discovery finishes. Initial driving and repair have a full fallback tank even when no route is available.
- Preserve the old scene and vehicle until the replacement road surface, paint and traffic are render-ready. Desktop retains one previous static neighbourhood; hide its duplicate crowds and traffic. On memory-constrained devices, retain only the transient handover scene, then release it. Carry throttle/steering keys, gear, RPM, health, fuel, score, pickups and cockpit view through transitions.
- Road generation now uses this region's prepared traffic arms. Previously it could use the previous region's arms during handover, painting roads and lanes in the wrong coordinate frame. Asphalt and road paint warm and replace as one layer; stale replacements cannot reattach after disposal.
- During driving, cap supersampling at 1.35 and about 2.2 million pixels, use 1024 shadows, and disable costly reflection/cloud effects. Reduce distant vehicle detail and pedestrian/plant workload for newly streamed scenes. Keep existing camera-frustum culling and restore architectural quality when driving ends. Device memory caps still apply.
- Development buttons require `devgame=1` on the current URL. Local storage no longer unlocks them. Removing the parameter ends driving; normal/shared links do not inherit it, and the share builder removes it. This is URL-based UI gating, not server-side authentication.

## Validation

- 41 frontend tests passed: four-direction preparation, concurrency, direction promotion, cached return trips, retry backoff, repair, development gating/sharing, atomic region-specific road replacement, road continuity/paint/footprint constraints and device budgets.
- Five backend nearby tests passed, including coordinate regions and invalid coordinates.
- TypeScript and Vite production build passed.
- Playwright/Edge real neighbourhood review: game, explosion/repair and URL gating passed. Surrounding-region responses were controlled fixtures for deterministic handover; the held accelerator survived and the old vehicle remained active until adoption. Zero page errors in the successful review.
- Steady PC game samples were approximately 55–60 fps. These are local measurements, not a guarantee for all devices, networks or scenes. The review writes frame timing and transition traces to `tmp/drive-game-review.json`.

Run the UI review from the repository root with a dev server at `http://127.0.0.1:5178`: `python frontend/scripts/test-drive-game-ui.py`. It reads production data but blocks telemetry/score writes, then uses controlled regional data. Development inspection globals are absent from production builds.
