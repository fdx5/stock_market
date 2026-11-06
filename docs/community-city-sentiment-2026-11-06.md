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

## Production release verification

- Runtime commit: 2b1fc76cc07fbddc03c620c331ceee055d9f648b.
- Render deployment: dep-dbmjq068bjmc73dohmng, live 2026-11-06 02:38:23 UTC / 11:38:23 KST.
- Dashboard: https://dashboard.render.com/web/srv-d95okvtckfvc73bjfu3g/deploys/dep-dbmjq068bjmc73dohmng
- /api/health status=ok and exact runtime commit confirmed; city WebP serves200 image/webp,552972 bytes.
- Actual production source data, full bodies, public comments and snapshot-scoped page2 verified on every board. Counts below can include earlier verified rows during a progressive refresh. Cold collection is slower from the hosting region; the reader remains available and newer verified rows are published while collection continues.
- Production native-DPR city canvas, all three entry screens, actual article opening and home gauges tested on desktop/portrait/landscape. Home has3 numeric gauges above market maps on1440px and390px widths. No page JavaScript errors or horizontal overflow. Error-level Render application logs since release were empty at02:41:14UTC.
- Screenshot/JSON evidence remains under I:/ai_root/sm-community-city-20261106/tmp/ (not published). Local layout/performance evidence remains under I:/ai_root/sm-deploy/tmp/community-city-qa/.

API summaries:
```json
{
  "commit": "2b1fc76cc07fbddc03c620c331ceee055d9f648b",
  "boards": [
    {
      "board": "kr",
      "total": 143,
      "first_page": 50,
      "refreshing": true,
      "sources": [
        "디시인사이드 · 코스피"
      ],
      "latest_age_seconds": 131,
      "body_blocks": 1,
      "seconds": 139.77,
      "page2_count": 50,
      "pages_disjoint": true,
      "comment_status": "ok",
      "comments_count": 2
    },
    {
      "board": "global",
      "total": 155,
      "first_page": 50,
      "refreshing": true,
      "sources": [
        "디시인사이드 · 미국 주식"
      ],
      "latest_age_seconds": 15,
      "body_blocks": 1,
      "seconds": 141.94,
      "page2_count": 50,
      "pages_disjoint": true,
      "comment_status": "ok",
      "comments_count": 2
    },
    {
      "board": "property",
      "total": 56,
      "first_page": 50,
      "refreshing": false,
      "sources": [
        "디시인사이드 · 부동산"
      ],
      "latest_age_seconds": 439,
      "body_blocks": 2,
      "seconds": 109.66,
      "page2_count": 6,
      "pages_disjoint": true,
      "comment_status": "ok",
      "comments_count": 1
    }
  ]
}
```

UI summaries:
```json
[
  {
    "board": "kr",
    "viewport": [
      1440,
      1000
    ],
    "dpr": 1,
    "canvas": {
      "w": 1440,
      "h": 1000
    },
    "posts": 1,
    "reader": true,
    "errors": []
  },
  {
    "board": "global",
    "viewport": [
      390,
      844
    ],
    "dpr": 3,
    "canvas": {
      "w": 1170,
      "h": 2532
    },
    "posts": 20,
    "reader": true,
    "errors": []
  },
  {
    "board": "property",
    "viewport": [
      844,
      390
    ],
    "dpr": 2,
    "canvas": {
      "w": 1688,
      "h": 780
    },
    "posts": 16,
    "reader": true,
    "errors": []
  },
  {
    "home_width": 1440,
    "gauge_values": [
      "5/ 100",
      "14/ 100",
      "8/ 100"
    ],
    "above_maps": true,
    "errors": []
  },
  {
    "home_width": 390,
    "gauge_values": [
      "6/ 100",
      "13/ 100",
      "8/ 100"
    ],
    "above_maps": true,
    "errors": []
  }
]
```
