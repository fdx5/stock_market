/** Layered fund shares with a rising price line, kept legible at nav-pill size. */
export default function EtfIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? "market-nav-icon"} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="1" y="9" width="10" height="5" rx="1.5" fill="currentColor" opacity="0.45" />
      <rect x="3" y="6" width="10" height="5" rx="1.5" fill="currentColor" opacity="0.7" />
      <path d="M5 8.5 8 5.5l2 1.6L14.2 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m11.8 3 2.4 0 0 2.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
