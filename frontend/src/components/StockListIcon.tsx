/** Ranked-list glyph for the 종목정보 nav link — rows with a leading marker, and a
 * short one at the bottom to read as "a list that continues past what you see".
 *
 * Deliberately neither RankIcon nor MarketIcon, the two it sits between in the row.
 * RankIcon is a podium (a ranking that ends at three) and MarketIcon is a treemap tile
 * grid (the maps); this page is a long scrollable roster, and at pill size the
 * silhouette is what tells the three apart before any label is read. Colored via
 * `currentColor`, so it follows the pill's own accent like every other icon here. */
export default function StockListIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? "market-nav-icon"} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="2.6" cy="3.4" r="1.4" fill="currentColor" />
      <rect x="6" y="2.4" width="10" height="2" rx="1" fill="currentColor" />
      <circle cx="2.6" cy="8" r="1.4" fill="currentColor" />
      <rect x="6" y="7" width="10" height="2" rx="1" fill="currentColor" />
      <circle cx="2.6" cy="12.6" r="1.4" fill="currentColor" opacity="0.55" />
      <rect x="6" y="11.6" width="6" height="2" rx="1" fill="currentColor" opacity="0.55" />
    </svg>
  );
}
