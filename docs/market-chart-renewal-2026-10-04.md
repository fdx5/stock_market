# Market charts renewal

The market desk, international market, stock browser, company detail, index detail,
and TOP100 trends now use a shared Apache ECharts renderer. Candles retain OHLC
order, volume, SMA5/20/60/120 and optional Bollinger bounds. RSI/MACD charts retain
date-based synchronization with the price chart. Data sources and calculations are
unchanged.

Charts initialize on viewport entry using IntersectionObserver. Initial lines are
drawn over 1.1 seconds; bars/candles use a staggered reveal. Subsequent updates use
280ms transitions. Reduced-motion users receive immediate rendering. Engine modules
load dynamically (about 203KB gzip, cached) rather than in the initial application
bundle. ResizeObserver resizes canvases; unmount disposes instances and listeners.

Regular wheel gestures scroll the page; Ctrl-wheel and the range slider zoom. Date
boundaries are resolved to actual trading sessions, including weekend boundaries.
Theme colors come from the chart's computed CSS variables. Tooltips use ECharts
richText rendering rather than HTML. Missing points remain gaps; missing sentiment
values have no gauge needle.

Verification:

- `npm run build` in the isolated deployment worktree.
- `python frontend/scripts/test-market-charts.py` against the local Vite server:
  actual animation advances, candle order, initial range, overlay toggle, date sync,
  crosshair readout, wheel scrolling, viewport deferral, disposal/remount,
  reduced motion, desktop/mobile layout.
- `python frontend/scripts/test-market-chart-pages.py`: production public data on
  local pages; eight desktop routes and four mobile routes, no runtime errors or
  horizontal overflow. Mobile stock preview is checked through its existing sheet.
- Desktop chart instances: desk 34, international 30, stock browser 1, domestic
  stock 4, US stock 3, index 3 (indicators initially collapsed), KOSPI100 100,
  global TOP100 99 (one item has no history).

Library documentation: https://echarts.apache.org/handbook/en/basics/import/
Animation: https://echarts.apache.org/handbook/en/how-to/animation/transition/
