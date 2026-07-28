/** Podium glyph for the TOP 100 nav links — three bars with the tallest in the
 * middle, which reads as a ranking rather than as another chart. Deliberately not
 * MarketIcon (the treemap-tile glyph): those links lead to the maps, this one leads
 * to a ranked board, and at nav-pill size the difference in silhouette is the only
 * thing telling them apart before the label is read. Colored via `currentColor`, so
 * it follows the pill's own accent like every other icon in the row. */
export default function RankIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? "market-nav-icon"} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="1" y="7" width="4" height="8" rx="1" fill="currentColor" opacity="0.55" />
      <rect x="6" y="2" width="4" height="13" rx="1" fill="currentColor" />
      <rect x="11" y="9.5" width="4" height="5.5" rx="1" fill="currentColor" opacity="0.55" />
    </svg>
  );
}
