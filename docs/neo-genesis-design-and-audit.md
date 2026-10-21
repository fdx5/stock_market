# NEO GENESIS — implementation map

Reference: `I:/ai_root/stock_market/docs/KOSPIMAP_NEO_GENESIS_Master_Guide.md` (2026-10-21).

## Audit and design before implementation

The deployed source at `65cdd85d` is the baseline. This work is isolated in
`.local-server/neo-genesis-20261021`; the original working directory has unrelated
uncommitted work. No backend process, migration, database test, or deletion is run.

The application is a React 18 / TypeScript / Vite SPA with route-level lazy loading,
a custom History API router, plain scoped CSS, lightweight-charts, ECharts, SVG
heatmaps, and separate Three.js/WebGPU exploration engines. The shared broadsheet
shell is `desk2/Masthead`, `shell`, `CommandBar`, `MobileDock`, and `Colophon`.
Other pages have their own headers. Snapshot, indices and ticker hooks already
deduplicate polling. The redesign reuses these hooks and the existing API client.

`App.tsx` is the routing authority; `backend/app/data/system_inventory.json` lists
54 route entries. Static market, map, stock, ETF, ranking, news, briefing, portfolio,
forecast, comparison, support, admin and exploration routes coexist with dynamic
stock/detail/report, investor, index, sector, ETF comparison and dated briefing
paths. Existing path handling and SEO metadata code remain authoritative.

### Proposed structure

* One global shell: 68px command header, grouped navigation rail on desktop,
  market pulse band, route breadcrumb, route content, directory footer. Mobile:
  56px header, horizontally readable market pulse, 5-slot bottom navigation,
  searchable full directory in a modal.
* Home becomes a market hub; `/hub` and `/type2` retain the existing solar entrance.
  Domestic/global desks remain specialized workspaces. Their first screen contains
  the actual indices, real chart and breadth, rather than a decorative billboard.
* The revised plum/ivory/mustard/vermilion/violet system supplies both legacy token vocabularies;
  page-family adapters change layouts, panels, typographic hierarchy and controls.
  Chart colors use a matching theme adapter. Heatmap area/color logic is preserved.
* One common search uses the existing Finder API and keyboard behaviors. Global
  groups expose all existing destinations and external links. Existing page-local
  filters, source notes, empty/error states, search and section navigation remain.
* Full/Balanced/Minimal effects are CSS-only presentation levels. Reduced motion
  wins. No output-resolution/quality/LOD reduction is introduced into 3D engines.
* Local development opens the redesign by default. `?design=classic` restores the
  previous UI; `?design=neo` activates the preview without changing canonical URLs.
  The user subsequently authorized deploying this design as the default.

### Change boundaries

`neo/`: settings, shared shell, icons/components, route directory, home hub,
design tokens, page-family adapters and documentation. `App.tsx`: shell integration
and home selection only. `theme.ts`: single-dark theme and canvas palette adapter. `main.tsx` and
`index.html`: preview bootstrap and first-paint theme. `desk2`: new workbench layout
and presentation integration, preserving existing data/sections. No API schema,
stored data, collector, video scheduler, drone rendering or server SEO changes.

### Validation plan

Baseline browser captures and lab measurements are written to timestamped `qa/`
directories. Validate 360/390/430/768/1024/1440/1920 widths, representative route
families and every static route's shell. Test search, menu focus/Escape, keyboard,
navigation, map selection, stock links, FX/reduced motion, classic escape, empty
and unavailable API states, titles/canonical and print. Build and existing contract
tests run before handoff. Lab LCP/CLS/heap/frame timing are measurements, not
75th-percentile field CWV claims. Windows WebKit is not a real macOS/iOS test.

## User-directed art revision (2026-10-21)

The user rejected the initial common cyan/purple glow-card treatment as generic.
Their later directions take precedence over the guide's sample palette and geometry.
The preview now uses a printed market-atlas composition: plum-black (#100d13), warm
ivory (#f3ecdc), neon lilac (#bf85ff), mustard (#d6b54e), vermilion (#f27560), and
muted sage (#a8bca0). Open rules, square corners, stronger typography, numbered
navigation, solid ink areas and asymmetric columns replace repeated glowing cards.
Quote direction retains red up/blue down, signed returns and labels; brand color is
kept separate from the meaning of stock movements. No fabricated graph data is used.

* `/`: cross-market entrance, two regional spreads, four cross-asset quotes and
  purpose-led links. The duplicate Korean chart/heatmap/movers/investor/video blocks
  were removed from home; their full services remain on the country desks.
* `/desk`: mustard identity, flows before index chart, breadth and stock analysis.
* `/global`: vermilion identity, index workspace with a vertical cross-asset rail
  at wide widths, plus a sector digest. Duplicate masthead/title removed.
* US map feeds currently omit dollar `market_cap`; the new digest uses the actual
  supplied index weight (`marcap`, percent) and explicitly labels that basis. It
  excludes unquoted/invalid constituents and duplicates and shows a dash when empty.
  Existing dollar-cap-specific detail components and APIs were not reinterpreted.
* All other page families inherit the new surfaces, typography, rules and controls;
  heatmap data colors/areas and 3D rendering semantics remain unchanged.

There is one dark appearance. Day/night controls are absent. Previous stored theme
preferences are ignored without clearing saved settings. The original SVG K Stock
Hub identity is supplied as component, lockup asset and favicon, using the revised
lilac/mustard/vermilion palette.

Fonts: Pretendard Variable for Korean/UI, IBM Plex Sans Condensed for numbers and
IBM Plex Mono for compact labels. Loading uses fallbacks and optional font display.
Both families use SIL OFL 1.1: [Pretendard license](https://github.com/orioncactus/pretendard/blob/main/LICENSE),
[IBM Plex license](https://github.com/IBM/plex/blob/master/LICENSE.txt).

## Local review

Preview: http://127.0.0.1:5521/?design=neo . Country desks: `/desk` and `/global`.
The user authorized production deployment after local review. `?design=classic`
switches presentation back within the browser session; `?design=neo` restores the
preview. The public URLs, metadata handling and backend jobs remain as before.

## Authorized release additions

* NEO is now the default on production as well as local development. The optional
  classic escape remains reversible and has a return-to-new-design button.
* The atlas has a custom SVG cross-market signal circuit, moving light packets,
  rotating node frames and a scanning beam. These are decorative, not fake prices.
* Header clocks show Korean and New York wall time, seconds and local dates.
  IANA time zones automatically handle US daylight saving and date differences.
  Warm yellow neon digits remain visible in the two-row mobile header.
* A shared top BGM player reuses the existing playlist/store: play/pause, previous,
  next, power, title and a playback-synchronized canvas visualizer. Tracks can be
  selected before playback. Route changes keep the same player. The visualizer
  follows the track tempo/playback clock; it does not claim live audio analysis.
  No autoplay is introduced. Native solar-page music is hidden in NEO to prevent
  concurrent playback. Reduced motion/Minimal FX keeps the meter static.
* Frame lights trace only the border sides that already exist, aligned to their
  actual position. They pulse slowly from completely off to lit and back off in
  12–18 seconds. Peak opacity is 1 with a 35% white mix for a more visible neon
  highlight; the stroke stays 1px. These frames have no travelling strokes or
  added box edges. At the user's later request, the single header/Market Pulse
  boundary instead carries a yellow electrical packet from left to right in
  eight seconds, with a small crackling tip and a thin fading trail. The header
  is excluded from the general frame glow to avoid overlapping effects.
  The refined discharge occupies 84x19px with ten irregular arc shapes that
  morph continuously, fine amber branches, two tiny motes and a graduated warm trail.
  A pale filament has a soft local bloom; the underlying line remains 1px.
  All ten cores are normalized to 43 points; four branches have matching point
  counts. Native SVG spline interpolation generates intermediate geometry on the
  browser's rendering clock, rather than replacing completed shapes. SVG/CSS
  animations use no JavaScript frame loop. Shape cycling takes 4.7s,
  separate from the 8s travel; fine branches brighten on a third 2.17s cycle.
  Chrome and Windows WebKit checks cover ten distinct rendered shapes, left-to-right movement, boundary
  alignment, pointer pass-through and reduced motion at 320/390/768/1440px.
  The user
  can toggle it in Display settings. Only visible frames animate. Reduced motion,
  Minimal FX and immersive 3D routes disable these overlays. Render resolution and
  data/chart calculations are unchanged. SVG decorations ignore pointer input.
* Current online counts use a separate bold, bright green number and matching
  presence icon/dot; cumulative visit totals retain their secondary styling.
* The page-local finder now uses a bounded SVG magnifier and explicit flex
  alignment, correcting the old font glyph's left overhang.
* Phone investor cards explicitly reset the old horizontal carousel's auto-flow
  and implicit column sizing before applying the two-column grid. This prevents
  the first cards collapsing to 24px and later cards overflowing horizontally.
  Holdings and footers remain bounded inside each card. Showcase and catalogue
  cards are verified in portrait at 360/390/430px on both browser engines.
* Opening the mobile destination menu focuses its close button instead of the
  search field, preventing the virtual keyboard from opening automatically.
  Search still accepts focus on tap; desktop search focus and modal focus return
  are preserved.
* Map tiles, sector blocks, loading blocks and outer map corners are square.
  A general button radius previously rounded the button-based market tiles;
  the map-specific rule now takes precedence.
* Mobile map pages share five always-visible destination buttons (KOSPI, KOSDAQ,
  S&P 500, NASDAQ 100 and property), pinned below the global header while scrolling.
  All destinations remain visible without horizontal swiping, with 44px touch
  targets and a highlighted current map. Desktop keeps its existing sidebar.
  Fixture checks cover 40 map/width/browser combinations at 320–899px in Chrome
  and Windows WebKit, route changes, sticky positioning, square corners, and
  English labels. Separate menu checks preserve manual search and focus return.

## Verification record

* TypeScript and production build passed; existing overview/editorial tests: 11.
* Before the final header additions, the full sweep covered 100 responsive route/
  width cases and 49 additional paths with no layout overflow. Seven Windows
  WebKit resource-access errors were recorded in the live-feed sweep; that run
  is not reported as a clean browser pass. The errors involve stock icons and
  real-estate resources, not a claimed actual Mac hardware test.
* Final header/transport fixture tests passed Chrome and Windows WebKit at seven
  widths each. They verify advancing clock seconds, winter/summer New York offsets,
  previous-day dates, play/pause, next/previous, one player across navigation,
  changing meter pixels during playback and static reduced-motion output.
* A separate actual YouTube iframe playback check in muted Chrome confirmed the
  player clock advanced from 4.70 to 6.90 seconds. Provider availability remains
  external; fixture results alone are not presented as actual audio playback.
* Frame tests in Chrome and Windows WebKit verify changing opacity, absence of
  travelling strokes, on/off,
  portal cleanup/navigation, reduced motion, asset-grid preservation and magnifier
  containment. A production-build Chrome sweep covered 20 core route/width cases
  without application errors or overflow before the final beam addition.
* Accessibility checks: focus traps/return, English, reduced motion, print and
  unavailable-feed cases passed in both engines. Existing database tests were
  not run. No existing or production database was used as a test database.

Initial fixed-viewport production-build lab results are preserved in
`qa/lab-20261021-215200/result.json` (before the final clocks/BGM/frame effects).
They showed faster first content for the new home, but stock-page CLS increased
and entry CSS/JS grew. These are not final performance improvement claims. That
headless environment sampled near 32 FPS for both old and new designs; a universal
50/60 FPS target, real device performance and actual Mac/iOS flight are not claimed.
The final pulse build was also sampled in muted headless Chrome at 1440x1000,
DPR 1: 180 frames, 32.05 average FPS, 31.99 minimum one-second FPS, p95 31.6ms,
p99 31.8ms, maximum 80.6ms. This remains below 50 FPS in that environment;
no rendering resolution was reduced and no universal performance pass is claimed.
The October 22 ten-shape morph was sampled separately in muted headless
Chrome at 1440x1000, DPR 1: 180 frames, 60.08 average FPS, 59.98 minimum
one-second FPS, p95/p99 16.8ms and maximum 19.7ms. This is a local header
effect check, not a claim about 3D flight or every device.
Release receipts and final production checks belong in local `qa/`, avoiding a
documentation-only second server rebuild.

The drone explorer intentionally retains its existing full-screen body portal and
close control. Its control palette inherits the new theme; its renderer, resolution,
camera movement and browser fallback are outside this design change. No actual Mac
hardware verification is claimed.

## October 22 cross-market pages and share previews

Seven public `/prices/` pages cover USD/KRW, Bitcoin, Ethereum, XRP, WTI crude
futures, gold futures and silver futures. Each has a calendar-year daily close chart,
keyboard/pointer date inspection, 1/3/6-month and 1-year ranges, annual high/low and
change, and paginated daily OHLC/change records. Crypto and commodity families have
three-way destination buttons. Home, Market Pulse, both market overviews and legacy
quote surfaces link into the detail pages; Ethereum joins the overview asset strip.

The new read-only daily-history service requests Yahoo's daily bars with bounded
timeouts and host fallback, uses the provider's daily timezone and a five-minute
single-flight memory cache, and preserves a preceding close for the first displayed
day's change. Missing values remain missing. Quote and daily-history timestamps and
FX/futures units are explicit. There are no database or persistent-store operations
in this service. Seven concrete API routes deliberately keep request latency/error
series separate per asset. Page labels, graph nodes and page-to-API/Yahoo edges,
and the source-derived System Atlas route inventory include all seven pages.

All 42 destinations in the complete left-menu directory have newly rendered,
distinct 1200x630 PNG share cards, titles and descriptions. The generator creates
original decorative route graphics rather than simulated market screenshots.
Matching static manifests drive server HTML Open Graph/Twitter/structured-data
images and client-side navigation. Hashes in image filenames avoid reusing an old
image URL. Existing dated-brief and detailed-stock SEO handling remains in place.
The small favicon uses a large dark K on a bright yellow tile, with SVG and
16/32/180/192px raster variants and versioned icon URLs.

Map-family content removes the 1800px maximum measure and fills the available
workspace width. Chrome and Windows WebKit checks cover all five maps at 390,
1920, 2560, 3440 and 3840px (50 cases), including the actual equity-map canvas.
The seven price pages passed 56 browser/viewport cases using real provider-history
snapshots, plus chart keyboard inspection, ranges, daily pagination, cross-navigation
and unavailable-provider retry. Independent backend tests cover calendar/leap-year
boundaries, timezones, incomplete bars, finite JSON, fallback, seven route identities,
monitor graph dependencies and all 42 raw-HTML metadata/image contracts. No existing
database is used for testing; browser telemetry is intercepted in local UI fixtures.

Additional shell fixes: news company selection exposes the full roster in a wrapping
grid; the support coffee link precedes the single BGM player; drone explorer is
destination 05 in Explore. Market routes use gold electrical currents and map/ETF/
intelligence routes use violet. Independent SVG gradients serve the header and
Market Pulse boundaries and the downward violet sidebar current. The Pulse grid
item's inherited z-index is reset so it cannot obscure the upper half of the lower
current. Hidden-sidebar/mobile, reduced-motion and effects-off behavior are retained.
The audio meter and marquee defer ResizeObserver writes to animation frames.

Orbit textures were not universally missing from the CDN: a lifetime automatic
loading cap stopped after ten planets, leaving later visible bodies on placeholders.
Visible loading now continues with a three-item pending-work budget, retries and a
full-surface fallback for a failed preview. Resolution and material quality are
unchanged. Real-feed Chrome checks loaded 16 KOSDAQ, 16 NASDAQ and 19 KOSPI surfaces,
and verified a deliberately failed preview recovered through the full image. At a
1440x1000 viewport, DPR 1, the orbit drawing buffer stayed 1232x833. Post-drag samples
of 180 frames had minimum one-second rates near 59.98 FPS; these are local orbit
checks, not a universal-device or actual Mac/drone-flight claim.

### Synapse spherical topology — 2026-10-22

The flattened side view came from compressed Y/Z coordinates in service anchors,
satellite placement and decorative ellipses. Six service anchors now occupy the
six directions of an octahedron; other inventory anchors use a Fibonacci sphere.
Satellites use isotropic spherical offsets. Three circular, orthogonal outer rings
wrap the volume, and the home camera fits its bounding sphere using the limiting
horizontal/vertical field of view. Camera distance limits accommodate portrait
screens. Inventory identities, measured traffic and rendering quality are unchanged.

Model checks cover stable positions, finite coordinates, balanced XYZ spans,
24 viewing azimuths and spherical bounds alongside existing graph/signal checks.
The production frontend build passed. Isolated Chrome browser fixtures verified
front/side rotation, API-node selection and a 390px mobile viewport without writes
to stored data. At 1600x1200, DPR 1, balanced quality, the canvas CSS and drawing
buffer both remained 1228x1056 (427 nodes / 5949 links). Sustained manual rotation
recorded minimum one-second 59.96 FPS, p95 17.0ms, p99 17.4ms and maximum 28.1ms.
This steady-rotation fixture does not establish a universal FPS floor or actual
Mac performance; startup and different inventories/devices can differ.
