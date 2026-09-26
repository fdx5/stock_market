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

function useMeter(eqRef: React.RefObject<HTMLDivElement>, track: DeskTrack, running: boolean, on: boolean) {
  const trackRef = useRef(track);
  trackRef.current = track;
  useEffect(() => {
    const el = eqRef.current;
    if (!el) return;
    const bars = Array.from(el.children) as HTMLElement[];
    const levels = bars.map((_, i) => (on ? REST : IDLE[i]));
    const peaks = [...levels];
    const holds = levels.map(() => 0);
    const paint = () => {
      bars.forEach((bar, i) => {
        bar.style.setProperty("--lvl", levels[i].toFixed(3));
        bar.style.setProperty("--peak", peaks[i].toFixed(3));
      });
    };
    /* Not gated on prefers-reduced-motion: the meter only moves once the reader
       has switched the music on themselves, and a player whose meter stands
       still reads as broken — which is exactly how it was reported. */
    if (!running && !on) {
      if (!on) IDLE.forEach((v, i) => { levels[i] = v; peaks[i] = v; });
      paint();
      return;
    }
    let raf = 0;
    let last = performance.now();
    let clock = getDeskBgmTime() ?? 0;
    let synced = 0;
    const seed = hash(trackRef.current.id);
    const frame = (now: number) => {
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
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [eqRef, running, on, track.id]);
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
    measure();
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
export default function DeskBgm({ variant = "ear" }: { variant?: "ear" | "strip" }) {
  const L = useL();
  const bgm = useDeskBgm();
  const eqRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  useEffect(() => attachDeskBgm(), []);
  const running = bgm.on && bgm.playing && !bgm.loading;
  useMeter(eqRef, bgm.track, running, bgm.on);
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
      className={`d2-bgm${variant === "strip" ? " d2-bgm--strip" : ""}${bgm.blocked ? " is-blocked" : ""}${bgm.on ? " is-on" : ""}${running ? " is-playing" : ""}${bgm.loading && bgm.on ? " is-loading" : ""}`}
      data-ear={bgm.on ? "NOW PLAYING" : "BGM"}
      role="group"
      aria-label={L("배경 음악", "Background music")}
    >
      <div className="d2-bgm-deck">
        <div className="d2-bgm-eq" ref={eqRef} aria-hidden="true">
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
          <button type="button" className={pressed === "prev" ? "is-pressed" : ""} onClick={tap("prev", prev)} disabled={!bgm.on} aria-label={L("이전 곡", "Previous track")} title={L("이전 곡", "Previous")}>
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
          <button type="button" className={pressed === "next" ? "is-pressed" : ""} onClick={tap("next", next)} disabled={!bgm.on} aria-label={L("다음 곡", "Next track")} title={L("다음 곡", "Next")}>
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
