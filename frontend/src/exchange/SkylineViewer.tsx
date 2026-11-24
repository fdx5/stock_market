import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import type { AtriumMood } from "./floorEngine";
import { STORAGE_ASSETS, type Language } from "./marketCore";
import bake from "./bake.json";

const t = (lang: Language, ko: string, en: string) => (lang === "ko" ? ko : en);
const SKY_VER = "?v=" + Math.round(bake.shell.scale * 1e4).toString(36) + Math.round(bake.fixtures.scale * 1e4).toString(36) + "v7c";

const SKYLINE_URLS: Record<AtriumMood, string> = {
  daylight: `${STORAGE_ASSETS}/skyline-day-v7.webp${SKY_VER}`,
  golden: `${STORAGE_ASSETS}/skyline-golden-v7.webp${SKY_VER}`,
  night: `${STORAGE_ASSETS}/skyline-night-v7.webp${SKY_VER}`,
};

const MOOD_META: Record<AtriumMood, { ko: string; en: string; subKo: string; subEn: string }> = {
  daylight: {
    ko: "주간",
    en: "Day",
    subKo: "맨해튼 금융 지구 360° 16K 실사 초고화질 파노라마 · 맑은 주간 전망 (Wikimedia Commons CC BY-SA 4.0)",
    subEn: "Manhattan Financial District 360° 16K Photoreal Panorama · Clear Daylight View (Wikimedia Commons CC BY-SA 4.0)",
  },
  golden: {
    ko: "골든아워",
    en: "Golden",
    subKo: "맨해튼 금융 지구 360° 16K 실사 초고화질 파노라마 · 황금빛 노을 전망 (Wikimedia Commons CC BY-SA 4.0)",
    subEn: "Manhattan Financial District 360° 16K Photoreal Panorama · Golden Hour Sunset View (Wikimedia Commons CC BY-SA 4.0)",
  },
  night: {
    ko: "네온나이트",
    en: "Night",
    subKo: "맨해튼 금융 지구 360° 16K 실사 초고화질 야경 파노라마 (Wikimedia Commons CC BY-SA 4.0)",
    subEn: "Manhattan Financial District 360° 16K Photoreal Night Panorama (Wikimedia Commons CC BY-SA 4.0)",
  },
};

function wrap01(v: number) {
  return ((v % 1) + 1) % 1;
}

/** Convert Three.js camera yaw (radians, 0 = -Z North, negative = clockwise East) to 360° compass fraction [0, 1). */
function yawToHeading(yaw: number) {
  const deg = ((-yaw * 180) / Math.PI) % 360;
  return wrap01(deg / 360);
}

/** Match the exact 3D exterior window 1x 360° parallax UV (equirectUV(dir).x) so opening frames the exact same district. */
function yawToPanoramaU(yaw: number) {
  const dirX = -Math.sin(yaw);
  const dirZ = -Math.cos(yaw);
  const eqX = Math.atan2(dirZ, dirX) / (Math.PI * 2) + 0.5;
  return wrap01(eqX);
}

function compassLabel(deg: number) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

/** Full-viewport 360° seamless wide panoramic city observatory opened by clicking any exterior window. */
export default function SkylineViewer({
  mood,
  onMoodChange,
  initialYaw,
  lang,
  onClose,
}: {
  mood: AtriumMood;
  onMoodChange: (m: AtriumMood) => void;
  initialYaw: number;
  lang: Language;
  onClose: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLSpanElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);

  const [autoPan, setAutoPan] = useState(false);
  const [zoomUi, setZoomUi] = useState(1);
  const [aspect, setAspect] = useState(4.0);
  const [loadedMoods, setLoadedMoods] = useState<Partial<Record<AtriumMood, boolean>>>({});

  // Continuous physics state stored in refs for silky 120Hz GPU transform updates without React re-renders
  const sim = useRef({
    u: yawToPanoramaU(initialYaw),
    targetU: yawToPanoramaU(initialYaw),
    heading: yawToHeading(initialYaw),
    targetHeading: yawToHeading(initialYaw),
    velU: 0,
    zoom: 1,
    targetZoom: 1,
    panY: 0,
    targetPanY: 0,
    dragging: false,
    autoPan: false,
    keysLeft: false,
    keysRight: false,
  });
  sim.current.autoPan = autoPan;

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number } | null>(null);

  // Preload all 3 futuristic Seoul panoramas so Day / Golden Hour / Night crossfade is instant & zero-flicker
  useEffect(() => {
    closeRef.current?.focus();
    let alive = true;
    (["daylight", "golden", "night"] as const).forEach(m => {
      const img = new Image();
      img.decoding = "async";
      img.src = SKYLINE_URLS[m];
      const mark = () => {
        if (!alive) return;
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          setAspect(img.naturalWidth / img.naturalHeight);
        }
        setLoadedMoods(prev => (prev[m] ? prev : { ...prev, [m]: true }));
      };
      if (img.complete && img.naturalWidth > 0) mark();
      else img.onload = mark;
    });
    return () => { alive = false; };
  }, []);

  // Keyboard navigation: Left/Right arrows pan 360°, +/- zoom, Escape closes
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowLeft" || e.code === "KeyA") { e.preventDefault(); setAutoPan(false); sim.current.keysLeft = true; }
      if (e.key === "ArrowRight" || e.code === "KeyD") { e.preventDefault(); setAutoPan(false); sim.current.keysRight = true; }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); adjustZoom(1.25); }
      if (e.key === "-" || e.key === "_") { e.preventDefault(); adjustZoom(1 / 1.25); }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.code === "KeyA") sim.current.keysLeft = false;
      if (e.key === "ArrowRight" || e.code === "KeyD") sim.current.keysRight = false;
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [onClose]);

  const adjustZoom = (factor: number) => {
    const s = sim.current;
    const next = Math.max(1, Math.min(2.8, s.targetZoom * factor));
    s.targetZoom = next;
    if (next <= 1.01) s.targetPanY = 0;
    setZoomUi(Math.round(next * 100) / 100);
  };

  // Smooth 60/120Hz GPU-accelerated seamless 360° wrap animation loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      const s = sim.current;
      const stage = stageRef.current;
      const track = trackRef.current;
      if (stage && track) {
        const vw = stage.clientWidth || window.innerWidth;
        const vh = stage.clientHeight || window.innerHeight;
        // Frame strictly the full crisp futuristic cityscape (v=0.08..1.00) with ZERO over-zoom blur!
        const tileH = Math.round(vh * 1.10);
        const tileW = Math.round(Math.max(vw * 2.6, tileH * aspect));

        if (s.keysLeft) { s.targetU -= dt * 0.11; s.targetHeading -= dt * 0.11; }
        if (s.keysRight) { s.targetU += dt * 0.11; s.targetHeading += dt * 0.11; }
        if (s.autoPan && !s.dragging && !s.keysLeft && !s.keysRight) {
          s.targetU += dt * 0.015;
          s.targetHeading += dt * 0.015;
        }
        if (!s.dragging && Math.abs(s.velU) > 1e-5) {
          s.targetU += s.velU * dt;
          s.targetHeading += s.velU * dt;
          s.velU *= Math.exp(-dt * 5.2);
        }

        const ease = 1 - Math.exp(-dt * 14);
        s.u += (s.targetU - s.u) * ease;
        s.heading += (s.targetHeading - s.heading) * ease;
        s.zoom += (s.targetZoom - s.zoom) * ease;

        const maxPanY = Math.max(0, (tileH * s.zoom - vh) * 0.48);
        s.targetPanY = Math.max(-maxPanY, Math.min(maxPanY, s.targetPanY));
        s.panY += (s.targetPanY - s.panY) * ease;

        // Place the 3-tile strip so the middle tile cleanly covers [0, 1) with seamless left/right neighbors!
        const uWrapped = wrap01(s.u);
        const centerX = -(tileW + uWrapped * tileW) + vw * 0.5;
        const centerY = (vh - tileH) * 0.5 - tileH * 0.038;
        // Scale around viewport center
        const originX = vw * 0.5 - centerX;
        const originY = vh * 0.5 - centerY;

        track.style.width = `${tileW * 3}px`;
        track.style.height = `${tileH}px`;
        track.style.transformOrigin = `${originX}px ${originY}px`;
        track.style.transform = `translate3d(${centerX}px, ${centerY + s.panY}px, 0) scale(${s.zoom})`;

        const deg = Math.round(wrap01(s.heading) * 360) % 360;
        if (headingRef.current) {
          headingRef.current.textContent = `${compassLabel(deg)} · ${String(deg).padStart(3, "0")}°`;
        }
        if (indicatorRef.current) {
          indicatorRef.current.style.left = `${wrap01(s.heading) * 100}%`;
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [aspect]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setAutoPan(false);
    sim.current.dragging = true;
    sim.current.velU = 0;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), z: sim.current.targetZoom };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const nextZ = Math.max(1, Math.min(2.8, pinch.current.z * (d / pinch.current.d)));
      sim.current.targetZoom = nextZ;
      setZoomUi(Math.round(nextZ * 100) / 100);
      return;
    }

    const stage = stageRef.current;
    const vw = stage?.clientWidth || window.innerWidth;
    const vh = stage?.clientHeight || window.innerHeight;
    const tileW = Math.max(vw * 3.0, vh * 1.44 * aspect);
    // Dragging left reveals city to the right (1:1 true 360° rotation!)
    const du = (-dx / (tileW * sim.current.zoom)) * 1.08;
    sim.current.targetU += du;
    sim.current.targetHeading += du;
    sim.current.velU = du * 18;
    if (sim.current.zoom > 1.02) {
      sim.current.targetPanY += dy;
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) sim.current.dragging = false;
  };

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    setAutoPan(false);
    // Pinch/Ctrl+wheel zooms; horizontal trackpad swipe OR standard wheel smoothly pans across the 360° city panorama!
    if (e.ctrlKey) {
      e.preventDefault();
      adjustZoom(e.deltaY < 0 ? 1.14 : 1 / 1.14);
      return;
    }
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 0.4 ? e.deltaX : e.deltaY;
    const du = (delta / 4200) / sim.current.zoom;
    sim.current.targetU += du;
    sim.current.targetHeading += du;
    sim.current.velU = 0;
  };

  const onScrubCompass = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setAutoPan(false);
    sim.current.velU = 0;
    sim.current.targetHeading = frac;
    sim.current.targetU = wrap01(frac);
  };

  const meta = MOOD_META[mood];

  return (
    <div className="exchange-skyline" role="dialog" aria-modal="true" aria-label={t(lang, "360° 금융 도심 스카이라인 전망창", "360° Financial Metropolis Skyline Observatory")}>
      <div
        ref={stageRef}
        className="exchange-skyline-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={() => adjustZoom(zoomUi > 1.15 ? 1 / zoomUi : 1.75)}
      >
        <div ref={trackRef} className="exchange-skyline-track">
          {(["daylight", "golden", "night"] as const).map(m => (
            <div
              key={m}
              className="exchange-skyline-layer"
              data-active={mood === m || undefined}
              data-loaded={loadedMoods[m] || undefined}
            >
              {[0, 1, 2].map(tileIdx => (
                <img
                  key={tileIdx}
                  src={SKYLINE_URLS[m]}
                  alt={tileIdx === 1 && mood === m ? t(lang, meta.subKo, meta.subEn) : ""}
                  aria-hidden={tileIdx !== 1 || mood !== m || undefined}
                  draggable={false}
                  decoding="async"
                />
              ))}
            </div>
          ))}
        </div>
        {/* Subtle architectural observatory window bezel & edge vignette (never obscures the skyline) */}
        <div className="exchange-skyline-glass" aria-hidden="true" />
      </div>

      <header className="exchange-art-caption exchange-skyline-head">
        <div>
          <span className="exchange-skyline-kicker">FINANCIAL DISTRICT 16K OBSERVATORY · 360° PANORAMA</span>
          <h2>{t(lang, "금융 도심 360° 초고화질 전망창", "Financial Metropolis 16K 360° Observatory")}</h2>
          <p>{t(lang, meta.subKo, meta.subEn)}</p>
        </div>
        <div className="exchange-skyline-tools">
          <div className="exchange-mood-switch" role="group" aria-label={t(lang, "전망 시간대", "Observatory time of day")}>
            {(["daylight", "golden", "night"] as const).map(m => (
              <button
                key={m}
                type="button"
                className="exchange-mood-btn"
                aria-pressed={mood === m}
                onClick={() => onMoodChange(m)}
              >
                {t(lang, MOOD_META[m].ko, MOOD_META[m].en)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="exchange-action exchange-art-pill"
            aria-pressed={autoPan}
            onClick={() => setAutoPan(v => !v)}
          >
            {t(lang, "자동 감상", "Auto pan")}
          </button>
          <button type="button" className="exchange-action" onClick={() => adjustZoom(1 / 1.3)} aria-label={t(lang, "축소", "Zoom out")}>−</button>
          <button type="button" className="exchange-action" onClick={() => adjustZoom(1.3)} aria-label={t(lang, "확대", "Zoom in")}>+</button>
          <button ref={closeRef} type="button" className="exchange-action" onClick={onClose} aria-label={t(lang, "닫기", "Close")}>×</button>
        </div>
      </header>

      <footer className="exchange-skyline-footer">
        <div className="exchange-skyline-compass-wrap">
          <span ref={headingRef} className="exchange-skyline-heading">N · 000°</span>
          <div
            className="exchange-skyline-compass"
            role="slider"
            aria-label={t(lang, "360° 시선 방향", "360° viewing direction")}
            aria-valuemin={0}
            aria-valuemax={360}
            tabIndex={0}
            onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); onScrubCompass(e); }}
            onPointerMove={e => { if (e.buttons === 1) onScrubCompass(e); }}
          >
            <span>N</span><span>E</span><span>S</span><span>W</span><span>N</span>
            <span ref={indicatorRef} className="exchange-skyline-needle" />
          </div>
          <small className="exchange-skyline-zoom">{Math.round(zoomUi * 100)}%</small>
        </div>
        <p className="exchange-skyline-hint">
          {t(
            lang,
            "좌우 드래그·휠 스크롤·방향키로 360° 도심 전경 탐색 · 더블클릭/+− 확대 · 시간대 전환",
            "Drag, scroll, or use arrow keys to pan 360° · double-click or +/− to zoom · switch time of day",
          )}
        </p>
      </footer>
    </div>
  );
}
