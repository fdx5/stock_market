/** Two overlapping speech bubbles for the "종목토론" (stock discussion) nav link —
 * reads as a back-and-forth conversation rather than a single announcement.
 * Colored via `currentColor`, matching MarketIcon/BattleIcon's approach. */
export default function DiscussionIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? "market-nav-icon"}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="6" y="1" width="9" height="6.5" rx="2" fill="currentColor" opacity="0.5" />
      <path d="M9 7.5 9 9.3 11 7.5Z" fill="currentColor" opacity="0.5" />
      <rect x="1" y="6" width="9" height="6.5" rx="2" fill="currentColor" />
      <path d="M3 12.5 3 14.3 5.2 12.5Z" fill="currentColor" />
    </svg>
  );
}
