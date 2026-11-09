import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { MarketMapItem } from "../api/client";
import { Link, navigate } from "../router";
import { useLanguage } from "../i18n/LanguageContext";
import { useMarketIndices } from "../useMarketIndices";
import { useMarketTicker } from "../useMarketTicker";
import { pct, toneOf } from "../desk2/lib";
import { hasReturn, quoteColor, quotePct, tickerChangePct } from "./marketQuote";
import { useFxLevel } from "./settings";
import StockLogo from "../components/StockLogo";
import NeoPulseHorizon from "./NeoPulseHorizon";
import PulseShip from "./PulseShip";
import type { ShipCargo, ShipState } from "./pulseShipScene";
import { stockIconUrl } from "../stockIcon";
import { usCompanyLogoProxyUrl } from "../usLogo";
import type { PulseHorizonController } from "./pulseHorizonRenderer";
import type { Mood } from "./pulseHorizonShaders";
import { boardStocks, usePulseBoardMarket, type BoardMarket } from "./pulseBoardData";
import "./marketScanner.css";
import "./marketScannerFx.css";
import "./marketScannerNeon.css";
import "./pulseBoard.css";

const MARKETS = [{ key: "kospi", label: "KOSPI", region: "KR" }, { key: "kosdaq", label: "KOSDAQ", region: "KR" }, { key: "nasdaq100", label: "NASDAQ 100", region: "US" }] as const;
// Phones and tablets (touch screens up to iPad Pro size, or any narrow view) open with 30 cells so the
// ship stays in sight; desktops open with 50. "More" always reveals all 100.
const COMPACT_QUERY = "(max-width: 899px), (pointer: coarse) and (max-width: 1366px) and (max-height: 1366px)";
const PHONE_QUERY = "(max-width: 699px), (max-height: 499px) and (pointer: coarse)";
function useMedia(query: string) {
  const [matches, setMatches] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query), update = () => setMatches(media.matches);
    media.addEventListener("change", update); return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}
/** Phones open with 20 cells, tablets with 30, desktops with 50. */
function useDefaultCells() {
  const phone = useMedia(PHONE_QUERY), compact = useMedia(COMPACT_QUERY);
  return phone ? 20 : compact ? 30 : 50;
}
const MOOD_NAME: Record<Mood, [string, string]> = { down: ["푸른 펄스 바다", "Blue pulse sea"], calm: ["보라 펄스 바다", "Violet pulse sea"], up: ["레드·골드 펄스 바다", "Red-gold pulse sea"] };
/** The sea's colour rule: −1% or lower is blue, +1% or higher is red-gold, violet between. */
export const moodOf = (change?: number | null): Mood => change == null || !Number.isFinite(change) ? "calm" : change <= -1 ? "down" : change >= 1 ? "up" : "calm";
const price = (value?: number | null) => value != null && Number.isFinite(value) && value > 0 ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—";

/** The focused company bobs on the sea, leaving small wakes as it drifts. */
function FloatingCompany({ item, market, controller, onClose, lang }: {
  item: MarketMapItem; market: BoardMarket; controller: React.MutableRefObject<PulseHorizonController | null>; onClose: () => void; lang: "ko" | "en";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fx = useFxLevel();
  useEffect(() => {
    const element = ref.current; if (!element) return;
    const still = fx === "minimal" || matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0, wake = 0;
    const start = performance.now(), seed = Math.random() * 100;
    const step = (now: number) => {
      const t = (now - start) / 1000 + seed;
      const width = innerWidth, card = element.offsetWidth;
      const room = Math.max(0, width - card - 24);
      // a slow figure-eight drift, a bob on the swell and a gentle roll
      const x = 12 + room * (.5 + .42 * Math.sin(t * .11) * Math.cos(t * .043));
      const y = Math.sin(t * .85) * 9 + Math.sin(t * .37 + 1.3) * 6;
      const roll = Math.sin(t * .7 + .4) * 3.2;
      element.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(${roll.toFixed(2)}deg)`;
      if (t - wake > 3.4) { wake = t; controller.current?.emit((x + card / 2) / width, .32, false); }
      frame = requestAnimationFrame(step);
    };
    if (still) element.style.transform = `translate3d(${Math.max(12, (innerWidth - element.offsetWidth) / 2)}px,0,0)`;
    else frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [item.code, fx, controller]);
  const known = hasReturn(item);
  return <div className="pb-float-lane" aria-live="polite">
    <div ref={ref} className={`pb-float is-${toneOf(known ? item.change_pct : undefined)}`} style={{ "--sc-color": quoteColor(item) } as CSSProperties}>
      <i className="pb-float-halo" aria-hidden="true" />
      <StockLogo code={item.code} name={item.name} className="pb-float-logo" />
      <div className="pb-float-text"><strong>{market === "nasdaq100" ? `${item.code} · ${item.name}` : item.name}</strong><span>{price(item.close)} <b>{known ? pct(item.change_pct) : "—"}</b></span></div>
      <Link className="pb-float-link" to={`/stock/${encodeURIComponent(item.code)}`}>{lang === "ko" ? "상세" : "Details"} ↗</Link>
      <button type="button" className="pb-float-close" onClick={onClose} aria-label={lang === "ko" ? "선택 해제" : "Clear selection"}>×</button>
      <i className="pb-float-ripple" aria-hidden="true" />
    </div>
  </div>;
}

export default function PulseBoardPage() {
  const { lang } = useLanguage(), L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const fx = useFxLevel();
  const [market, setMarket] = useState<BoardMarket>("kospi");
  const [order, setOrder] = useState<"cap" | "return">("cap");
  const [focused, setFocused] = useState<string | null>(null);
  // 50 cells by default keeps the sea visible; the rest open on request.
  const [showAll, setShowAll] = useState(false);
  const DEFAULT_CELLS = useDefaultCells();
  const [columns, setColumns] = useState(8);
  const controller = useRef<PulseHorizonController | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const ledger = useRef(new Map<string, string>()), lastHover = useRef(0), introduced = useRef<string | null>(null);
  const snapshot = usePulseBoardMarket(market);
  const indices = useMarketIndices(), ticker = useMarketTicker();
  const ndx = ticker.find(item => item.symbol === "^NDX");
  const quotes = { kospi: { price: indices.kospi?.close, change: indices.kospi?.change_pct }, kosdaq: { price: indices.kosdaq?.close, change: indices.kosdaq?.change_pct }, nasdaq100: { price: ndx?.price, change: tickerChangePct(ndx) } };
  const stocks = useMemo(() => boardStocks(snapshot.items), [snapshot.items]);
  const visible = useMemo(() => order === "cap" ? stocks : [...stocks].sort((a, b) => Number(hasReturn(b)) - Number(hasReturn(a)) || (hasReturn(a) && hasReturn(b) ? b.change_pct - a.change_pct : 0)), [stocks, order]);
  const focusItem = stocks.find(item => item.code === focused) ?? null;
  const known = stocks.filter(hasReturn);
  const up = known.filter(item => item.change_pct > 0).length, down = known.filter(item => item.change_pct < 0).length;
  const basis = focusItem && hasReturn(focusItem) ? focusItem.change_pct : quotes[market].change;
  const mood = moodOf(basis);
  // Wider average moves raise the swell: a quiet session is a calm sea.
  // Capped so the swell stays seaworthy: the container ship rides it, it must never look like a storm.
  const energy = known.length ? .78 + Math.min(1, known.reduce((sum, item) => sum + Math.abs(item.change_pct), 0) / known.length / 2.6) * .42 : .9;
  const maxCap = Math.max(1, ...stocks.map(item => item.marcap));
  // The ship carries the top 20 by market cap; a selected stock fills every container and names the hull.
  const cargoOf = (item: MarketMapItem): ShipCargo => ({ code: item.code, name: item.name, label: market === "nasdaq100" ? item.code : item.name, change: hasReturn(item) ? item.change_pct : null, logo: market === "nasdaq100" ? usCompanyLogoProxyUrl(item.code) : stockIconUrl(item.code), color: quoteColor(item) });
  const marketLabel = MARKETS.find(item => item.key === market)!.label;
  const ship: ShipState = useMemo(() => focusItem
    ? { mood, focus: true, hullName: focusItem.name, hullLogo: cargoOf(focusItem).logo, hullSub: `${marketLabel} · ${hasReturn(focusItem) ? pct(focusItem.change_pct) : "—"} · K-STOCK HUB`, cargo: Array.from({ length: 20 }, () => cargoOf(focusItem)) }
    : { mood, focus: false, hullName: marketLabel, hullLogo: "/neo/kstock-favicon.svg", hullSub: "K-STOCK HUB · PULSE LINE", cargo: stocks.slice(0, 20).map(cargoOf) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [mood, focusItem?.code, focusItem?.change_pct, market, stocks]);
  const money = (n: number) => market === "nasdaq100" ? `${n.toFixed(2)}%` : n >= 1e12 ? `${(n / 1e12).toFixed(1)}${L("조", "T")}` : `${(n / 1e8).toFixed(0)}${L("억", "×100M")}`;
  const xOf = (code: string) => {
    const element = gridRef.current?.querySelector<HTMLElement>(`[data-code="${CSS.escape(code)}"]`);
    if (!element) return Math.random();
    const box = element.getBoundingClientRect();
    return (box.left + box.width / 2) / Math.max(1, innerWidth);
  };
  const strength = (item: MarketMapItem) => .3 + Math.min(.5, Math.abs(hasReturn(item) ? item.change_pct : 0) / 8);

  useEffect(() => { setFocused(null); setShowAll(false); ledger.current.clear(); introduced.current = null; }, [market]);
  useEffect(() => {
    const grid = gridRef.current; if (!grid) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      // compact cells on phones and tablets fit more per row than the desktop cells
      const compact = matchMedia(COMPACT_QUERY).matches;
      setColumns(Math.max(3, Math.min(10, Math.floor(width / (width < 520 ? 104 : compact ? 112 : 128)))));
    });
    observer.observe(grid); return () => observer.disconnect();
  }, []);
  // Real quote changes ring out of the sea under their own cells, strongest first.
  useEffect(() => {
    if (!stocks.length) return;
    const calm = fx === "minimal" || matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, string>(), changed: MarketMapItem[] = [];
    for (const item of stocks) {
      const signature = `${item.close}:${item.change_pct}`;
      if (ledger.current.has(item.code) && ledger.current.get(item.code) !== signature) changed.push(item);
      next.set(item.code, signature);
    }
    const first = introduced.current !== market;
    ledger.current = next; introduced.current = market;
    if (calm || document.hidden) return;
    const movers = first ? [...known].sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct)).slice(0, 4) : changed.sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct)).slice(0, 6);
    const timers = movers.map((item, index) => window.setTimeout(() => {
      controller.current?.emit(xOf(item.code), strength(item));
      const cell = gridRef.current?.querySelector<HTMLElement>(`[data-code="${CSS.escape(item.code)}"]`);
      cell?.animate([{ opacity: 0 }, { opacity: 1, offset: .1 }, { opacity: .1, offset: .4 }, { opacity: .95, offset: .55 }, { opacity: 0 }], { pseudoElement: "::after", duration: 1400, easing: "ease-out" });
    }, (first ? 700 : 150) + index * 420));
    return () => timers.forEach(timer => clearTimeout(timer));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.version, market, stocks.length]);
  const focus = (item: MarketMapItem) => {
    const next = focused === item.code ? null : item.code;
    setFocused(next);
    if (next) controller.current?.emit(xOf(item.code), strength(item) + .25);
  };
  const ripple = (item: MarketMapItem) => {
    const now = performance.now();
    if (now - lastHover.current < 380) return;
    lastHover.current = now;
    controller.current?.emit(xOf(item.code), .22, false);
  };

  return <div className="pb-page">
    <NeoPulseHorizon mood={mood} energy={energy} intensity={1.18} horizon={-.22} controller={controller} />
    <PulseShip state={ship} controller={controller} onBoard={focusItem ? () => navigate(`/stock/${encodeURIComponent(focusItem.code)}`) : undefined}
      onCargo={code => { const item = stocks.find(stock => stock.code === code); if (item) focus(item); }} />
    <section className="sc-scanner pb-board" aria-labelledby="pb-title" data-mood={mood} data-market={market}>
      <header className="pb-heading">
        <div><p className="pb-kicker">PULSE BOARD · {MARKETS.find(item => item.key === market)!.label}</p><h1 id="pb-title">{L("증시 전광판", "Market pulse board")}</h1></div>
        <div className="pb-mood" role="status">
          <i className={`pb-mood-swatch is-${mood}`} aria-hidden="true" />
          <span><b>{MOOD_NAME[mood][lang === "ko" ? 0 : 1]}</b><small>{focusItem ? `${focusItem.name} ${hasReturn(focusItem) ? pct(focusItem.change_pct) : "—"}` : `${MARKETS.find(item => item.key === market)!.label} ${quotePct(quotes[market].change)}`} {L("기준", "basis")}</small></span>
          <ol className="pb-mood-legend" aria-label={L("바다 색 기준", "Sea colour rule")}><li className="is-down">≤ −1%</li><li className="is-calm">−1 ~ +1%</li><li className="is-up">≥ +1%</li></ol>
        </div>
      </header>
      <div className="sc-markets pb-markets" role="group" aria-label={L("시장 선택", "Select market")}>{MARKETS.map(config => {
        const quote = quotes[config.key];
        return <button type="button" key={config.key} aria-pressed={market === config.key} onClick={() => setMarket(config.key)} data-mood={moodOf(quote.change)}>
          <span>{config.label}<small>{config.region}</small></span><div><strong>{price(quote.price)}</strong><b className={`is-${toneOf(quote.change)}`}>{quotePct(quote.change)}</b></div>
        </button>;
      })}</div>
      <div className="sc-breadth pb-breadth"><div><span>{L("등락 분포", "Breadth")}</span><b className="sc-up">↑ {up}</b><b className="sc-down">↓ {down}</b><small>{L("보합", "Flat")} {known.length - up - down}</small></div><div className="sc-breadth-track" role="img" aria-label={`${up} up, ${down} down`}>{[[up, "up"], [known.length - up - down, "flat"], [down, "down"]].map(([count, tone]) => <i key={tone} className={`sc-${tone}`} style={{ flex: Number(count) }} />)}</div>
        <div className="pb-sort" role="group" aria-label={L("정렬", "Sort")}>{([["cap", L("시총순", "Size")], ["return", L("등락순", "Return")]] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={order === key} onClick={() => setOrder(key)}>{label}</button>)}</div>
      </div>
      <p className="pb-hint">{L("종목을 누르면 로고가 펄스 바다 위에 떠오르고, 바다 색이 그 종목의 등락을 따라갑니다.", "Tap a stock to float it on the pulse sea; the sea then follows its move.")}</p>
      <div ref={gridRef} className="sc-grid pb-grid" style={{ "--sc-columns": columns } as CSSProperties} role="group" aria-label={L("종목 시세", "Stock quotes")}>
        {(showAll ? visible : visible.slice(0, DEFAULT_CELLS)).map(item => {
          const ok = hasReturn(item);
          return <button type="button" key={item.code} data-code={item.code} className={`sc-stock${item.code === focused ? " is-selected pb-focused" : ""}`} aria-pressed={item.code === focused}
            onClick={() => focus(item)} onPointerEnter={event => { if (event.pointerType === "mouse") ripple(item); }}
            title={`${item.name} · ${item.sector || "—"} · ${price(item.close)} · ${ok ? pct(item.change_pct) : "—"}`}
            style={{ "--sc-color": quoteColor(item), "--sc-strength": ok ? Math.min(Math.abs(item.change_pct) / 8, .75) : 0 } as CSSProperties}>
            <span className="sc-stock-name"><StockLogo code={item.code} name={item.name} className="sc-stock-logo" /><span>{market === "nasdaq100" ? item.code : item.name}</span></span>
            <b className="sc-stock-return">{ok ? pct(item.change_pct) : "—"}</b><span className="sc-stock-price">{price(item.close)}</span>
            <small>{market === "nasdaq100" ? `${item.marcap.toFixed(2)}%` : money(item.marcap)}</small>
            <i className="sc-stock-meter" aria-hidden="true"><i style={{ width: `${item.marcap / maxCap * 100}%` }} /></i>
          </button>;
        })}
        {!stocks.length && <div className="sc-empty">{snapshot.settled ? L("시장 데이터를 확인하고 있습니다.", "Market data is unavailable.") : L("시장 데이터를 불러오는 중입니다.", "Loading market data.")}</div>}
      </div>
      {visible.length > DEFAULT_CELLS && <button type="button" className="pb-more" aria-expanded={showAll} onClick={() => {
        if (showAll) gridRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
        setShowAll(value => !value);
      }}>{showAll ? L(`상위 ${DEFAULT_CELLS}종목만 보기`, `Show top ${DEFAULT_CELLS}`) : L(`더보기 · ${visible.length - DEFAULT_CELLS}종목 더`, `Show ${visible.length - DEFAULT_CELLS} more`)}<b aria-hidden="true">{showAll ? "−" : "+"}</b></button>}
      <p className="pb-footnote">{market === "nasdaq100" ? L("막대: 상대 지수 비중", "Bar: relative index weight") : L("막대: 상대 시가총액", "Bar: relative market cap")} · {L("최근 제공 시세 · 전일 대비", "Latest supplied quotes · vs. previous close")}{snapshot.delayed ? ` · ${L("갱신 지연", "Delayed")}` : ""} · {Math.min(showAll ? visible.length : DEFAULT_CELLS, visible.length)} / {stocks.length}{L("종목", " stocks")}</p>
    </section>
    {focusItem && <FloatingCompany item={focusItem} market={market} controller={controller} onClose={() => setFocused(null)} lang={lang} />}
  </div>;
}
