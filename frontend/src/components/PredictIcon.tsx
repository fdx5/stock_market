/** Forecast glyph for the "AI 종목예측" nav link — a rising candle-and-line trace with
 * a spark at the leading edge, reading as "a projection past the last known bar"
 * rather than a generic chart. Colored via `currentColor`, matching
 * MarketIcon/BattleIcon/GlobalNewsIcon's approach so it follows the parent pill's
 * own text color. */
export default function PredictIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? "market-nav-icon"}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      {/* Known history: solid bars. */}
      <rect x="1" y="9.5" width="2.4" height="5.5" rx="0.8" fill="currentColor" opacity="0.55" />
      <rect x="4.6" y="7" width="2.4" height="8" rx="0.8" fill="currentColor" opacity="0.7" />
      <rect x="8.2" y="10" width="2.4" height="5" rx="0.8" fill="currentColor" opacity="0.55" />
      {/* The projection itself — deliberately the one dashed stroke in the icon set,
          because here "dashed" carries real meaning (it isn't drawn yet). */}
      <path
        d="M2.2 8.2 L5.8 5.6 L9.4 8.6 L13.4 3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="0 0 0 0 3.5 2"
      />
      <circle cx="13.4" cy="3.4" r="2.1" fill="currentColor" />
      <circle cx="13.4" cy="3.4" r="0.85" fill="var(--surface-1, #1a1a19)" />
    </svg>
  );
}
