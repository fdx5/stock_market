import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useL } from "./lib";
import {
  DeskTrack,
  attachDeskBgm,
  getDeskBgmTime,
  next,
  prev,
  setDeskBgmOn,
  toggleDeskBgmPlay,
  useDeskBgm,
  warmDeskBgm,
} from "./deskBgmStore";
import "./deskBgm.css";
import { useDesignMode, useFxLevel } from "../neo/settings";

/* The masthead's NOW PLAYING ear: an equaliser with the transport under it, the
   track's name and channel beside, and the power switch in the corner.

   The equaliser is not an analysis of the sound. The audio plays inside YouTube's
   cross-origin frame, which nothing on the page can listen to, and the tracks are
   other people's uploads that are not ours to download and measure. So it is a
   meter DRIVEN BY the music rather than MEASURING it: each track carries a tempo
   and a shape (bass, brightness, energy), the bars move on the player's own clock
   — a kick on every beat at that track's bpm, the hats between, slow swells over
   the bars — and they fall when it pauses, buffers or stops. Deterministic in the
   playback time, so a moment of a song always looks the same. */

const BARS = 12;
const REST = 0.05;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}
/** Smooth 1-D value noise in 0..1. */
function noise(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const r = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  const u = f * f * (3 - 2 * f);
  return r(i) * (1 - u) + r(i + 1) * u;
}

/** Bar `i`'s level at `t` seconds into `track`. */
function level(track: DeskTrack, seed: number, t: number, i: number): number {
  const f = i / (BARS - 1);
  const beat = (t * track.bpm) / 60;
  const kick = Math.exp(-(beat % 1) * 7);
  const hat = Math.exp(-((beat + 0.5) % 1) * 12);
  const section = 0.7 + 0.3 * noise(t / 9 + seed * 50);
  const body = (1 - 0.45 * f) * (0.35 + 0.65 * track.energy) * (0.3 + 0.7 * noise(t * 1.7 + i * 2.3 + seed * 90));
  const v =
    0.06 +
    body * section +
    track.bass * kick * Math.pow(1 - f, 2) * 0.6 +
    track.bright * hat * Math.pow(f, 1.3) * 0.5 +
    0.08 * noise(t * 6 + i * 5.1);
  return Math.min(1, Math.max(REST, v));
}

/** The shape the meter rests in while the music is off: a quiet silhouette, so the
 * ear reads as an equaliser before it has ever moved. */
const IDLE = Array.from({ length: BARS }, (_, i) => 0.22 + 0.4 * Math.sin((i / (BARS - 1)) * Math.PI * 0.9 + 0.25) * (i % 3 === 1 ? 0.72 : 1));

function useMeter(eqRef: React.RefObject<HTMLDivElement>, track: DeskTrack, running: boolean, on: boolean, still: boolean) {
  const trackRef = useRef(track);
  trackRef.current = track;
  useEffect(() => {
    const el = eqRef.current;
    if (!el) return;
    const bars = Array.from(el.querySelectorAll(":scope > i")) as HTMLElement[];
    const levels = bars.map((_, i) => (on ? REST : IDLE[i]));
    const peaks = [...levels];
    const holds = levels.map(() => 0);
    const meter = canvasMeter(el, bars, on);
    const paint = () => meter.draw(levels, peaks);
    if (still || (!running && !on)) {
      IDLE.forEach((v, i) => { levels[i] = v; peaks[i] = v; });
      paint();
      return meter.dispose;
    }
    let raf = 0;
    let last = performance.now();
    let clock = getDeskBgmTime() ?? 0;
    let synced = 0;
    const seed = hash(trackRef.current.id);
    const frame = (now: number) => {
      // (near 60 a second on a fast display, as the 3D view under it draws; 30 while a phone's drone
      // flies — data-drone-flight, see drone-explore.css — its every redraw a repaint of the page)
      if (now - last < (document.documentElement.hasAttribute("data-drone-flight") ? 28 : 12)) { raf = requestAnimationFrame(frame); return; }
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // The player reports its position coarsely; run a local clock and pull it
      // back only when the two drift apart, so the beat stays even.
      if (running) {
        clock += dt;
        if (now - synced > 500) {
          synced = now;
          const t = getDeskBgmTime();
          if (t !== null && Math.abs(t - clock) > 0.35) clock = t;
        }
      }
      let settled = true;
      for (let i = 0; i < bars.length; i++) {
        const target = running ? level(trackRef.current, seed, clock, i) : REST;
        const k = 1 - Math.exp(-dt * (target > levels[i] ? 30 : 8));
        levels[i] += (target - levels[i]) * k;
        if (levels[i] >= peaks[i]) { peaks[i] = levels[i]; holds[i] = 0.35; }
        else if ((holds[i] -= dt) < 0) peaks[i] = Math.max(levels[i], peaks[i] - dt * 0.9);
        if (levels[i] > REST + 0.01 || peaks[i] > REST + 0.01) settled = false;
      }
      paint();
      if (running || !settled) raf = requestAnimationFrame(frame);
    };
    const restart = () => {
      cancelAnimationFrame(raf);
      if (document.hidden) return;
      last = performance.now();
      clock = getDeskBgmTime() ?? clock;
      synced = last;
      raf = requestAnimationFrame(frame);
    };
    document.addEventListener("visibilitychange", restart);
    window.addEventListener("pageshow", restart);
    restart();
    return () => {
      cancelAnimationFrame(raf);
      meter.dispose();
      document.removeEventListener("visibilitychange", restart);
      window.removeEventListener("pageshow", restart);
    };
  }, [eqRef, running, on, track.id, still]);
}

/* The meter drawn on one canvas over the bars. Set as style on the bars (a level and a peak
   for each of 12, every frame), each change restyled elements matched against the whole
   site's style sheet: a few milliseconds a frame on a phone, paid all through a 3D flight with
   the music on. The canvas copies what the style sheet gives the bars — the gradient each
   resolves to, the 2 px segments, the peak cap and its glow, the dimmed look while off and
   the fades between (deskBgm.css) — and the bars stay in place, unseen, for the layout. */
const GLOW = 6;
const OFF = { opacity: 0.5, gray: 0.85 };
type Stop = [number, number[]];
type Fade = { from: number; to: number; at: number; ms: number };
interface MeterState {
  canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
  /** the look's fades: 0 off … 1 on, each eased from `from` at `at` (ms) */
  fade: { opacity: Fade; gray: Fade; cap: Fade };
  levels: number[]; peaks: number[];
}
const meters = new WeakMap<HTMLElement, MeterState>();
/** CSS `ease`, cubic-bezier(.25, .1, .25, 1), at x in 0…1. */
function ease(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bez = (t: number, a: number, b: number) => 3 * t * (1 - t) * (1 - t) * a + 3 * t * t * (1 - t) * b + t * t * t;
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 20; i++) { t = (lo + hi) / 2; if (bez(t, 0.25, 0.25) < x) lo = t; else hi = t; }
  return bez(t, 0.1, 1);
}
function rgbOf(s: string): number[] {
  const m = s.match(/rgba?\(([^)]*)\)/);
  if (!m) return [0, 0, 0, 1];
  const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return [v[0], v[1], v[2], v[3] ?? 1];
}
/** CSS grayscale(a) on an sRGB colour. */
function grayed([r, g, b, al]: number[], a: number): string {
  const k = 1 - a;
  const R = (0.2126 + 0.7874 * k) * r + (0.7152 - 0.7152 * k) * g + (0.0722 - 0.0722 * k) * b;
  const G = (0.2126 - 0.2126 * k) * r + (0.7152 + 0.2848 * k) * g + (0.0722 - 0.0722 * k) * b;
  const B = (0.2126 - 0.2126 * k) * r + (0.7152 - 0.7152 * k) * g + (0.0722 + 0.9278 * k) * b;
  return `rgba(${R.toFixed(1)},${G.toFixed(1)},${B.toFixed(1)},${al})`;
}
function canvasMeter(eq: HTMLElement, bars: HTMLElement[], on: boolean) {
  let st = meters.get(eq);
  const now = performance.now();
  const lit = on ? 1 : 0;
  if (!st) {
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = `position:absolute;left:${-GLOW}px;top:${-GLOW}px;width:calc(100% + ${2 * GLOW}px);height:calc(100% + ${2 * GLOW}px);pointer-events:none`;
    if (getComputedStyle(eq).position === "static") eq.style.position = "relative";
    eq.appendChild(canvas);
    for (const bar of bars) for (const part of Array.from(bar.children) as HTMLElement[]) part.style.visibility = "hidden";
    st = { canvas, ctx: canvas.getContext("2d")!, levels: [], peaks: [],
      fade: { opacity: { from: lit, to: lit, at: 0, ms: 300 }, gray: { from: lit, to: lit, at: 0, ms: 400 }, cap: { from: lit, to: lit, at: 0, ms: 300 } } };
    meters.set(eq, st);
  } else {
    for (const f of Object.values(st.fade)) {
      if (f.to === lit) continue;
      f.from = f.from + (f.to - f.from) * ease((now - f.at) / f.ms); f.to = lit; f.at = now;
    }
  }
  const s = st;
  const { canvas, ctx } = s;
  // What the style sheet resolves for each bar (gradient stops, cap colour and glow) and where
  // the grid puts it: read when the box or the theme changes, never per frame.
  let geo: { x: number; y: number; w: number; h: number; stops: Stop[]; cap: string; glow: string; blur: number }[] = [];
  let dpr = 1, pad = 0;
  let caps: HTMLCanvasElement[][] = [];
  const grads = new Map<string, CanvasGradient>();
  let fadeRaf = 0;
  const value = (f: Fade, t: number) => f.from + (f.to - f.from) * ease((t - f.at) / f.ms);
  function draw(levels: number[], peaks: number[]) {
    s.levels = levels; s.peaks = peaks;
    if (!geo.length || !levels.length) return;
    const t = performance.now();
    const alpha = OFF.opacity + (1 - OFF.opacity) * value(s.fade.opacity, t);
    const g = OFF.gray * (1 - value(s.fade.gray, t));
    const capAlpha = 0.95 * value(s.fade.cap, t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.shadowBlur = 0; ctx.shadowColor = "transparent";
    const gk = g.toFixed(3);
    geo.forEach((b, i) => {
      const key = i + "|" + gk;
      let grad = grads.get(key);
      if (!grad) {
        grad = ctx.createLinearGradient(0, b.y + b.h, 0, b.y);
        for (const [at, c] of b.stops) grad.addColorStop(at, grayed(c, g));
        if (grads.size > 400) grads.clear();
        grads.set(key, grad);
      }
      ctx.fillStyle = grad;
      // the fill uncovered from the bottom (clip-path), in segments 2 px on, 1 px off (mask)
      const top = b.y + (1 - levels[i]) * b.h, bottom = b.y + b.h;
      for (let y = bottom; y > top; y -= 3) { const y0 = Math.max(top, y - 2); ctx.fillRect(b.x, y0, b.w, y - y0); }
    });
    if (capAlpha > 0.001) {
      ctx.globalAlpha = capAlpha;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      geo.forEach((b, i) => {
        // (the cap and its glow drawn once into a picture for each quarter pixel of height: a
        // blurred shadow drawn for twelve caps every frame cost more than the rest together)
        const y = (b.y + b.h - 2 - peaks[i] * (b.h - 2)) * dpr, row = Math.floor(y), phase = Math.min(3, Math.floor((y - row) * 4));
        const sprite = caps[i]?.[phase];
        if (sprite) ctx.drawImage(sprite, Math.round(b.x * dpr) - pad, row - pad);
      });
    }
    // a fade between the off and on looks runs on while the levels stand still
    const fading = Object.values(s.fade).some(f => t - f.at < f.ms);
    if (fading && !fadeRaf) fadeRaf = requestAnimationFrame(() => { fadeRaf = 0; draw(s.levels, s.peaks); });
  }
  const measure = () => {
    dpr = window.devicePixelRatio || 1;
    // The canvas's own corner on a whole device pixel (else the picture is resampled a fraction
    // of a pixel over, soft and a pixel wider); each bar measured from it.
    canvas.style.left = canvas.style.top = `${-GLOW}px`;
    let box = canvas.getBoundingClientRect();
    const fx = box.left * dpr - Math.floor(box.left * dpr), fy = box.top * dpr - Math.floor(box.top * dpr);
    if (fx > 1e-3 || fy > 1e-3) {
      canvas.style.left = `${-GLOW - fx / dpr}px`; canvas.style.top = `${-GLOW - fy / dpr}px`;
      box = canvas.getBoundingClientRect();
    }
    const left = Math.round(box.left * dpr) / dpr, top = Math.round(box.top * dpr) / dpr;
    canvas.width = Math.max(1, Math.round(box.right * dpr) - Math.round(box.left * dpr));
    canvas.height = Math.max(1, Math.round(box.bottom * dpr) - Math.round(box.top * dpr));
    grads.clear();
    geo = bars.map(bar => {
      const fill = bar.querySelector("b"), cap = bar.querySelector("s");
      const bg = fill ? getComputedStyle(fill).backgroundImage : "";
      const stops: Stop[] = [];
      // (a stop without a position: the first at 0, the last at 1, others evenly between)
      const found = [...bg.matchAll(/(rgba?\([^)]*\))(?:\s*([\d.]+)%)?/g)];
      found.forEach(m => stops.push([m[2] !== undefined ? Number(m[2]) / 100 : NaN, rgbOf(m[1])]));
      for (let k = 0; k < stops.length; k++) if (Number.isNaN(stops[k][0])) {
        if (k === 0) { stops[k][0] = 0; continue; }
        if (k === stops.length - 1) { stops[k][0] = 1; continue; }
        let n = k + 1; while (n < stops.length && Number.isNaN(stops[n][0])) n++;
        const end = n < stops.length ? stops[n][0] : 1, from = stops[k - 1][0];
        stops[k][0] = from + (end - from) / (n - k + 1);
      }
      const cs = cap ? getComputedStyle(cap) : null;
      const shadow = cs?.boxShadow ?? "";
      const lengths = shadow.replace(/rgba?\([^)]*\)/, "").trim().split(/\s+/);
      const r = bar.getBoundingClientRect();
      // (each bar's box on whole device pixels as the page draws it; the fill's clip and mask and
      // the cap's offset inside it fall where they fall)
      const snap = (v: number) => Math.round(v * dpr) / dpr;
      const x = snap(r.left) - left, y = snap(r.top) - top;
      return { x, y, w: snap(r.right) - left - x, h: snap(r.bottom) - top - y, stops,
        cap: cs?.backgroundColor ?? "transparent", glow: (shadow.match(/rgba?\([^)]*\)/) ?? ["transparent"])[0], blur: parseFloat(lengths[2] ?? "0") || 0 };
    });
    pad = Math.ceil(GLOW * dpr);
    caps = geo.map(b => [0, 1, 2, 3].map(q => {
      const c = document.createElement("canvas"), w = Math.round((b.x + b.w) * dpr) - Math.round(b.x * dpr);
      c.width = w + 2 * pad; c.height = Math.ceil(2 * dpr) + 1 + 2 * pad;
      const x = c.getContext("2d")!;
      // (the canvas's blur is in its own pixels, not scaled with the drawing)
      x.shadowBlur = b.blur * dpr; x.shadowColor = b.glow; x.fillStyle = b.cap;
      x.beginPath();
      if (x.roundRect) x.roundRect(pad, pad + q / 4, w, 2 * dpr, dpr); else x.rect(pad, pad + q / 4, w, 2 * dpr);
      x.fill();
      return c;
    }));
    draw(s.levels, s.peaks);
  };
  const ro = new ResizeObserver(measure);
  ro.observe(eq);
  const themes = new MutationObserver(measure);
  themes.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  measure();
  return { draw, dispose: () => { ro.disconnect(); themes.disconnect(); cancelAnimationFrame(fadeRaf); fadeRaf = 0; } };
}

/** Scrolls a name too long for its line, back and forth, holding at each end. */
function useMarquee(ref: React.RefObject<HTMLElement>, text: string) {
  useLayoutEffect(() => {
    const box = ref.current;
    const line = box?.firstElementChild as HTMLElement | null;
    if (!box || !line) return;
    const measure = () => {
      const over = line.scrollWidth - box.clientWidth;
      box.classList.toggle("is-overflow", over > 2);
      box.style.setProperty("--shift", `${-Math.max(0, over)}px`);
      box.style.setProperty("--marquee", `${Math.max(6, over / 18)}s`);
    };
    // The observer's first callback measures (after layout), so nothing here forces a
    // synchronous layout of the page while React commits.
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [ref, text]);
}

const Icon = {
  power: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8v6" /><path d="M4.6 3.9a5.2 5.2 0 1 0 6.8 0" /></svg>
  ),
  prev: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="1.8" height="10" rx=".6" /><path d="M13.5 3.4v9.2a.6.6 0 0 1-.93.5L5.9 8.5a.6.6 0 0 1 0-1l6.67-4.6a.6.6 0 0 1 .93.5Z" /></svg>
  ),
  next: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="11.7" y="3" width="1.8" height="10" rx=".6" /><path d="M2.5 3.4v9.2a.6.6 0 0 0 .93.5l6.67-4.6a.6.6 0 0 0 0-1L3.43 2.9a.6.6 0 0 0-.93.5Z" /></svg>
  ),
  play: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.9v10.2a.7.7 0 0 0 1.06.6l8.1-5.1a.7.7 0 0 0 0-1.2l-8.1-5.1a.7.7 0 0 0-1.06.6Z" /></svg>
  ),
  pause: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.6" y="2.6" width="3" height="10.8" rx=".9" /><rect x="9.4" y="2.6" width="3" height="10.8" rx=".9" /></svg>
  ),
};

/** `ear` is the boxed player beside the clocks (desktop and tablet); `strip` is
 * the phone's one-line version under the nameplate — same parts, laid in a row
 * with thumb-sized buttons. */
export default function DeskBgm({ variant = "ear" }: { variant?: "ear" | "strip" | "header" }) {
  const design = useDesignMode(), fx = useFxLevel();
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => { const media = matchMedia("(prefers-reduced-motion: reduce)"); const update = () => setReducedMotion(media.matches); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  const L = useL();
  const bgm = useDeskBgm();
  const eqRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  useEffect(() => attachDeskBgm(), []);
  const running = bgm.on && bgm.playing && !bgm.loading;
  useMeter(eqRef, bgm.track, running, bgm.on, design === "neo" && (fx === "minimal" || reducedMotion));
  useMarquee(titleRef, bgm.track.title);

  // A brief pulse on the button that was pressed, so a skip is felt at once even
  // while the next track is still buffering.
  const tap = (name: string, action: () => void) => () => {
    setPressed(name);
    window.setTimeout(() => setPressed((p) => (p === name ? null : p)), 220);
    action();
  };

  const state = bgm.failed
    ? L("재생할 수 없음", "Unavailable")
    : bgm.blocked
      ? L("▶ 탭하여 재생", "Tap ▶ to play")
    : !bgm.on
      ? L("BGM 꺼짐", "BGM off")
      : bgm.loading
        ? L("불러오는 중…", "Loading…")
        : bgm.playing
          ? L("재생 중", "Playing")
          : L("일시정지", "Paused");

  return (
    <div
      className={`d2-bgm${variant !== "ear" ? " d2-bgm--strip" : ""}${variant === "header" ? " d2-bgm--header" : ""}${bgm.blocked ? " is-blocked" : ""}${bgm.on ? " is-on" : ""}${running ? " is-playing" : ""}${bgm.loading && bgm.on ? " is-loading" : ""}`}
      data-ear={bgm.on ? "NOW PLAYING" : "BGM"}
      role="group"
      aria-label={L("배경 음악", "Background music")}
    >
      <div className="d2-bgm-deck">
        <div className="d2-bgm-eq" ref={eqRef} aria-hidden="true" title={L("재생 상태와 곡의 리듬에 맞춘 시각 효과", "Playback-synchronized visualizer")}>
          {Array.from({ length: BARS }, (_, i) => (
            // Each band its own hue, low to high: blue through violet and magenta
            // to red, orange and amber — a spectrum you can read at a glance.
            <i key={i} style={{ "--h": String(Math.round(200 + (i * 205) / (BARS - 1)) % 360) } as React.CSSProperties}>
              <b />
              <s />
            </i>
          ))}
        </div>
        <div className="d2-bgm-transport">
          <button type="button" className={pressed === "prev" ? "is-pressed" : ""} onClick={tap("prev", prev)} disabled={!bgm.on && variant !== "header"} aria-label={L("이전 곡", "Previous track")} title={L("이전 곡", "Previous")}>
            {Icon.prev}
          </button>
          <button
            type="button"
            className={`d2-bgm-play${pressed === "play" ? " is-pressed" : ""}`}
            onClick={tap("play", toggleDeskBgmPlay)}
            onPointerEnter={warmDeskBgm}
            aria-label={bgm.on && bgm.playing ? L("일시정지", "Pause") : L("재생", "Play")}
            title={bgm.on && bgm.playing ? L("일시정지", "Pause") : L("재생", "Play")}
          >
            {bgm.on && bgm.playing ? Icon.pause : Icon.play}
          </button>
          <button type="button" className={pressed === "next" ? "is-pressed" : ""} onClick={tap("next", next)} disabled={!bgm.on && variant !== "header"} aria-label={L("다음 곡", "Next track")} title={L("다음 곡", "Next")}>
            {Icon.next}
          </button>
        </div>
      </div>

      <div className="d2-bgm-meta">
        <div className="d2-bgm-title" ref={titleRef} title={bgm.track.title}>
          <span>{bgm.track.title}</span>
        </div>
        <div className="d2-bgm-sub">
          <span className="d2-bgm-state" aria-live="polite">{state}</span>
          <span className="d2-bgm-channel">{bgm.track.channel}</span>
          <span className="d2-bgm-count">
            {bgm.position}/{bgm.total}
          </span>
        </div>
      </div>

      <button
        type="button"
        className="d2-bgm-power"
        aria-pressed={bgm.on}
        onPointerEnter={warmDeskBgm}
        onClick={() => setDeskBgmOn(!bgm.on)}
        aria-label={bgm.on ? L("배경 음악 끄기", "Turn background music off") : L("배경 음악 켜기", "Turn background music on")}
        title={bgm.on ? L("BGM 끄기", "BGM off") : L("BGM 켜기", "BGM on")}
      >
        {Icon.power}
        <span>{bgm.on ? "ON" : "OFF"}</span>
      </button>
    </div>
  );
}
