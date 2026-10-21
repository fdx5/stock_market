const DISCHARGES = [
  { core: "M0 9H17L25 8L31 11L39 4L44 13L51 7L57 10L65 9H84", forks: "M39 4L44 2L48 4M51 7L55 3L60 4M57 10L63 15L68 14" },
  { core: "M0 9H20L30 10L37 7L43 11L49 3L54 12L61 8L68 9H84", forks: "M37 7L34 3L29 4M49 3L55 2M54 12L58 16L63 15" },
  { core: "M0 9H14L26 8L34 10L42 6L49 12L57 5L63 10L70 9H84", forks: "M42 6L45 2L50 3M49 12L46 15L42 14M57 5L63 3L67 5" },
] as const;

/** A single decorative electrical filament on the header's existing lower rule. */
export default function NeoHeaderCurrent() {
  return <span className="ng-header-current" aria-hidden="true"><i>
    <svg className="ng-current-discharge" viewBox="0 0 84 19" focusable="false">
      <defs>
        <linearGradient id="ng-current-filament" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#e4b738" stopOpacity="0" />
          <stop offset=".3" stopColor="#f5d767" stopOpacity=".7" />
          <stop offset=".65" stopColor="#fff9d9" />
          <stop offset=".84" stopColor="#fff1a3" />
          <stop offset="1" stopColor="#ffd35b" stopOpacity="0" />
        </linearGradient>
      </defs>
      {DISCHARGES.map((arc, index) => <g key={arc.core} className={`ng-current-arc ng-current-arc-${index}`}>
        <path className="ng-current-forks" d={arc.forks} />
        <path className="ng-current-filament" d={arc.core} />
      </g>)}
      <circle className="ng-current-mote ng-current-mote-a" cx="64" cy="3.5" r=".65" />
      <circle className="ng-current-mote ng-current-mote-b" cx="71" cy="14.5" r=".55" />
    </svg>
  </i></span>;
}
