import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useFxLevel } from "./settings";
import NeoIcon from "./NeoIcon";
import "./communityMagic.css";

const CITY = "/img/community/neon-city-entry-v1.webp";
const DISTRICTS = { kr: ["SEOUL", "01", "시장의 새로운 이야기가 시작됩니다"], global: ["GLOBAL", "02", "세계의 시장과 당신을 연결합니다"], property: ["PROPERTY", "03", "도시의 내일을 함께 이야기합니다"] };

/** Atmosphere at the display's native pixel ratio. No video or WebGL download. */
function CityAtmosphere() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current, context = element?.getContext("2d");
    if (!element || !context) return;
    let frame = 0, width = 0, height = 0, last = 0;
    const drops = Array.from({ length: 110 }, (_, i) => ({ x: (i * .618034) % 1, y: (i * .381966) % 1, z: .3 + (i % 7) / 8 }));
    const resize = () => {
      width = element.clientWidth; height = element.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      element.width = Math.round(width * dpr); element.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    const draw = (time: number) => {
      const dt = last ? Math.min((time - last) / 1000, .05) : 0; last = time;
      context.clearRect(0, 0, width, height);
      for (const drop of drops) {
        drop.y += dt * (.25 + drop.z * .45);
        if (drop.y > 1.1) drop.y = -.1;
        const x = drop.x * (width + 180) - drop.y * 80;
        context.strokeStyle = `rgba(150,222,255,${drop.z * .19})`; context.lineWidth = .5 + drop.z * .5;
        context.beginPath(); context.moveTo(x, drop.y * height); context.lineTo(x - 3 * drop.z, drop.y * height + 24 * drop.z); context.stroke();
      }
      for (let i = 0; i < 7; i++) {
        const progress = (time / (5400 + i * 1000) + i * .17) % 1, travel = progress * progress, direction = i % 2 ? -1 : 1;
        const x = width * .51 + direction * travel * width * .68, y = height * (.40 + i * .027) + travel * height * .12;
        const trail = direction * (9 + travel * 65), gradient = context.createLinearGradient(x - trail, y - travel * 4, x, y);
        gradient.addColorStop(0, "transparent"); gradient.addColorStop(1, i % 2 ? "#88efff" : "#edacff");
        context.strokeStyle = gradient; context.lineWidth = .7 + travel * 1.8;
        context.beginPath(); context.moveTo(x - trail, y - travel * 4); context.lineTo(x, y); context.stroke();
        context.fillStyle = "#e4fbff"; context.fillRect(x, y, 1 + travel * 3, 1 + travel);
      }
      frame = requestAnimationFrame(draw);
    };
    const visibility = () => { cancelAnimationFrame(frame); last = 0; if (!document.hidden) frame = requestAnimationFrame(draw); };
    document.addEventListener("visibilitychange", visibility); visibility();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener("visibilitychange", visibility); element.width = 0; element.height = 0; };
  }, []);
  return <canvas ref={canvas} className="cf-city-atmosphere" aria-hidden="true" />;
}

/** Bounded cinematic entry; feed requests continue independently behind the modal. */
export default function CommunityMagicEntry({ title, board, pageRef }: { title: string; board: "kr" | "global" | "property"; pageRef: RefObject<HTMLElement> }) {
  const fx = useFxLevel();
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [done, setDone] = useState(fx === "minimal" || reduced), [leaving, setLeaving] = useState(false), [loaded, setLoaded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId();
  const [district, number, description] = DISTRICTS[board];
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)"), change = () => setReduced(media.matches);
    media.addEventListener("change", change); return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (done) return;
    if (reduced || fx === "minimal") { setDone(true); return; }
    const element = dialog.current, page = pageRef.current, overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    if (page) page.dataset.magicPhase = "gather";
    element?.showModal();
    let started = false, disposed = false;
    const timers: number[] = [];
    const start = () => {
      if (disposed || started) return;
      started = true;
      timers.push(window.setTimeout(() => { if (page) page.dataset.magicPhase = "reveal"; setLeaving(true); }, 2500));
      timers.push(window.setTimeout(() => setDone(true), 3150));
    };
    const image = new Image();
    image.onload = () => { if (!disposed) setLoaded(true); start(); };
    image.onerror = start; image.src = CITY;
    timers.push(window.setTimeout(start, 650));
    return () => {
      disposed = true; image.onload = null; image.onerror = null; timers.forEach(clearTimeout); element?.close();
      document.documentElement.style.overflow = overflow;
      if (page) page.dataset.magicPhase = "ready";
    };
  }, [done, reduced, fx, pageRef]);
  if (done || reduced || fx === "minimal") return null;
  return createPortal(<dialog ref={dialog} className={`cf-city-entry${loaded ? " is-loaded" : ""}${leaving ? " is-leaving" : ""}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); setDone(true); }}>
    <div className="cf-city-scene" aria-hidden="true">
      <div className="cf-city-fallback"><svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice"><g fill="#081b30" stroke="#207f9670">{Array.from({ length: 32 }, (_, i) => { const x = i * 53 - 30, h = 150 + (i * 97) % 460; return <g key={i}><path d={`M${x} 800V${800-h}h12v-25h16v25h20v${h}Z`} /><path d={`M${x+8} ${810-h}v${h-30}m12 ${-h+25}v${h-20}m12 ${-h+25}v${h-30}`} stroke={i % 3 ? "#5bd9ff55" : "#dc58ff77"} strokeDasharray="2 12" /></g>; })}</g></svg></div>
      <div className="cf-city-panorama" /><div className="cf-city-haze" /><div className="cf-city-beacon" /><div className="cf-city-beacon is-violet" />
      <CityAtmosphere /><div className="cf-city-shade" /><div className="cf-city-grain" />
    </div>
    <header className="cf-city-top"><span><i /> KOSPIMAP <b>COMMUNITY</b></span><span className="cf-city-coordinate">NEON DISTRICT / {number}</span></header>
    <div className="cf-city-reticle" aria-hidden="true"><i /><span>CONNECTED PERSPECTIVES</span><svg viewBox="0 0 100 100" fill="none"><path d="M15 32V15h17m36 0h17v17m0 36v17H68m-36 0H15V68" stroke="currentColor" /><circle cx="50" cy="50" r="27" stroke="currentColor" strokeDasharray="1 6" /><path d="M44 50h12m-6-6v12" stroke="currentColor" /></svg></div>
    <section className="cf-city-copy">
      <div className="cf-city-eyebrow"><span>THE CITY NEVER STOPS.</span><span>{district} / {number}</span></div>
      <h2 id={titleId}>{title}<span>커뮤니티<span className="cf-city-period">.</span></span></h2><p>{description}</p>
      <div className="cf-city-bottom"><div className="cf-city-status" role="status"><NeoIcon name={board === "kr" ? "chart" : board === "global" ? "globe" : "home"} /><span>새로운 관점으로 진입 중…</span><span className="cf-city-bars" aria-hidden="true"><i /><i /><i /><i /><i /></span></div><button type="button" className="cf-city-skip" onClick={() => setDone(true)}>바로 보기 <span aria-hidden="true">↗</span></button></div>
      <div className="cf-city-progress" aria-hidden="true"><i /></div>
    </section>
    <footer className="cf-city-footer" aria-hidden="true"><span>ONE CITY. A MILLION PERSPECTIVES.</span><span>국내 · 해외 · 부동산</span></footer>
  </dialog>, document.body);
}
