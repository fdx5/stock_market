/** Globe-with-headline glyph for the "글로벌 뉴스" nav link — a latitude-lined globe
 * (echoing the page's global TOP20 roster) with a small headline/text-line badge
 * overlapping its corner, reading as "world news" rather than a generic document
 * icon. Colored via `currentColor`, matching MarketIcon/BattleIcon's approach. */
export default function GlobalNewsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? "market-nav-icon"}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="6.5" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <ellipse cx="6.5" cy="7" rx="2.3" ry="5.5" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.75" />
      <path d="M1.2 5.3H11.8" stroke="currentColor" strokeWidth="1.1" opacity="0.75" />
      <path d="M1.2 8.7H11.8" stroke="currentColor" strokeWidth="1.1" opacity="0.75" />
      <rect x="9" y="8.6" width="6" height="6.4" rx="1.2" fill="currentColor" />
      <rect x="10.3" y="10.1" width="3.4" height="1" rx="0.5" fill="var(--surface-1, #1a1a19)" />
      <rect x="10.3" y="11.7" width="3.4" height="1" rx="0.5" fill="var(--surface-1, #1a1a19)" />
      <rect x="10.3" y="13.3" width="2.1" height="1" rx="0.5" fill="var(--surface-1, #1a1a19)" />
    </svg>
  );
}
