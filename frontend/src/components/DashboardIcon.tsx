/** Glyph for the "홈" (main dashboard) nav link — echoes the dashboard's own card
 * layout (a big header/chart block plus stacked side tiles and a wide footer bar)
 * rather than a generic house, matching how MarketIcon echoes the treemap and
 * BattleIcon echoes the tug-of-war rope. Colored via `currentColor`. */
export default function DashboardIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? "market-nav-icon"}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1" width="7" height="7" rx="1.4" fill="currentColor" />
      <rect x="9.2" y="1" width="5.8" height="3.1" rx="1.1" fill="currentColor" opacity="0.55" />
      <rect x="9.2" y="4.9" width="5.8" height="3.1" rx="1.1" fill="currentColor" opacity="0.55" />
      <rect x="1" y="9.2" width="14" height="5.8" rx="1.2" fill="currentColor" opacity="0.55" />
    </svg>
  );
}
