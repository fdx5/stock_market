import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import art from "./art.json";
import { getArtworkStory } from "./artStories";
import type { FloorDriver } from "./floorEngine";
import { STORAGE_ASSETS, type Language } from "./marketCore";

type Painting = (typeof art.paintings)[number];
type DocentSection = "story" | "details" | "artist";

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

/** Full-screen viewing for a painting (editorial museum wall-label + zero-flicker 1K->4K zoom) or a 360° interactive 3D sculpture studio. */
export default function ArtViewer({
  id,
  lang,
  driver,
  onClose,
}: {
  id: string;
  lang: Language;
  driver?: FloorDriver | null;
  onClose: () => void;
}) {
  const painting: Painting | undefined = id.startsWith("art:") ? art.paintings.find(p => p.id === id.slice(4)) : undefined;
  const sculpture = id.startsWith("sculpture:") ? id.slice(10) : undefined;
  const curated = painting ? getArtworkStory(painting.id) : null;
  const [sculpture3D, setSculpture3D] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [infoOpen, setInfoOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    // Open by default on desktop and portrait mobile; start collapsed only on short landscape phones.
    return !(window.innerHeight <= 520 && window.innerWidth > window.innerHeight);
  });
  const [activeSection, setActiveSection] = useState<DocentSection>("story");

  // Activate 360° 3D Museum Studio directly on the shared WebGPU canvas when inspecting a sculpture
  useEffect(() => {
    if (!sculpture || !driver) {
      setSculpture3D(false);
      return;
    }
    const ok = driver.inspectSculpture(sculpture);
    setSculpture3D(ok);
    setAutoRotate(true);
    return () => {
      driver.inspectSculpture(null);
    };
  }, [sculpture, driver]);

  // Painting: layer 1K base underneath + pre-decoded 4K full image on top -> ZERO second flicker!
  const small = painting ? `${STORAGE_ASSETS}/art/${painting.id}-1k.webp` : `${STORAGE_ASSETS}/art/sculpture-${sculpture}.webp`;
  const full = painting ? `${STORAGE_ASSETS}/art/${painting.id}.jpg` : small;
  const [fullReady, setFullReady] = useState(false);
  const [loading, setLoading] = useState(Boolean(painting && full !== small));
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number; button: number }>());
  const pinch = useRef<{ d: number; s: number } | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const docentBodyRef = useRef<HTMLDivElement>(null);
  const storyRef = useRef<HTMLElement>(null);
  const detailsRef = useRef<HTMLElement>(null);
  const artistRef = useRef<HTMLElement>(null);
  const scrollLockUntil = useRef(0);

  useEffect(() => {
    close.current?.focus();
    setFullReady(false);
    if (!painting || full === small) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const img = new Image();
    img.decoding = "async";
    img.src = full;
    const reveal = () => {
      if (cancelled) return;
      // Decode full 3840px JPEG off-DOM before mounting the top layer -> eliminates the repaint flash completely!
      const decodePromise = typeof img.decode === "function" ? img.decode() : Promise.resolve();
      void decodePromise.catch(() => {}).finally(() => {
        if (cancelled) return;
        setFullReady(true);
        setLoading(false);
      });
    };
    if (img.complete && img.naturalWidth > 0) reveal();
    else {
      img.onload = reveal;
      img.onerror = () => { if (!cancelled) setLoading(false); };
    }
    return () => {
      cancelled = true;
      img.onload = img.onerror = null;
      img.src = "";
    };
  }, [painting, full, small]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (painting && curated && (e.key === "i" || e.key === "I") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setInfoOpen(v => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose, painting, curated]);

  useEffect(() => {
    if (infoOpen) setActiveSection("story");
  }, [infoOpen]);

  const zoomAt = (factor: number) => {
    if (sculpture3D && driver) {
      driver.sculptureControl({ type: "zoom", factor });
      return;
    }
    setView(v => {
      const s = Math.max(1, Math.min(8, v.s * factor));
      return s === 1 ? { s, x: 0, y: 0 } : { s, x: v.x * s / v.s, y: v.y * s / v.s };
    });
  };

  const resetZoom = () => setView({ s: 1, x: 0, y: 0 });

  const down = (e: ReactPointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), s: view.s };
    }
  };

  const move = (e: ReactPointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, button: prev.button });

    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const nextD = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      if (sculpture3D && driver) {
        driver.sculptureControl({ type: "zoom", factor: nextD / pinch.current.d });
        pinch.current.d = nextD;
      } else {
        const s = Math.max(1, Math.min(8, pinch.current.s * nextD / pinch.current.d));
        setView(v => ({ s, x: s === 1 ? 0 : v.x, y: s === 1 ? 0 : v.y }));
      }
      return;
    }

    if (sculpture3D && driver) {
      if (prev.button === 2 || e.shiftKey) {
        driver.sculptureControl({ type: "pan", dx, dy });
      } else {
        setAutoRotate(false);
        driver.sculptureControl({ type: "orbit", dx, dy });
      }
      return;
    }

    if (view.s > 1) setView(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };

  const up = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const jumpToSection = (section: DocentSection) => {
    setActiveSection(section);
    scrollLockUntil.current = Date.now() + 500;
    const target = section === "story" ? storyRef.current : section === "details" ? detailsRef.current : artistRef.current;
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleDocentScroll = () => {
    if (Date.now() < scrollLockUntil.current) return;
    const container = docentBodyRef.current;
    if (!container) return;
    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 16;
    const offset = container.scrollTop + 48;
    const artistTop = artistRef.current?.offsetTop ?? Infinity;
    const detailsTop = detailsRef.current?.offsetTop ?? Infinity;
    if (atBottom || offset >= artistTop - 24) setActiveSection("artist");
    else if (offset >= detailsTop - 24) setActiveSection("details");
    else setActiveSection("story");
  };

  const title = painting ? t(lang, painting.ko, painting.en) : sculpture ? t(lang, ...(SCULPTURE_NAMES[sculpture] ?? [sculpture, sculpture])) : id;
  const secondaryTitle = painting ? (lang === "ko" ? painting.en : painting.ko) : "";
  const artistName = painting ? t(lang, painting.artistKo, painting.artistEn) : "";
  const showDocent = Boolean(painting && curated && infoOpen);

  const toggleRotate = () => {
    if (!driver) return;
    const next = !autoRotate;
    setAutoRotate(next);
    driver.sculptureControl({ type: "autoRotate", on: next });
  };

  const reset3D = () => {
    driver?.sculptureControl({ type: "reset" });
  };

  return (
    <div
      className="exchange-art"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-painting={painting ? "true" : undefined}
      data-info-open={showDocent ? "true" : undefined}
      data-sculpture3d={sculpture3D || undefined}
    >
      {showDocent && painting && curated && (
        <aside className="exchange-art-docent" aria-label={t(lang, "작품 해설 및 화가 소개", "Artwork story & artist notes")}>
          <div className="exchange-art-docent-head">
            <div className="exchange-art-docent-kicker">
              <span>{t(lang, curated.story.movementKo, curated.story.movementEn)} · {painting.year}</span>
              <button
                type="button"
                className="exchange-art-docent-hide"
                onClick={() => setInfoOpen(false)}
                aria-label={t(lang, "해설 숨기기", "Hide notes")}
                title={t(lang, "작품만 크게 보기 (I)", "Expand painting (I)")}
              >
                {t(lang, "숨기기", "Hide")}
              </button>
            </div>
            <h2 className="exchange-art-docent-title">{title}</h2>
            <p className="exchange-art-docent-sub">{secondaryTitle}</p>
            <p className="exchange-art-docent-byline">
              {artistName}
              <span>{curated.artist.lifespan}</span>
            </p>
            <nav className="exchange-art-docent-nav" aria-label={t(lang, "해설 목차", "Guide sections")}>
              <button
                type="button"
                aria-current={activeSection === "story" ? "true" : undefined}
                onClick={() => jumpToSection("story")}
              >
                {t(lang, "작품 이야기", "Story")}
              </button>
              <button
                type="button"
                aria-current={activeSection === "details" ? "true" : undefined}
                onClick={() => jumpToSection("details")}
              >
                {t(lang, "세부 감상", "Details")}
              </button>
              <button
                type="button"
                aria-current={activeSection === "artist" ? "true" : undefined}
                onClick={() => jumpToSection("artist")}
              >
                {t(lang, "화가", "Artist")}
              </button>
            </nav>
          </div>

          <div
            ref={docentBodyRef}
            className="exchange-art-docent-body"
            onScroll={handleDocentScroll}
          >
            <section ref={storyRef} className="exchange-art-section exchange-art-story">
              <p className="exchange-art-standfirst">
                {t(lang, curated.story.leadKo, curated.story.leadEn)}
              </p>
              {(lang === "ko" ? curated.story.storyKo : curated.story.storyEn).map((paragraph, idx) => (
                <p key={idx} className="exchange-art-prose">{paragraph}</p>
              ))}
            </section>

            <section ref={detailsRef} className="exchange-art-section">
              <div className="exchange-art-section-head">
                <h3>{t(lang, "그림 속 볼거리", "Closer Look")}</h3>
                <span>{t(lang, "우측 원화를 확대해 살펴보세요", "Zoom the canvas to inspect")}</span>
              </div>
              <ul className="exchange-art-details">
                {curated.story.details.map((item, idx) => (
                  <li key={idx}>
                    <strong>{t(lang, item.titleKo, item.titleEn)}</strong>
                    <p>{t(lang, item.textKo, item.textEn)}</p>
                  </li>
                ))}
              </ul>
            </section>

            <section ref={artistRef} className="exchange-art-section">
              <div className="exchange-art-section-head">
                <h3>{artistName}</h3>
                <span>{t(lang, curated.artist.originKo, curated.artist.originEn)}, {curated.artist.lifespan}</span>
              </div>
              <p className="exchange-art-prose">
                {t(lang, curated.artist.bioKo, curated.artist.bioEn)}
              </p>
              <p className="exchange-art-traits">
                {(lang === "ko" ? curated.artist.keywordsKo : curated.artist.keywordsEn).join(" · ")}
              </p>
            </section>

            <dl className="exchange-art-colophon">
              <div>
                <dt>{t(lang, "소장", "Collection")}</dt>
                <dd>{t(lang, curated.story.collectionKo, curated.story.collectionEn)}</dd>
              </div>
              <div>
                <dt>{t(lang, "기법", "Medium")}</dt>
                <dd>{t(lang, curated.story.mediumKo, curated.story.mediumEn)}</dd>
              </div>
            </dl>
          </div>
        </aside>
      )}

      <div className="exchange-art-workspace">
        <div
          className="exchange-art-stage"
          onContextMenu={e => { if (sculpture3D) e.preventDefault(); }}
          onWheel={e => zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18)}
          onDoubleClick={() => {
            if (sculpture3D) reset3D();
            else setView(v => v.s > 1 ? { s: 1, x: 0, y: 0 } : { s: 2.6, x: 0, y: 0 });
          }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          data-zoomed={sculpture3D || view.s > 1 || undefined}
        >
          {!sculpture3D && (
            <div className="exchange-art-frame" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}>
              <img className="exchange-art-base" src={small} alt={title} draggable={false} decoding="sync" />
              {fullReady && full !== small && (
                <img className="exchange-art-full" src={full} alt="" aria-hidden="true" draggable={false} decoding="sync" />
              )}
            </div>
          )}
        </div>

        <header className="exchange-art-caption">
          <div className="exchange-art-caption-title">
            {(!showDocent || !painting) ? (
              <>
                <h2>{title}</h2>
                {painting && <p>{artistName} · {painting.year}</p>}
                {sculpture && (
                  <p>
                    {sculpture3D
                      ? t(lang, "360° 3D 인터랙티브 조형물 감상 · Poly Haven CC0", "360° Interactive 3D Sculpture · Poly Haven CC0")
                      : t(lang, "조형 작품 · Poly Haven CC0", "Sculpture · Poly Haven CC0")}
                  </p>
                )}
              </>
            ) : (
              view.s > 1.01 && (
                <button
                  type="button"
                  className="exchange-art-zoom-chip"
                  onClick={resetZoom}
                  title={t(lang, "원래 크기로 돌아가기", "Reset zoom")}
                >
                  {view.s.toFixed(1)}× · {t(lang, "원본 크기", "Reset")}
                </button>
              )
            )}
          </div>
          <div className="exchange-art-tools">
            {loading && <small>{t(lang, "고해상도 불러오는 중", "Loading high-res")}</small>}
            {!showDocent && painting && view.s > 1.01 && (
              <button
                type="button"
                className="exchange-art-btn exchange-art-pill"
                onClick={resetZoom}
              >
                {view.s.toFixed(1)}×
              </button>
            )}
            {painting && curated && (
              <button
                type="button"
                className="exchange-art-btn exchange-art-pill"
                aria-pressed={infoOpen}
                onClick={() => setInfoOpen(v => !v)}
              >
                {infoOpen ? t(lang, "해설 닫기", "Hide notes") : t(lang, "작품 해설", "Notes")}
              </button>
            )}
            {sculpture3D && (
              <>
                <button type="button" className="exchange-action exchange-art-pill" aria-pressed={autoRotate} onClick={toggleRotate}>
                  {t(lang, "360° 회전", "Auto spin")}
                </button>
                <button type="button" className="exchange-action exchange-art-pill" onClick={reset3D}>
                  {t(lang, "정면", "Reset")}
                </button>
              </>
            )}
            <button type="button" className={painting ? "exchange-art-btn" : "exchange-action"} onClick={() => zoomAt(1 / 1.4)} aria-label={t(lang, "축소", "Zoom out")}>−</button>
            <button type="button" className={painting ? "exchange-art-btn" : "exchange-action"} onClick={() => zoomAt(1.4)} aria-label={t(lang, "확대", "Zoom in")}>+</button>
            <button ref={close} type="button" className={painting ? "exchange-art-btn" : "exchange-action"} onClick={onClose} aria-label={t(lang, "닫기", "Close")}>×</button>
          </div>
        </header>

        {painting && (
          <footer className="exchange-art-credit">
            <span>
              {t(lang, "퍼블릭 도메인 · ", "Public domain · ")}
              <a href={painting.source} target="_blank" rel="noopener noreferrer">Wikimedia Commons ↗</a>
            </span>
            <span>{t(lang, "휠 확대 · 드래그 이동 · 더블클릭 붓질 감상", "Wheel to zoom · drag to pan · double-click for brushwork")}</span>
          </footer>
        )}
        {sculpture3D && (
          <footer className="exchange-art-credit">
            <span>{t(lang, "360° 3D 뮤지엄 스튜디오 · Poly Haven CC0", "360° 3D Museum Studio · Poly Haven CC0")}</span>
            <span>{t(lang, "드래그 360° 자유 회전 · 휠/핀치 확대 · 우클릭/Shift 이동 · 더블클릭 정면 초기화", "Drag to orbit 360° · wheel/pinch to zoom · right-drag/Shift to pan · double-click to reset")}</span>
          </footer>
        )}
      </div>
    </div>
  );
}
