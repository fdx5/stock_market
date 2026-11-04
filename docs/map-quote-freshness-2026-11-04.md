# Map entry quote freshness

## Production reproduction

On 2026-11-04, simultaneous public API reads returned Hyundai (005380) at
287,500 KRW / +3.60% for `/api/market/map?limit=20`, but
285,500 KRW / +2.88% for `limit=500`. Repeated full-map reads still returned
the older price. Naver's public quote reported the final NXT after-market
print at 20:00 KST: 287,500 KRW / +3.60%.

The quote caches were separated by requested limit and used stale-while-revalidate,
including the first page request. The frontend also replaced the entire map with
each full response, even when a newer partial response had already arrived.

## Change

- Keep the existing asynchronous roster cache; refresh expired prices in the
  requesting call. No synchronous full-roster scraping on page entry.
- KOSPI and KOSDAQ share leading quote tiers across partial and full requests.
  Leading quotes expire after four seconds; full-map tail quotes retain the
  existing sixty-second cadence. The top-sixty scanner retains its four-second TTL.
- Keep the last successful quote per stock during partial upstream failures and
  compare actual trade timestamps before accepting older prints.
- Include NXT trade timestamps and source identifiers in domestic map rows.
  A malformed upstream row no longer discards the rest of its quote batch.
- S&P 500 and Nasdaq 100 refresh their expired four-second bulk quote overlays
  synchronously. Existing bounded Yahoo chart recovery remains available when
  the bulk source fails; unavailable or delayed upstream data is not made real-time
  by this change.
- All four frontend maps preserve newer stock quotes when responses arrive out of
  order, while a full response still controls which stocks belong in the map.
  Partial requests cannot overlap another request for the same tier.

## Validation

- Based on latest remote main `de9c5ed6`, in an isolated worktree; unrelated local
  floorplan/walk changes were excluded.
- 37 backend fixture tests passed (memory only, no application startup or database).
- TypeScript check and Vite production build passed.
- Browser checks passed for all four routes at widths 1280 and 390, with synthetic
  APIs and muted Chromium. A delayed full response carrying +2.88% did not overwrite
  the already rendered +3.60%; additional tail stocks still appeared.
- Direct public upstream validation of the new quote layer returned all 500 KOSPI
  and 200 KOSDAQ quotes. Hyundai was +3.60% in both partial and full reads.
  Full quote fetches took about 0.16s / 0.14s from the local validation environment;
  these are observations, not production latency guarantees.

No persistent data, database schema, authentication settings, URLs, or theme changed.

## Production deployment

- Release commit: `e54417f48e46720d81087f1425dfb22e07580548`.
- Render service: `srv-d95okvtckfvc73bjfu3g`, workspace `stock_market`.
- Deploy: `dep-dbli1v5bedkc73aboo5g`, `live` at 2026-11-04 21:14:10 KST.
- `/api/health` returned `status=ok` and the release commit.
- Final API verification: KOSPI 500/500, KOSDAQ 200/200, S&P 503/503,
  Nasdaq 102/102 returned actual quote timestamps. Both US responses reported
  pre-market, and their NVDA quote time and price agreed in the final check.
- Hyundai: both 20-stock and 500-stock responses returned 287,500 KRW,
  +3.60%, `naver_nxt`, with the 20:00 KST trade timestamp.
- Real production browser: all four maps rendered without page errors.
  Hyundai showed +3.60% immediately and remained +3.60% after the next poll.
- No error-level Render logs were returned for the post-deployment check.
- API/browser validation artifacts and screenshots are under the isolated
  worktree's `tmp/` directory; they contain public market data only.
