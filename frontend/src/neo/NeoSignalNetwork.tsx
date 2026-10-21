import { useId } from "react";

/** Decorative market connection motif. No paths or movement encode prices. */
export default function NeoSignalNetwork() {
  const id = useId().replace(/:/g, "");
  return <div className="ng-signal-network" aria-hidden="true">
    <svg viewBox="0 0 420 154" fill="none">
      <defs><pattern id={`${id}-grid`} width="14" height="14" patternUnits="userSpaceOnUse"><path d="M14 0H0V14" stroke="#bf85ff" strokeOpacity=".11" /></pattern><linearGradient id={`${id}-link`} x1="100" y1="0" x2="320" y2="0" gradientUnits="userSpaceOnUse"><stop stopColor="#d6b54e" /><stop offset=".5" stopColor="#bf85ff" /><stop offset="1" stopColor="#f27560" /></linearGradient></defs>
      <path d="M0 0H420V154H0z" fill={`url(#${id}-grid)`} />
      <g className="ng-signal-orbits"><ellipse cx="210" cy="77" rx="190" ry="50" stroke="#bf85ff" strokeOpacity=".24" /><ellipse cx="210" cy="77" rx="160" ry="68" stroke="#bf85ff" strokeOpacity=".16" strokeDasharray="2 7" /></g>
      <path d="M0 77h28m364 0h28M210 0v16m0 122v16" stroke="#bf85ff" strokeOpacity=".6" />
      <path d="M93 77h61l24-25h64l24 25h61M93 77h61l24 25h64l24-25h61" stroke={`url(#${id}-link)`} strokeOpacity=".27" />
      <path className="ng-signal-flow ng-signal-flow-a" d="M93 77h61l24-25h64l24 25h61" stroke={`url(#${id}-link)`} strokeWidth="2" strokeDasharray="14 225" />
      <path className="ng-signal-flow ng-signal-flow-b" d="M327 77h-61l-24 25h-64l-24-25H93" stroke={`url(#${id}-link)`} strokeWidth="2" strokeDasharray="9 230" />
      {[{ x: 90, color: "#d6b54e", label: "SEOUL", code: "KR" }, { x: 330, color: "#f27560", label: "NEW YORK", code: "US" }].map(node => <g key={node.code}>
        <circle className="ng-signal-ping" cx={node.x} cy="77" r="24" stroke={node.color} strokeOpacity=".35" />
        <g className="ng-signal-rotor" style={{ transformOrigin: `${node.x}px 77px` }}><path d={`M${node.x - 30} 65V47h18m24 0h18v18m0 24v18h-18m-24 0h-18V89`} stroke={node.color} strokeOpacity=".7" /></g>
        <path d={`M${node.x} 55l22 22-22 22-22-22Z`} fill="#1b1322" stroke={node.color} />
        <text x={node.x} y="81" textAnchor="middle" fill={node.color} fontSize="11" fontWeight="600">{node.code}</text>
        <text x={node.x} y="134" textAnchor="middle" fill="#c3b5c5" fontSize="8" letterSpacing="2">{node.label}</text>
      </g>)}
      <path className="ng-signal-core" d="m210 63 14 14-14 14-14-14Z" fill="#bf85ff" fillOpacity=".17" stroke="#bf85ff" />
      <path d="M206 77h8m-4-4v8" stroke="#f3ecdc" />
      <text x="210" y="23" textAnchor="middle" fill="#bf85ff" fontSize="7" letterSpacing="2.5">CROSS-MARKET SIGNAL</text>
    </svg>
    <div className="ng-signal-scan" />
  </div>;
}
