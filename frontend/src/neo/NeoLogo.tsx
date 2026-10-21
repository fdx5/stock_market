import { useId } from "react";

/** Original vector identity: a split K, ascending signal and an open hub frame. */
export default function NeoLogo({ className = "", symbolOnly = false }: { className?: string; symbolOnly?: boolean }) {
  const id = useId().replace(/:/g, "");
  return <svg className={className} viewBox={symbolOnly ? "0 0 48 48" : "0 0 252 48"} fill="none" role="img" aria-label="K Stock Hub">
    <defs><linearGradient id={`${id}-brand`} x1="5" y1="5" x2="44" y2="44" gradientUnits="userSpaceOnUse"><stop stopColor="#bf85ff" /><stop offset="1" stopColor="#d6b54e" /></linearGradient></defs>
    <path d="M31 5H13L5 13v22l8 8h22l8-8V17" stroke={`url(#${id}-brand)`} strokeWidth="1.5" />
    <path d="M14 34V14h5v8l10-8h7L24 24l13 10h-8l-10-8v8h-5Z" fill={`url(#${id}-brand)`} />
    <path d="m28 9 7-5 7 5" stroke="#f27560" strokeWidth="1.6" /><path d="M35 4v13" stroke="#f27560" strokeWidth="1.6" />
    <path d="M2 24h3m38 0h3M24 43v3" stroke="#bf85ff" strokeWidth="1" />
    {!symbolOnly && <><text x="61" y="26" fill="#f3ecdc" fontFamily="Pretendard,Arial,sans-serif" fontSize="23" fontWeight="750" letterSpacing="-.7">K STOCK <tspan fill="#d6b54e">HUB</tspan></text><text x="62" y="40" fill="#b9aabf" fontFamily="ui-monospace,Consolas,monospace" fontSize="7" letterSpacing="2.6">NEO GENESIS / KOSPIMAP</text></>}
  </svg>;
}
