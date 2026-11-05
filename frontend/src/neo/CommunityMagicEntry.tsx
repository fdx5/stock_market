import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useFxLevel } from "./settings";
import NeoIcon from "./NeoIcon";
import "./communityMagic.css";

const stars = Array.from({ length: 54 }, (_, i) => ({
  "--star-x": `${(i * 37.13 + 5) % 100}%`,
  "--star-delay": `${-(i % 13) * .23}s`,
  "--star-duration": `${2.1 + (i % 7) * .19}s`,
  "--star-drift": `${-65 + (i % 9) * 17}px`,
  "--star-size": `${i % 6 === 0 ? 6 : i % 3 === 0 ? 3 : 2}px`,
}) as CSSProperties);

/** A bounded entry animation. Requests continue behind it; it never gates collection. */
export default function CommunityMagicEntry({ title, board }: { title: string; board: "kr" | "global" | "property" }) {
  const fx = useFxLevel();
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [done, setDone] = useState(fx === "minimal" || reduced);
  const [leaving, setLeaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    if (done) return;
    if (reduced || fx === "minimal") { setDone(true); return; }
    const element = dialog.current;
    element?.showModal();
    const reveal = window.setTimeout(() => setLeaving(true), 2650);
    const finish = window.setTimeout(() => setDone(true), 3000);
    return () => {
      clearTimeout(reveal); clearTimeout(finish);
      element?.close();
    };
  }, [done, reduced, fx]);

  if (done || reduced || fx === "minimal") return null;
  return createPortal(<dialog ref={dialog} className={`cf-spell-entry${leaving ? " is-leaving" : ""}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); setDone(true); }} onKeyDown={event => { if (event.key === "Tab") { event.preventDefault(); dialog.current?.querySelector<HTMLButtonElement>("button")?.focus(); } }}>
    <div className="cf-spell-nebula" aria-hidden="true" />
    <div className="cf-spell-stars" aria-hidden="true">{stars.map((style, i) => <i key={i} style={style} className={i % 6 === 0 ? "is-star" : ""} />)}</div>
    <div className="cf-spell-stage">
      <div className="cf-spell-art" aria-hidden="true">
        <div className="cf-spell-halo" /><div className="cf-spell-ray" />
        <div className="cf-spell-orbit"><span>✦</span><span>◇</span><span>✧</span><span>◇</span></div>
        <svg className="cf-spell-book" viewBox="0 0 480 310" fill="none">
          <defs>
            <linearGradient id={`${titleId}-leaf`} x1="85" y1="80" x2="350" y2="290" gradientUnits="userSpaceOnUse"><stop stopColor="#34213f" /><stop offset=".5" stopColor="#1b1225" /><stop offset="1" stopColor="#2c1936" /></linearGradient>
            <linearGradient id={`${titleId}-gold`} x1="70" y1="100" x2="400" y2="250" gradientUnits="userSpaceOnUse"><stop stopColor="#b89159" /><stop offset=".45" stopColor="#ffe7b4" /><stop offset="1" stopColor="#bd925c" /></linearGradient>
          </defs>
          <ellipse cx="240" cy="273" rx="155" ry="18" fill="#bf85ff" opacity=".08" />
          <g className="cf-spell-leaf is-left">
            <path d="M240 125Q174 81 66 99L49 249Q163 225 240 268Z" fill="#130e1c" stroke={`url(#${titleId}-gold)`} strokeWidth="1.2" />
            <path d="M240 119Q176 78 76 92L63 238Q171 220 240 257Z" fill={`url(#${titleId}-leaf)`} stroke={`url(#${titleId}-gold)`} strokeWidth="1.1" />
            <path d="M82 106Q164 99 223 128M77 226Q158 217 222 245" stroke="#b99462" strokeOpacity=".35" />
            <path className="cf-spell-ink" d="M102 154L125 137L147 155L174 127L199 143M97 181L202 196M95 193L186 207M94 205L162 214" stroke="#e6c38c" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            <g fill="#ffe7b4"><circle cx="102" cy="154" r="2.7" /><circle cx="147" cy="155" r="2.3" /><circle cx="174" cy="127" r="3" /><circle cx="199" cy="143" r="2" /></g>
            <path d="M87 117L87 127M82 122H92M190 222V232M185 227H195" stroke="#f0ce98" strokeWidth="1.1" />
          </g>
          <g className="cf-spell-leaf is-right">
            <path d="M240 125Q306 81 414 99L431 249Q317 225 240 268Z" fill="#130e1c" stroke={`url(#${titleId}-gold)`} strokeWidth="1.2" />
            <path d="M240 119Q304 78 404 92L417 238Q309 220 240 257Z" fill={`url(#${titleId}-leaf)`} stroke={`url(#${titleId}-gold)`} strokeWidth="1.1" />
            <path d="M398 106Q316 99 257 128M403 226Q322 217 258 245" stroke="#b99462" strokeOpacity=".35" />
            <path className="cf-spell-ink" d="M280 147L311 126L341 159L374 138L387 176L350 193L341 159L307 183L280 147M286 215L366 204M285 226L346 217" stroke="#cfb0fb" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            <g fill="#e8d4ff"><circle cx="280" cy="147" r="2.5" /><circle cx="311" cy="126" r="2.7" /><circle cx="341" cy="159" r="3.5" /><circle cx="374" cy="138" r="2.4" /><circle cx="350" cy="193" r="2" /><circle cx="307" cy="183" r="2.5" /></g>
            <path d="M388 198V210M382 204H394M365 115V123M361 119H369" stroke="#f0ce98" strokeWidth="1.1" />
          </g>
          <path className="cf-spell-spine" d="M240 119V260" stroke={`url(#${titleId}-gold)`} strokeWidth="2" />
          <path d="M234 263L240 280L246 263" stroke="#d4b17b" strokeWidth="1.2" />
        </svg>
        <div className="cf-spell-seal"><span /><NeoIcon name={board === "kr" ? "chart" : board === "global" ? "globe" : "home"} /><b>✦</b></div>
        <div className="cf-spell-sparks">{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ "--spark-angle": `${i * 30}deg`, "--spark-delay": `${i % 4 * .12}s` } as CSSProperties} />)}</div>
      </div>
      <div className="cf-spell-copy"><span className="cf-spell-kicker">THE STARLIGHT ARCHIVE</span><h2 id={titleId}>이야기의 문을 여는 중</h2><p role="status">{title} 커뮤니티</p><div className="cf-spell-progress" aria-hidden="true"><i /></div></div>
      <button className="cf-spell-skip" type="button" onClick={() => setDone(true)}>바로 보기 <span aria-hidden="true">↗</span></button>
    </div>
  </dialog>, document.body);
}
