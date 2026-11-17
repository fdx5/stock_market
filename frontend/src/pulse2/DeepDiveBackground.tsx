import { useEffect, useRef, useState } from "react";
import { DeepDive } from "./deepDive";
import { useLanguage } from "../i18n/LanguageContext";

/** The 증시 전광판2 background: the deep-dive scene behind the board, coloured by the
 *  market (`change`: the index on arrival, a chosen stock afterwards). The viewer holds
 *  the camera by default (a button switches to the board, remembered): the board fades away and the scene can be turned
 *  (drag), zoomed (wheel, pinch) and slid (right-drag, Shift-drag, two fingers); a
 *  double-click resets the view, Esc or the button gives the board back. */
export default function DeepDiveBackground({ change }: { change: number | null | undefined }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<DeepDive | null>(null);
  const [failed, setFailed] = useState(false);
  // Camera mode is the default; a viewer who goes back to the board is remembered.
  const [viewing, setViewing] = useState(() => { try { return localStorage.getItem("pb2-cam") !== "0"; } catch { return true; } });
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

  // camera mode: the board steps aside while the viewer holds the camera
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("pb2-viewing", viewing);
    try { localStorage.setItem("pb2-cam", viewing ? "1" : "0"); } catch { /* private mode: not remembered */ }
    if (!viewing) { scene.current?.userReset(); return; }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setViewing(false); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); root.classList.remove("pb2-viewing"); };
  }, [viewing]);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef(0);
  const mode = useRef<"orbit" | "pan">("orbit");
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    mode.current = e.button === 2 || e.shiftKey ? "pan" : "orbit";
    if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; pinch.current = Math.hypot(a.x - b.x, a.y - b.y); }
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pointers.current.get(e.pointerId), s = scene.current;
    if (!p || !s) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y, h = Math.max(320, window.innerHeight);
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.current.size >= 2) {
      // two fingers: pinch to zoom, move together to slide
      const [a, b] = [...pointers.current.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current > 0 && d > 0) s.userZoom(pinch.current / d);
      pinch.current = d;
      s.userPan(-dx / h * 0.5, dy / h * 0.5);
      return;
    }
    if (mode.current === "pan") s.userPan(-dx / h * 1.2, dy / h * 1.2);
    else s.userOrbit(-dx / h * 3.2, dy / h * 2.4);
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => { pointers.current.delete(e.pointerId); if (pointers.current.size < 2) pinch.current = 0; };
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => { scene.current?.userZoom(Math.exp(e.deltaY * 0.0012)); };

  if (failed) return null;
  return <>
    <div className="pb2-deep" aria-hidden="true"><canvas ref={canvas} /></div>
    {viewing && <div className="pb2-cam" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onWheel={onWheel} onDoubleClick={() => scene.current?.userReset()} onContextMenu={e => e.preventDefault()}>
      <p className="pb2-cam-hint">{L("드래그: 회전 · 휠/핀치: 확대·축소 · 우클릭/Shift 드래그: 이동 · 더블클릭: 처음 시점 · Esc: 닫기",
        "Drag: turn · Wheel/pinch: zoom · Right/Shift-drag: slide · Double-click: reset · Esc: close")}</p>
    </div>}
    <button type="button" className={`pb2-cam-toggle${viewing ? " is-on" : ""}`} onClick={() => setViewing(v => !v)} aria-pressed={viewing}
      title={viewing ? L("전광판으로 돌아가기", "Back to the board") : L("시점을 직접 움직여 보기", "Move the camera yourself")}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c-5 0-8.5 4.6-9.5 7 1 2.4 4.5 7 9.5 7s8.5-4.6 9.5-7c-1-2.4-4.5-7-9.5-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" fill="currentColor" /></svg>
      <span>{viewing ? L("전광판 보기", "Board") : L("시점 조작", "Camera")}</span>
    </button>
  </>;
}
