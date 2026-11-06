import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useFxLevel } from "./settings";
import NeoIcon from "./NeoIcon";
import "./communityMagic.css";

const CITY = "/img/community/neon-city-entry-v1.webp";
const DISTRICTS = { kr: ["SEOUL", "01", "시장의 새로운 이야기가 시작됩니다"], global: ["GLOBAL", "02", "세계의 시장과 당신을 연결합니다"], property: ["PROPERTY", "03", "도시의 내일을 함께 이야기합니다"] };

/** Atmosphere at the display's native pixel ratio. No video or WebGL download. */
function CityAtmosphere({ accelerating }: { accelerating: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const speed = useRef(1);
  useEffect(() => { speed.current = accelerating ? 4 : 1; }, [accelerating]);
  useEffect(() => {
    const element = canvas.current, context = element?.getContext("2d");
    if (!element || !context) return;
    let frame = 0, width = 0, height = 0, last = 0, centerX = .64, centerY = .39;
    const drops = Array.from({ length: 110 }, (_, i) => ({ x: (i * .618034) % 1, y: (i * .381966) % 1, z: .3 + (i % 7) / 8 }));
    const flight = Array.from({ length: 64 }, (_, i) => ({ angle: i * 2.399963, depth: .12 + ((i * .618034) % 1) * .88 }));
    const resize = () => {
      width = element.clientWidth; height = element.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      const style = getComputedStyle(element.closest("dialog") ?? element);
      centerX = parseFloat(style.getPropertyValue("--city-gate-x")) / 100 || .64;
      centerY = parseFloat(style.getPropertyValue("--city-gate-y")) / 100 || .39;
      element.width = Math.round(width * dpr); element.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    const draw = (time: number) => {
      const dt = last ? Math.min((time - last) / 1000, .05) : 0; last = time;
      context.clearRect(0, 0, width, height);
      const horizonX = width * centerX, horizonY = height * centerY, reach = Math.max(width, height) * .22;
      // Perspective trails travel towards the viewer instead of sliding over a flat image.
      for (let i = 0; i < flight.length; i++) {
        const particle = flight[i];
        particle.depth -= dt * .23 * speed.current;
        if (particle.depth < .1) particle.depth = 1;
        const radius = (1 / particle.depth - 1) * reach;
        const tail = (1 / Math.min(1, particle.depth + .012 * speed.current) - 1) * reach;
        const x = Math.cos(particle.angle), y = Math.sin(particle.angle) * .66;
        context.strokeStyle = i % 3 ? `rgba(111,229,255,${(.08 + (1 - particle.depth) * .22) * Math.min(speed.current, 2)})` : `rgba(218,144,255,${.08 + (1 - particle.depth) * .24})`;
        context.lineWidth = .5 + (1 - particle.depth) * 1.2;
        context.beginPath(); context.moveTo(horizonX + x * tail, horizonY + y * tail); context.lineTo(horizonX + x * radius, horizonY + y * radius); context.stroke();
      }
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
      timers.push(window.setTimeout(() => { if (page) page.dataset.magicPhase = "reveal"; setLeaving(true); }, 2800));
      timers.push(window.setTimeout(() => setDone(true), 3650));
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
      <CityAtmosphere accelerating={leaving} /><div className="cf-city-shade" /><div className="cf-city-grain" />
    </div>
    <div className="cf-city-energy" aria-hidden="true" />
    <div className="cf-city-gate" aria-hidden="true">
      <div className="cf-city-gate-aura" />
      <svg viewBox="0 0 600 600" fill="none">
        <g className="cf-city-gate-outer"><circle cx="300" cy="300" r="274" stroke="#7ceaff" strokeOpacity=".18" strokeWidth="1" /><circle cx="300" cy="300" r="267" stroke="#8ff5ff" strokeWidth="3" strokeDasharray="65 355" /><circle cx="300" cy="300" r="257" stroke="#cd9dff" strokeOpacity=".6" strokeDasharray="1 11" strokeWidth="3" />{Array.from({ length: 48 }, (_, i) => <path key={i} d={i % 4 ? "M300 16v7" : "M300 10v18"} transform={`rotate(${i * 7.5} 300 300)`} stroke={i % 4 ? "#9eeeff66" : "#d5faff"} strokeWidth={i % 4 ? 1 : 2} />)}</g>
        <g className="cf-city-gate-frame"><path d="M300 61L507 180V420L300 539L93 420V180Z" stroke="#56e7ff" strokeOpacity=".1" strokeWidth="14" /><path d="M300 61L507 180V420L300 539L93 420V180Z" stroke="#9aeeff" strokeOpacity=".65" strokeWidth="1.4" /><path d="M300 82L489 191V409L300 518L111 409V191Z" stroke="#ad8dff" strokeOpacity=".35" strokeWidth="1" /><path d="M300 61L357 94M507 180V248M507 420L449 453M300 539L243 506M93 420V352M93 180L151 147" stroke="#b8f7ff" strokeWidth="3" /><path d="M300 82L347 109M489 191V245M489 409L442 436M300 518L253 491M111 409V355M111 191L158 164" stroke="#c59bff" strokeWidth="2" /></g>
        <g className="cf-city-gate-inner"><circle cx="300" cy="300" r="208" stroke="#a6f1ff" strokeOpacity=".13" /><path d="M116 300A184 184 0 0 1 300 116M484 300A184 184 0 0 1 300 484" stroke="#77eaff" strokeOpacity=".6" strokeWidth="2" /><circle cx="300" cy="300" r="173" stroke="#d5b4ff" strokeOpacity=".22" strokeDasharray="22 14 2 14" /></g>
        <path d="M270 300h18m24 0h18m-30-30v18m0 24v18" stroke="#c2f8ff" strokeOpacity=".5" />
      </svg>
      <div className="cf-city-gate-label"><span>NEON DISTRICT</span><strong>{number}</strong><span>{district} / GATEWAY</span></div>
      <span className="cf-city-gate-tag is-left">CONNECTED<br />PERSPECTIVES</span><span className="cf-city-gate-tag is-right">THE NEXT<br />CONNECTION</span>
    </div>
    <div className="cf-city-speed-frame" aria-hidden="true"><i /><i /><i /><i /></div>
    <header className="cf-city-top"><span><i /> KOSPIMAP <b>COMMUNITY</b></span><span className="cf-city-coordinate">NEON DISTRICT / {number}</span></header>
    <section className="cf-city-copy">
      <div className="cf-city-eyebrow"><span>ENTER A NEW PERSPECTIVE.</span><span>{district} / {number}</span></div>
      <h2 id={titleId}>{title}<span>커뮤니티<span className="cf-city-period">.</span></span></h2><p>{description}</p>
      <div className="cf-city-bottom"><div className="cf-city-status" role="status"><NeoIcon name={board === "kr" ? "chart" : board === "global" ? "globe" : "home"} /><span>새로운 관점으로 진입 중…</span><span className="cf-city-bars" aria-hidden="true"><i /><i /><i /><i /><i /></span></div><button type="button" className="cf-city-skip" onClick={() => setDone(true)}>바로 보기 <span aria-hidden="true">↗</span></button></div>
      <div className="cf-city-progress" aria-hidden="true"><i /></div>
    </section>
    <footer className="cf-city-footer" aria-hidden="true"><span>ONE CITY. A MILLION PERSPECTIVES.</span><span>국내 · 해외 · 부동산</span></footer>
  </dialog>, document.body);
}
