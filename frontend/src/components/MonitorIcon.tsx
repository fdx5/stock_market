/** A neuron: a cell body with dendrites reaching out to three terminals. Drawn rather
 * than lettered so it reads at 16px next to the other nav icons, which are all glyphs
 * of the thing they open. */
export default function MonitorIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 8.9V4.6M14.6 10.2l3.3-2.6M14.9 13.6l3.6 1.9M9.4 13.9l-3.1 2.6M9.2 10.4 5.6 8.8" />
      <circle cx="12" cy="3.4" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="18.9" cy="6.9" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="19.5" cy="16.1" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="5.4" cy="17.3" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="4.7" cy="8.1" r="1.35" fill="currentColor" stroke="none" />
    </svg>
  );
}
