import { useEffect, useRef, useState } from "react";
import { DeepDive } from "./deepDive";
import { useLanguage } from "../i18n/LanguageContext";
import type { CinemaCamPreset } from "../neo/PulseCinemaView";

/** Anything the viewer clicks or types into: a drag starting there is not a camera move. */
const INTERACTIVE = "a,button,input,select,textarea,label,summary,[role=button],[role=tab],[role=slider],[contenteditable],.pbp,.pb2-cam-modes,.pb-cinema-ui";

/** The 증시 전광판2 background: the deep-dive scene behind the board, coloured by the
 *  market (`change`: the index on arrival, a chosen stock afterwards).
 *
 *  Two camera modes, chosen with two buttons (remembered): 시점 조작, the default, where the
 *  board stays as it is and a drag on any empty space turns the scene (right/Shift-drag
 *  slides it, the wheel over the scene outside the board zooms, a pinch zooms on touch,
 *  a double-click resets); and 자동 VIEW, the take's own camera. */
export default function DeepDiveBackground({
  change,
  cinema = false,
  camPreset = "auto",
  onCamPreset,
  onOpenCinema,
}: {
  change: number | null | undefined;
  cinema?: boolean;
  camPreset?: CinemaCamPreset;
  onCamPreset?: (preset: CinemaCamPreset) => void;
  onOpenCinema?: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<DeepDive | null>(null);
  const [failed, setFailed] = useState(false);
  const [manual, setManual] = useState(() => { try { return localStorage.getItem("pb2-cam") !== "auto"; } catch { return true; } });
  const [hint, setHint] = useState(0);
  const { lang } = useLanguage();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  useEffect(() => {
    if (!canvas.current) return;
    try {
      const narrow = matchMedia("(max-width: 899px), (pointer: coarse)").matches;
      scene.current = new DeepDive(canvas.current, narrow ? "medium" : "high");
      scene.current.setMood(change);
      (window as unknown as { __deepDive?: DeepDive }).__deepDive = scene.current;
    } catch (error) { console.warn("deep dive", error); setFailed(true); }
    return () => { scene.current?.dispose(); scene.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { scene.current?.setMood(change); }, [change]);

  // Drive smooth Cinema View camera presets (Auto / 360° Orbit / Hero Low-Angle / Close-Up / Free Manual)
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    if (!cinema) {
      if (!manual) s.userReset();
      return;
    }
    if (camPreset === "auto") {
      s.userReset();
      return;
    }
    if (camPreset === "low") {
      s.userReset();
      s.userOrbit(0.38, -0.44);
      s.userZoom(0.76);
      return;
    }
    if (camPreset === "close") {
      s.userReset();
      s.userOrbit(-0.26, 0.08);
      s.userZoom(0.54);
      return;
    }
    if (camPreset === "orbit") {
      s.userReset();
      s.userOrbit(0, -0.16);
      s.userZoom(0.84);
      let raf = 0;
      let prev = performance.now();
      const step = (now: number) => {
        const dt = Math.min(0.05, (now - prev) / 1000);
        prev = now;
        scene.current?.userOrbit(dt * 0.22, 0);
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
    }
  }, [cinema, camPreset, manual]);

  // Trigger clean canvas resize when promoting to / exiting fullscreen Cinema View
  useEffect(() => {
    const id = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 40);
    return () => window.clearTimeout(id);
  }, [cinema]);

  // 시점 조작: gestures on the page's empty space move the camera; in Cinema View, dragging ANY open area orbits freely!
  const interactiveDrag = manual || cinema;
  useEffect(() => {
    if (!cinema) {
      try { localStorage.setItem("pb2-cam", manual ? "manual" : "auto"); } catch { /* not remembered */ }
    }
    const root = document.documentElement;
    if (!interactiveDrag) { scene.current?.userReset(); return; }
    root.classList.add("pb2-manual");
    const page = () => document.querySelector(".pb-page");
    const isScene = (t: EventTarget | null) => {
      if (!(t instanceof Element)) return false;
      if (t.closest(INTERACTIVE)) return false;
      if (cinema) return true;
      return !!page()?.contains(t);
    };
    const pts = new Map<number, { x: number; y: number }>();
    let dragging = false, pan = false, moved = 0, pinch = 0, panned = false;
    const down = (e: PointerEvent) => {
      if (!isScene(e.target)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { dragging = true; moved = 0; panned = false; pan = e.button === 2 || e.shiftKey; }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    };
    const move = (e: PointerEvent) => {
      const p = pts.get(e.pointerId), s = scene.current;
      if (!p || !s || !dragging) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y, h = Math.max(320, window.innerHeight);
      p.x = e.clientX; p.y = e.clientY;
      const was = moved; moved += Math.abs(dx) + Math.abs(dy);
      if (moved < 5) return;                       // a click, not a drag
      if (was < 5) {
        window.getSelection()?.removeAllRanges();
        root.classList.add("pb2-dragging");
        if (cinema && camPreset !== "manual") onCamPreset?.("manual");
      }
      if (pts.size >= 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && d > 0) s.userZoom(pinch / d);
        pinch = d; return;
      }
      if (pan) { s.userPan(-dx / h * 1.2, dy / h * 1.2); panned = true; }
      // (on touch outside cinema only the sideways part turns so the page still scrolls; inside cinema full 360° orbit!)
      else if (e.pointerType === "touch" && !cinema) s.userOrbit(-dx / h * 3.2, 0);
      else s.userOrbit(-dx / h * 3.2, dy / h * 2.4);
    };
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; if (!pts.size) { dragging = false; root.classList.remove("pb2-dragging"); } };
    const wheel = (e: WheelEvent) => {
      // zoom over the scene itself (anywhere in Cinema View, or outside the board in normal mode)
      if (!isScene(e.target) || (!cinema && (e.target as Element).closest(".pb-board"))) return;
      e.preventDefault();
      if (cinema && camPreset !== "manual") onCamPreset?.("manual");
      scene.current?.userZoom(Math.exp(e.deltaY * 0.0012));
    };
    const dbl = (e: MouseEvent) => { if (isScene(e.target)) scene.current?.userReset(); };
    const ctx = (e: MouseEvent) => { if (isScene(e.target) && panned) e.preventDefault(); };
    document.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    document.addEventListener("wheel", wheel, { passive: false });
    document.addEventListener("dblclick", dbl);
    document.addEventListener("contextmenu", ctx);
    return () => {
      document.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      document.removeEventListener("wheel", wheel);
      document.removeEventListener("dblclick", dbl);
      document.removeEventListener("contextmenu", ctx);
      root.classList.remove("pb2-manual", "pb2-dragging");
    };
  }, [interactiveDrag, manual, cinema, camPreset, onCamPreset]);

  const choose = (m: boolean) => { setManual(m); if (m) setHint(h => h + 1); };
  if (failed) return null;
  return <>
    <div className="pb2-deep" aria-hidden="true"><canvas ref={canvas} /></div>
    <div className="pb2-cam-modes" role="radiogroup" aria-label={L("카메라 시점", "Camera")}>
      <button type="button" role="radio" aria-checked={manual} className={manual ? "is-on" : ""} onClick={() => choose(true)}
        title={L("빈 공간 드래그: 회전 · 우클릭/Shift 드래그: 이동 · 장면 위 휠/핀치: 확대·축소 · 더블클릭: 처음 시점", "Drag empty space: turn · Right/Shift-drag: slide · Wheel/pinch over the scene: zoom · Double-click: reset")}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c-5 0-8.5 4.6-9.5 7 1 2.4 4.5 7 9.5 7s8.5-4.6 9.5-7c-1-2.4-4.5-7-9.5-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" fill="currentColor" /></svg>
        {L("시점 조작", "Camera")}
      </button>
      <button type="button" role="radio" aria-checked={!manual} className={!manual ? "is-on" : ""} onClick={() => choose(false)} title={L("연출 카메라가 자동으로 움직입니다", "The take's own camera")}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h11a2 2 0 0 1 2 2v1.5l3.5-2.5v8L17 13.5V15a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" fill="currentColor" /></svg>
        {L("자동 VIEW", "Auto view")}
      </button>
      {onOpenCinema && (
        <button type="button" className="pb2-cam-cinema" onClick={onOpenCinema} title={L("전체 화면 시네마뷰로 감상 (C)", "Open fullscreen Cinema View (C)")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Zm2 2v8h14V8H5Zm5.5 1.6 4.8 2.4-4.8 2.4V9.6Z" fill="currentColor" /></svg>
          {L("시네마뷰", "Cinema")}
        </button>
      )}
    </div>
    {manual && hint > 0 && <p key={hint} className="pb2-cam-hint">{L("빈 공간 드래그: 회전 · 우클릭/Shift 드래그: 이동 · 장면 위 휠: 확대·축소 · 더블클릭: 처음 시점",
      "Drag empty space: turn · Right/Shift-drag: slide · Wheel over the scene: zoom · Double-click: reset")}</p>}
  </>;
}
