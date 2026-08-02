/** Globe-with-meridians glyph for the 글로벌 시가총액 TOP 100 nav link — distinct from
 * RankIcon's podium (that one leads to a single market's board; this one leads to a
 * worldwide ranking) at the same nav-pill size. Colored via `currentColor`, matching
 * every other icon in the row. */
export default function GlobeRankIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? "market-nav-icon"} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <ellipse cx="8" cy="8" rx="2.6" ry="6.5" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.75" />
      <line x1="1.5" y1="8" x2="14.5" y2="8" stroke="currentColor" strokeWidth="1.1" opacity="0.75" />
      <line x1="2.4" y1="5.1" x2="13.6" y2="5.1" stroke="currentColor" strokeWidth="1" opacity="0.55" />
      <line x1="2.4" y1="10.9" x2="13.6" y2="10.9" stroke="currentColor" strokeWidth="1" opacity="0.55" />
    </svg>
  );
}
