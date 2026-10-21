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
* Frame lights add a colored blade, white core, bright head and a wider illuminated
  section of the neighboring rule. Motion follows the panel perimeter; the user
  can toggle it in Display settings. Only visible frames animate. Reduced motion,
  Minimal FX and immersive 3D routes disable these overlays. Render resolution and
  data/chart calculations are unchanged. SVG decorations ignore pointer input.
* The page-local finder now uses a bounded SVG magnifier and explicit flex
  alignment, correcting the old font glyph's left overhang.

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
* Frame tests in Chrome and Windows WebKit verify changing stroke offsets, on/off,
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
Release receipts and final production checks belong in local `qa/`, avoiding a
documentation-only second server rebuild.

The drone explorer intentionally retains its existing full-screen body portal and
close control. Its control palette inherits the new theme; its renderer, resolution,
camera movement and browser fallback are outside this design change. No actual Mac
hardware verification is claimed.
