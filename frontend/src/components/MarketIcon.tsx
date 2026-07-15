/** Small treemap-tile glyph for the KOSPI/KOSDAQ MAP nav links — echoes the tile
 * layout those links lead to, unlike the emoji it replaces (which didn't) and
 * renders as a crisp solid shape at nav-pill sizes instead of a platform-dependent
 * emoji glyph. Colored via `currentColor`, so it follows the parent pill's own
 * text color (see `.kospi-map-nav-link--kosdaq` in styles.css). */
export default function MarketIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? "market-nav-icon"}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1" width="8" height="14" rx="1.5" fill="currentColor" />
      <rect x="10.5" y="1" width="4.5" height="6.5" rx="1.5" fill="currentColor" opacity="0.55" />
      <rect x="10.5" y="8.5" width="4.5" height="6.5" rx="1.5" fill="currentColor" opacity="0.55" />
    </svg>
  );
}
