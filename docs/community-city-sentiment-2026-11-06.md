# Community city entry, fresh sources and home sentiment gauges

Scope: stock_market / kospimap.com. Release is based on production main d7e037f1; unrelated local work in sm-deploy is preserved.

## Community sources
Active collection replaces Paxnet and 82cook search pages with public DCInside kospi, stockus and immovables boards. Respect robots policy and fixed canonical URLs; no login or cookies. Skip notices/ads and creation timestamps that cannot be parsed. Property titles are filtered for property topics. Fetch 3 source pages for stock boards and 6 for property. Retain legacy readers for compatibility, without collecting legacy sources. Reading snapshots are process memory only.

Verified bodies are published progressively; a partial refresh retains older verified rows from active sources. UI accepts newer snapshots even when the item count is unchanged. Readers keep their selected snapshot. Actual newest post time is separate from collection time. Comments use the provider's read-only listing protocol; only comment text, ID, reply relation and date are returned. No author names, IPs, profiles or public capability tokens are stored or logged.

Actual source verification at about 11:33 KST: KR 144 grouped posts, global 140, property 57; first pages each 50; latest ages 54s / 51s / 166s at completion. Full body retrieval and non-overlapping snapshot pagination verified. Full cold collections with all three boards concurrent took 28?50s; background requests remain immediate and publish verified rows before completion.

## City entry
One generated 1672x941 cinematic city panorama, WebP 552972 bytes. The background itself is not a native 4K image. Canvas rain and aerial traffic render at the display's full devicePixelRatio, including 3840x2160 output; SVG/HUD and typography stay resolution independent. Camera movement, atmospheric haze and searchlights are animated separately. No video or additional rendering dependency. The modal lasts about 3.15s plus at most 650ms image head start. Feed requests proceed independently. Skip, Escape, native modal focus, scroll restoration, reduced motion, minimal effects, image failure and cleanup verified.

Chrome 157.0.8103.38 headless/muted, full native pixel ratio, balanced setting, no screenshots taken during frame timing. Local desktop environment only: 1440x1000 DPR1 average56.6/min1s53.0fps, p95=16.8/p99=50/max100.1ms; mobile390x844 DPR3, landscape844x390 DPR2, 1920x1080 DPR2 (3840x2160 canvas): average/min1s60fps, p95/p99/max16.8ms. This is not a claim about every physical mobile device. Screenshot capture in an earlier instrumented run stalled frames and is excluded from these performance samples.

## Home fear and greed
Three SVG gauges immediately above market maps: KOSPI / KOSDAQ / NASDAQ100. Shared existing map snapshots, no additional polling or external market requests. Explicit KOSPIMAP daily-return sentiment proxy, not CNN or an official whole-market/investor-survey index. NASDAQ label identifies NASDAQ100, not the Composite.

Universe: 60 leading securities. KR weights use market cap; US weights use index inclusion weight. Breadth=100*(advancers+0.5*flat)/verified. Momentum=50+50*tanh(cap-weighted daily percent return/3). Score=round(0.55*breadth+0.45*momentum), bounded0?100. The scale3 is model-specific. Require >=48 valid stocks and >=80% coverage; missing data displays no numeric score, never a fabricated50. Labels:0?24 extreme fear,25?44 fear,45?55 neutral,56?75 greed,76?100 extreme greed. Show coverage, constituent counts, weighted return, oldest input quote timestamp if complete or separately identified fetch timestamp. Method is disclosed in the UI.

## Validation
30 isolated in-memory backend tests and 6 pure model tests passed; no app.main import, DB connection, migrations or direct stored-data changes. Production TypeScript/Vite build passed (pre-existing large-chunk advisories remain). Desktop/portrait/landscape layouts, full-DPR canvas, missing asset/data and motion settings verified. Live verification and deploy identifiers are appended after release.
