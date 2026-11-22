import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import art from "./art.json";
import { STORAGE_ASSETS, type Language } from "./marketCore";

type Painting = (typeof art.paintings)[number];
const t = (lang: Language, ko: string, en: string) => lang === "ko" ? ko : en;
const SCULPTURE_NAMES: Record<string, [string, string]> = {
  marble_bust_01: ["대리석 흉상", "Marble bust"], horse_statue_01: ["말 조각상", "Horse statue"], gothic_statue: ["고딕 조각상", "Gothic statue"],
  bronze_whale_statue: ["청동 고래", "Bronze whale"], bronze_ray_statue: ["청동 가오리", "Bronze ray"], horse_head: ["말 두상", "Horse head"],
  lion_head: ["사자 두상", "Lion head"], carved_wooden_elephant: ["목각 코끼리", "Carved wooden elephant"], antique_ceramic_vase_01: ["고풍 도자 화병", "Antique ceramic vase"],
};

export function artLabel(id: string, lang: Language) {
  if (id.startsWith("art:")) {
    const p = art.paintings.find(x => x.id === id.slice(4));
    return p ? `${t(lang, p.ko, p.en)} · ${t(lang, p.artistKo, p.artistEn)}` : id;
  }
  const s = SCULPTURE_NAMES[id.slice(10)];
  return s ? t(lang, s[0], s[1]) : id;
}

/** Full-screen viewing for a painting (zoom to the brushwork) or a sculpture. */
export default function ArtViewer({ id, lang, onClose }: { id: string; lang: Language; onClose: () => void }) {
  const painting: Painting | undefined = id.startsWith("art:") ? art.paintings.find(p => p.id === id.slice(4)) : undefined;
  const sculpture = id.startsWith("sculpture:") ? id.slice(10) : undefined;
  const small = painting ? `${STORAGE_ASSETS}/art/${painting.id}-1k.webp` : `${STORAGE_ASSETS}/art/sculpture-${sculpture}.webp`;
  const full = painting ? `${STORAGE_ASSETS}/art/${painting.id}.jpg` : small;
  const [src, setSrc] = useState(small);
  const [loading, setLoading] = useState(full !== small);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; s: number } | null>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    close.current?.focus();
    if (full === small) return;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => { setSrc(full); setLoading(false); };
    img.onerror = () => setLoading(false);
    img.src = full;
    // Release the decoded full-size picture (tens of MB) when the viewer closes or switches works.
    return () => { img.onload = img.onerror = null; img.src = ""; };
  }, [full, small]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const zoomAt = (factor: number) => setView(v => {
    const s = Math.max(1, Math.min(8, v.s * factor));
    return s === 1 ? { s, x: 0, y: 0 } : { s, x: v.x * s / v.s, y: v.y * s / v.s };
  });
  const down = (e: ReactPointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), s: view.s };
    }
  };
  const move = (e: ReactPointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const s = Math.max(1, Math.min(8, pinch.current.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d));
      setView(v => ({ s, x: s === 1 ? 0 : v.x, y: s === 1 ? 0 : v.y }));
      return;
    }
    if (view.s > 1) setView(v => ({ ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y }));
  };
  const up = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const title = painting ? t(lang, painting.ko, painting.en) : sculpture ? t(lang, ...(SCULPTURE_NAMES[sculpture] ?? [sculpture, sculpture])) : id;
  const shown = useRef<HTMLImageElement>(null);
  useEffect(() => () => { if (shown.current) shown.current.src = ""; }, []);
  return <div className="exchange-art" role="dialog" aria-modal="true" aria-label={title}>
    <div className="exchange-art-stage" onWheel={e => zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18)}
      onDoubleClick={() => setView(v => v.s > 1 ? { s: 1, x: 0, y: 0 } : { s: 2.6, x: 0, y: 0 })}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-zoomed={view.s > 1 || undefined}>
      <img ref={shown} src={src} alt={title} draggable={false} decoding="async" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }} />
    </div>
    <header className="exchange-art-caption">
      <div>
        <h2>{title}</h2>
        {painting && <p>{t(lang, painting.artistKo, painting.artistEn)} · {painting.year}</p>}
        {sculpture && <p>{t(lang, "조형 작품 · Poly Haven CC0", "Sculpture · Poly Haven CC0")}</p>}
      </div>
      <div className="exchange-art-tools">
        {loading && <small>{t(lang, "고해상도 불러오는 중", "Loading full resolution")}</small>}
        <button type="button" className="exchange-action" onClick={() => zoomAt(1 / 1.4)} aria-label={t(lang, "축소", "Zoom out")}>−</button>
        <button type="button" className="exchange-action" onClick={() => zoomAt(1.4)} aria-label={t(lang, "확대", "Zoom in")}>+</button>
        <button ref={close} type="button" className="exchange-action" onClick={onClose} aria-label={t(lang, "닫기", "Close")}>×</button>
      </div>
    </header>
    {painting && <footer className="exchange-art-credit">
      {t(lang, "퍼블릭 도메인 · ", "Public domain · ")}<a href={painting.source} target="_blank" rel="noopener noreferrer">Wikimedia Commons ↗</a>
      <span>{t(lang, "휠·핀치로 확대, 드래그로 이동, 더블클릭으로 붓 터치까지 보기", "Wheel or pinch to zoom, drag to pan, double-click for the brushwork")}</span>
    </footer>}
  </div>;
}
