import { useEffect, useRef, useSyncExternalStore } from "react";
import { DEFAULT_VIEW, setCameraControlsPaused, setViewPreferences, subscribeView, viewPreferences } from "./viewPreferences";
import "./cameraSettings.css";

export default function CameraSettings({ open, setOpen, onCenter }: { open: boolean; setOpen(on: boolean): void; onCenter(): void }) {
  const p = useSyncExternalStore(subscribeView, viewPreferences), panel = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    setCameraControlsPaused(true);
    const previous = document.activeElement as HTMLElement | null;
    if (panel.current && !panel.current.open) panel.current.showModal();
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = () => setOpen(false);
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const els = [...(panel.current?.querySelectorAll<HTMLElement>("button,input") ?? [])];
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    window.addEventListener("camera-settings-close", close); window.addEventListener("keydown", trap);
    return () => { setCameraControlsPaused(false); window.removeEventListener("camera-settings-close", close); window.removeEventListener("keydown", trap); previous?.focus(); };
  }, [open, setOpen]);
  return <div className="wk-camera-control" onPointerDown={e => e.stopPropagation()}>
    <button type="button" className="wk-camera-trigger" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) document.exitPointerLock?.(); }}>시야 · 조작 설정</button>
    {open && <dialog ref={panel} className="wk-camera-panel" data-camera-settings aria-modal="true" aria-labelledby="camera-settings-title" onCancel={e => { e.preventDefault(); setOpen(false); }}>
      <header><h2 id="camera-settings-title">편안한 시야와 조작</h2><button type="button" onClick={() => setOpen(false)}>닫기 · Esc</button></header>
      <label>시야각 <output>{p.fov}°</output><input aria-label="시야각" type="range" min="60" max="90" step="1" value={p.fov} onChange={e => setViewPreferences({ fov: +e.target.value })} /></label>
      <small>세로 화면은 주변이 더 보이도록 시야를 넓힙니다.</small>
      <label>마우스 · 터치 감도 <output>{Math.round(p.sensitivity * 100)}%</output><input aria-label="시점 감도" type="range" min="40" max="180" step="5" value={p.sensitivity * 100} onChange={e => setViewPreferences({ sensitivity: +e.target.value / 100 })} /></label>
      <label>3인칭 거리 <output>{Math.round(p.distance * 100)}%</output><input aria-label="3인칭 거리" type="range" min="70" max="140" step="5" value={p.distance * 100} onChange={e => setViewPreferences({ distance: +e.target.value / 100 })} /></label>
      <label className="wk-camera-check"><input type="checkbox" checked={p.reduceMotion} onChange={e => setViewPreferences({ reduceMotion: e.target.checked })} />걷기 흔들림 줄이기</label>
      <label className="wk-camera-check"><input type="checkbox" checked={p.invertY} onChange={e => setViewPreferences({ invertY: e.target.checked })} />위아래 시점 반전</label>
      <footer><button type="button" onClick={onCenter}>시선 수평으로 <kbd>C</kbd></button><button type="button" onClick={() => setViewPreferences(DEFAULT_VIEW)}>기본값</button></footer>
    </dialog>}
  </div>;
}
