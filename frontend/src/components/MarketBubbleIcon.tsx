export default function MarketBubbleIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? "market-nav-icon"} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <circle cx="7" cy="10" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12.7" cy="5.2" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.35" />
      <circle cx="5.4" cy="8.3" r="1.15" fill="currentColor" opacity=".32" />
      <path d="M10.7 13.7c1.8-.3 3.1-1.2 4-2.8" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity=".55" />
    </svg>
  );
}
