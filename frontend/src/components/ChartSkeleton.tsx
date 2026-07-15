// Arbitrary bar heights (% of container) - not real data, just enough variation to
// give the loading overlay a plausible candlestick-chart silhouette instead of a
// single blank pulsing rectangle, mirroring the treemap skeleton's fake-weights approach.
const BAR_HEIGHTS = [
  38, 55, 42, 68, 50, 60, 40, 72, 58, 66, 45, 70, 52, 48, 75, 60, 50, 65, 42, 58, 48, 62, 44, 70, 55, 50, 68, 46, 60,
  52,
];

export default function ChartSkeleton() {
  return (
    <div className="chart-skeleton" aria-hidden="true">
      {BAR_HEIGHTS.map((h, i) => (
        <span
          key={i}
          className="skeleton chart-skeleton-bar"
          style={{ height: `${h}%`, animationDelay: `${(i % 10) * 60}ms` }}
        />
      ))}
    </div>
  );
}
