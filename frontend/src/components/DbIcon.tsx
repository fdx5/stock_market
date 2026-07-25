/** Stacked-disc glyph for the admin-only DB 조회 nav pill — the one database-shaped
 * mark in the nav row, so it reads as "storage" next to the market/chart icons rather
 * than as another market view. Colored via `currentColor`, like MarketIcon, so it
 * follows the pill's own text color (see `.kospi-map-nav-link--db` in styles.css). */
export default function DbIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? "market-nav-icon"}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <ellipse cx="8" cy="3.2" rx="6" ry="2.2" fill="currentColor" />
      <path d="M2 3.2v4.4c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V3.2" fill="currentColor" opacity="0.55" />
      <path d="M2 7.8v4.4c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V7.8" fill="currentColor" opacity="0.35" />
    </svg>
  );
}
