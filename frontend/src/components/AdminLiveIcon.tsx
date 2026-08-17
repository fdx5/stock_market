/** A live waveform/pulse trace — the entry point to the log page reads at a glance as
 * "something is streaming here", the same way MonitorIcon reads as the neuron view. */
export default function AdminLiveIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 13h3.4l1.8-5.5 3 11 2.4-14.5 2.2 9 1.6-4.4H22" />
    </svg>
  );
}
