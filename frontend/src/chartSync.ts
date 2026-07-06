import type { IChartApi, Time } from "lightweight-charts";

// Time-based (not index-based) sync: the price chart and the indicator charts
// can hold different numbers of points (the price chart applies the 1M/3M/.../3Y
// range filter, the indicator charts always plot the full history), so syncing by
// logical index would align mismatched dates. Syncing by actual time values keeps
// the visible date window consistent across charts regardless of point count.
export function syncTimeScales(charts: IChartApi[]): () => void {
  let syncing = false;
  const handlers = charts.map((chart, index) => {
    const handler = (range: { from: Time; to: Time } | null) => {
      if (syncing || !range) return;
      syncing = true;
      charts.forEach((other, otherIndex) => {
        if (otherIndex !== index) {
          other.timeScale().setVisibleRange(range);
        }
      });
      syncing = false;
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(handler);
    return handler;
  });

  return () => {
    charts.forEach((chart, index) => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(handlers[index]);
    });
  };
}
