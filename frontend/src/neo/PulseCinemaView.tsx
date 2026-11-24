import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { MarketMapItem } from "../api/client";
import { Link } from "../router";
import { pct, toneOf } from "../desk2/lib";
import { hasReturn, quoteColor, quotePct } from "./marketQuote";
import StockLogo from "../components/StockLogo";
import type { BoardMarket } from "./pulseBoardData";
import type { Mood } from "./pulseHorizonShaders";
import type { KospiHeaderQuote } from "../useKospiNight";
import "./pulseCinema.css";

export type CinemaCamPreset = "auto" | "orbit" | "low" | "close" | "manual";

type MarketTabInfo = {
  key: BoardMarket;
  label: string;
  price?: number | null;
  change?: number | null;
};

type Props = {
  open: boolean;
  variant: "sea" | "deep";
  lang: "ko" | "en";
  mood: Mood;
  market: BoardMarket;
  markets: MarketTabInfo[];
  futures: KospiHeaderQuote[];
  stocks: MarketMapItem[];
  up: number;
  down: number;
  knownCount: number;
  focusedCode: string | null;
  camPreset: CinemaCamPreset;
  onCamPreset: (preset: CinemaCamPreset) => void;
  onSelectMarket: (market: BoardMarket) => void;
  onFocusStock: (code: string | null) => void;
  onClose: () => void;
};

const fmtPrice = (value?: number | null) =>
  value != null && Number.isFinite(value) && value > 0
    ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "—";

const SPOTLIGHT_MS = 7000;

function useKstClock() {
  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour12: false }),
  );
  useEffect(() => {
    const id = window.setInterval(() => {
      setClock(new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour12: false }));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);
  return clock;
}

export default function PulseCinemaView({
  open,
  variant,
  lang,
  mood,
  market,
  markets,
  futures,
  stocks,
  up,
  down,
  knownCount,
  focusedCode,
  camPreset,
  onCamPreset,
  onSelectMarket,
  onFocusStock,
  onClose,
}: Props) {
  const L = (ko: string, en: string) => (lang === "ko" ? ko : en);
  const clock = useKstClock();

  const [cleanView, setCleanView] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [syncSceneMood, setSyncSceneMood] = useState(false);
  const [letterbox, setLetterbox] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [idle, setIdle] = useState(false);
  const [spotIdx, setSpotIdx] = useState(0);
  const idleTimer = useRef(0);

  // Curate top 20 spotlight candidates: blend top market-cap leaders + biggest movers
  const spotlightPool = useMemo(() => {
    if (!stocks.length) return [];
    const byCap = stocks.slice(0, 12);
    const seen = new Set(byCap.map(s => s.code));
    const movers = [...stocks]
      .filter(s => hasReturn(s) && !seen.has(s.code))
      .sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct))
      .slice(0, 8);
    return [...byCap, ...movers];
  }, [stocks]);

  const tickerItems = useMemo(() => stocks.slice(0, 24), [stocks]);
  const currentSpot = useMemo(() => {
    if (focusedCode) {
      const hit = stocks.find(s => s.code === focusedCode);
      if (hit) return hit;
    }
    if (!spotlightPool.length) return null;
    return spotlightPool[spotIdx % spotlightPool.length];
  }, [focusedCode, stocks, spotlightPool, spotIdx]);

  // Reset spotlight index when switching market
  useEffect(() => {
    setSpotIdx(0);
  }, [market]);

  // Toggle root html.pb-cinema class & lock background body scroll while Cinema View is open
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.classList.add("pb-cinema");
    root.dataset.pbCinemaVariant = variant;
    return () => {
      root.classList.remove("pb-cinema");
      delete root.dataset.pbCinemaVariant;
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, [open, variant]);

  // Sync spotlight stock to 3D scene mood if "종목 무드 연동" is enabled
  useEffect(() => {
    if (!open) return;
    if (syncSceneMood && currentSpot) {
      if (focusedCode !== currentSpot.code) onFocusStock(currentSpot.code);
    } else if (!syncSceneMood && focusedCode) {
      onFocusStock(null);
    }
  }, [open, syncSceneMood, currentSpot, focusedCode, onFocusStock]);

  // Auto-advance spotlight every 7s when playing
  useEffect(() => {
    if (!open || !playing || spotlightPool.length <= 1) return;
    const id = window.setInterval(() => {
      setSpotIdx(prev => (prev + 1) % spotlightPool.length);
      if (!syncSceneMood) onFocusStock(null);
    }, SPOTLIGHT_MS);
    return () => window.clearInterval(id);
  }, [open, playing, spotlightPool.length, syncSceneMood, onFocusStock]);

  // Auto-dim controls after 4.2s of pointer inactivity for pure cinema immersion
  useEffect(() => {
    if (!open) return;
    const wake = () => {
      setIdle(false);
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setIdle(true), 4200);
    };
    wake();
    window.addEventListener("pointermove", wake, { passive: true });
    window.addEventListener("pointerdown", wake, { passive: true });
    window.addEventListener("keydown", wake);
    return () => {
      window.clearTimeout(idleTimer.current);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [open]);

  // Sync browser Fullscreen state
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const stepSpot = (delta: number) => {
    if (!spotlightPool.length) return;
    const nextIdx = (spotIdx + delta + spotlightPool.length) % spotlightPool.length;
    setSpotIdx(nextIdx);
    const nextItem = spotlightPool[nextIdx];
    if (syncSceneMood && nextItem) onFocusStock(nextItem.code);
    else onFocusStock(null);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    }
  };

  // Cinema keyboard shortcuts: ESC exit, Space play/pause, Left/Right prev/next, H clean view, F fullscreen
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest("input,textarea,select,[contenteditable]")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        setPlaying(p => !p);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        stepSpot(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        stepSpot(-1);
      } else if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        setCleanView(c => !c);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, spotIdx, spotlightPool.length, syncSceneMood]);

  if (!open || typeof document === "undefined") return null;

  const activeMarket = markets.find(m => m.key === market) ?? markets[0];
  const primaryFuture = futures[0];
  const spotKnown = currentSpot ? hasReturn(currentSpot) : false;
  const spotTone = currentSpot ? toneOf(spotKnown ? currentSpot.change_pct : undefined) : "flat";
  const spotRank = currentSpot ? stocks.findIndex(s => s.code === currentSpot.code) + 1 : 0;
  const moneyFmt = (n: number) =>
    market === "nasdaq100"
      ? `${n.toFixed(2)}%`
      : n >= 1e12
        ? `${(n / 1e12).toFixed(1)}${L("조", "T")}`
        : `${(n / 1e8).toFixed(0)}${L("억", "×100M")}`;

  const camPresets: { id: CinemaCamPreset; label: string }[] = [
    { id: "auto", label: L("자동 시네마", "Auto") },
    { id: "orbit", label: L("360° 오빗", "Orbit") },
    { id: "low", label: L("로우앵글", "Low") },
    { id: "close", label: L("클로즈업", "Close") },
    { id: "manual", label: L("자유 시점", "Free") },
  ];

  const flatCount = Math.max(0, knownCount - up - down);

  return createPortal(
    <div
      className={`pb-cinema-layer${cleanView ? " is-clean" : ""}${idle ? " is-idle" : ""}${letterbox ? " has-letterbox" : ""}`}
      data-mood={mood}
      role="dialog"
      aria-modal="false"
      aria-label={L("증시 전광판 시네마뷰", "Pulse Board Cinema View")}
    >
      {/* Subtle Anamorphic Cinema Vignette & Letterbox Frame */}
      <div className="pb-cinema-vignette" aria-hidden="true" />
      <div className="pb-cinema-bar pb-cinema-bar--top" aria-hidden="true" />
      <div className="pb-cinema-bar pb-cinema-bar--bottom" aria-hidden="true" />

      {/* Top Broadcast HUD Bar */}
      <header className="pb-cinema-top pb-cinema-ui">
        <div className="pb-cinema-brand-group">
          <div className="pb-cinema-badge">
            <i className="pb-cinema-live-dot" aria-hidden="true" />
            <strong>KOSPIMAP</strong>
            <span>CINEMA</span>
            <time className="pb-cinema-clock">{clock} KST</time>
          </div>

          <div className="pb-cinema-markets" role="tablist" aria-label={L("시장 전환", "Switch market")}>
            {markets.map(m => {
              const selected = m.key === market;
              return (
                <button
                  key={m.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`pb-cinema-mkt${selected ? " is-active" : ""}`}
                  onClick={() => onSelectMarket(m.key)}
                >
                  <span className="pb-cinema-mkt-name">{m.label}</span>
                  <strong>{fmtPrice(m.price)}</strong>
                  <b className={`is-${toneOf(m.change)}`}>{quotePct(m.change)}</b>
                </button>
              );
            })}
          </div>

          {primaryFuture && (
            <div className="pb-cinema-future" title={L("코스피200 선물 시세", "KOSPI 200 Futures")}>
              <span>{primaryFuture.session === "day" ? L("선물", "FUT") : L("야간선물", "NIGHT")}</span>
              <strong>{primaryFuture.quote.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              <b className={`is-${toneOf(primaryFuture.quote.change_pct)}`}>{quotePct(primaryFuture.quote.change_pct)}</b>
            </div>
          )}
        </div>

        <div className="pb-cinema-controls">
          {variant === "deep" && (
            <div className="pb-cinema-cam-pills" role="radiogroup" aria-label={L("시네마 카메라 앵글", "Cinema camera angle")}>
              {camPresets.map(p => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={camPreset === p.id}
                  className={camPreset === p.id ? "is-on" : ""}
                  onClick={() => onCamPreset(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            className={`pb-cinema-btn${letterbox ? " is-on" : ""}`}
            aria-pressed={letterbox}
            onClick={() => setLetterbox(v => !v)}
            title={L("2.39:1 시네마 레터박스 프레임 토글", "Toggle 2.39:1 cinema letterbox frame")}
          >
            2.39:1
          </button>

          <button
            type="button"
            className={`pb-cinema-btn${cleanView ? " is-on" : ""}`}
            aria-pressed={cleanView}
            onClick={() => setCleanView(v => !v)}
            title={L("HUD 숨김/표시 (H)", "Toggle clean view (H)")}
          >
            {cleanView ? L("HUD 켜기", "Show HUD") : L("클린뷰", "Clean")}
          </button>

          <button
            type="button"
            className={`pb-cinema-btn${isFullscreen ? " is-on" : ""}`}
            aria-pressed={isFullscreen}
            onClick={toggleFullscreen}
            title={L("전체화면 전환 (F)", "Toggle fullscreen (F)")}
          >
            {isFullscreen ? L("창모드", "Window") : L("전체화면", "Fullscreen")}
          </button>

          <button
            type="button"
            className="pb-cinema-btn pb-cinema-exit"
            onClick={onClose}
            title={L("시네마뷰 닫기 (ESC)", "Exit Cinema View (ESC)")}
          >
            ✕ {L("나가기", "Exit")}
          </button>
        </div>
      </header>

      {/* Clean-View Floating Restore Pill (visible on hover when HUD is hidden) */}
      {cleanView && (
        <div className="pb-cinema-clean-dock pb-cinema-ui">
          <button type="button" className="pb-cinema-btn is-on" onClick={() => setCleanView(false)}>
            {L("HUD 복원 (H)", "Show HUD (H)")}
          </button>
          <button type="button" className="pb-cinema-btn pb-cinema-exit" onClick={onClose}>
            ✕ {L("시네마뷰 종료", "Exit")}
          </button>
        </div>
      )}

      {/* Lower-Left Luxury Glass Stock Spotlight Card */}
      {!cleanView && currentSpot && (
        <aside
          className={`pb-cinema-spot pb-cinema-ui is-${spotTone}`}
          style={{ "--spot-color": quoteColor(currentSpot) } as CSSProperties}
          aria-live="polite"
        >
          <div className="pb-cinema-spot-head">
            <span className="pb-cinema-spot-kicker">
              {activeMarket?.label} · {spotRank > 0 ? `TOP #${spotRank}` : L("스포트라이트", "SPOTLIGHT")}
              {currentSpot.sector ? ` · ${currentSpot.sector}` : ""}
            </span>
            <div className="pb-cinema-spot-nav">
              <button
                type="button"
                className={`pb-cinema-mood-link${syncSceneMood ? " is-on" : ""}`}
                aria-pressed={syncSceneMood}
                onClick={() => setSyncSceneMood(v => !v)}
                title={L("선택 종목 등락에 맞춰 3D 배경 무드 동기화", "Sync 3D scene mood to spotlight stock")}
              >
                {syncSceneMood ? L("배경 연동 ON", "Mood Sync") : L("지수 기준", "Index Mood")}
              </button>
              <button type="button" onClick={() => stepSpot(-1)} aria-label={L("이전 종목", "Previous stock")}>‹</button>
              <button
                type="button"
                onClick={() => setPlaying(p => !p)}
                aria-label={playing ? L("자동 순환 일시정지", "Pause spotlight") : L("자동 순환 재생", "Play spotlight")}
              >
                {playing ? "❚❚" : "▶"}
              </button>
              <button type="button" onClick={() => stepSpot(1)} aria-label={L("다음 종목", "Next stock")}>›</button>
            </div>
          </div>

          <div className="pb-cinema-spot-body">
            <StockLogo code={currentSpot.code} name={currentSpot.name} className="pb-cinema-spot-logo" />
            <div className="pb-cinema-spot-info">
              <div className="pb-cinema-spot-title">
                <strong>{market === "nasdaq100" ? currentSpot.code : currentSpot.name}</strong>
                {market === "nasdaq100" && <small>{currentSpot.name}</small>}
              </div>
              <div className="pb-cinema-spot-nums">
                <span className="pb-cinema-spot-price">{fmtPrice(currentSpot.close)}</span>
                <b className={`pb-cinema-spot-pct is-${spotTone}`}>
                  {spotKnown ? pct(currentSpot.change_pct) : "—"}
                </b>
              </div>
            </div>
          </div>

          <div className="pb-cinema-spot-meta">
            <span>{market === "nasdaq100" ? L("지수 비중", "Weight") : L("시가총액", "Mkt Cap")} <b>{moneyFmt(currentSpot.marcap)}</b></span>
            <div className="pb-cinema-breadth" title={L("시장 등락 분포", "Market breadth")}>
              <b className="sc-up">↑{up}</b>
              <div className="pb-cinema-breadth-bar">
                <i className="sc-up" style={{ flex: up }} />
                <i className="sc-flat" style={{ flex: flatCount }} />
                <i className="sc-down" style={{ flex: down }} />
              </div>
              <b className="sc-down">↓{down}</b>
            </div>
            <Link
              className="pb-cinema-detail-link"
              to={`/stock/${encodeURIComponent(currentSpot.code)}`}
              onClick={onClose}
            >
              {L("상세", "Detail")} ↗
            </Link>
          </div>

          {/* Smooth progress bar for next auto-spotlight */}
          {playing && (
            <div className="pb-cinema-progress" aria-hidden="true">
              <i key={`${market}:${currentSpot.code}:${spotIdx}`} style={{ animationDuration: `${SPOTLIGHT_MS}ms` }} />
            </div>
          )}
        </aside>
      )}

      {/* Lower-Right Subtle Shortcut Legend */}
      {!cleanView && (
        <div className="pb-cinema-keys pb-cinema-ui" aria-hidden="true">
          <span><b>DRAG</b> {L("시점 회전", "Orbit")}</span>
          <span><b>WHEEL</b> {L("줌", "Zoom")}</span>
          <span><b>SPACE</b> {L("순환", "Play")}</span>
          <span><b>H</b> {L("클린뷰", "Clean")}</span>
          <span><b>ESC</b> {L("종료", "Exit")}</span>
        </div>
      )}

      {/* Bottom 60 FPS GPU-Composited Infinite Live Market Ticker Ribbon */}
      {!cleanView && tickerItems.length > 0 && (
        <div className="pb-cinema-ticker pb-cinema-ui" aria-label={L("실시간 종목 티커", "Live stock ticker")}>
          <div className="pb-cinema-ticker-track">
            {[0, 1].map(loop => (
              <div key={loop} className="pb-cinema-ticker-set" aria-hidden={loop === 1}>
                {tickerItems.map(item => {
                  const ok = hasReturn(item);
                  const active = currentSpot?.code === item.code;
                  return (
                    <button
                      key={`${loop}-${item.code}`}
                      type="button"
                      className={`pb-cinema-tick${active ? " is-active" : ""}`}
                      onClick={() => {
                        const idx = spotlightPool.findIndex(s => s.code === item.code);
                        if (idx >= 0) setSpotIdx(idx);
                        onFocusStock(item.code);
                        setPlaying(false);
                      }}
                    >
                      <StockLogo code={item.code} name={item.name} className="pb-cinema-tick-logo" />
                      <span className="pb-cinema-tick-name">{market === "nasdaq100" ? item.code : item.name}</span>
                      <span className="pb-cinema-tick-price">{fmtPrice(item.close)}</span>
                      <b className={`is-${toneOf(ok ? item.change_pct : undefined)}`}>{ok ? pct(item.change_pct) : "—"}</b>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
