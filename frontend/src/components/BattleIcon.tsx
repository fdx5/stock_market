/** Tug-of-war rope glyph for the "시총대결" (market-cap battle) nav link — echoes the
 * actual battle page (a rope tug-of-war between two stocks) instead of the generic
 * 🔥 emoji it replaces, which read as "trending" rather than "head-to-head contest".
 * Colored via `currentColor`, matching MarketIcon's approach. */
export default function BattleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? "market-nav-icon"}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="7" width="14" height="2" rx="1" fill="currentColor" />
      <path
        d="M1 5L3.6 8L1 11"
        stroke="currentColor"
        strokeWidth="1.7"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15 5L12.4 8L15 11"
        stroke="currentColor"
        strokeWidth="1.7"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
