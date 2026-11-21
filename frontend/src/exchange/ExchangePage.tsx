import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { Link } from "../router";
import {
  FLOOR, MARKETS, PANEL_LABELS, STORAGE_ASSETS, changeText, changeTone, companyLogo, displayValue, marketCode,
  postNumber, rowsForPanel, shortTime, useFloorQuotes, usePostSeries, useStockHistory,
  type ExchangeMarket, type FloorSnapshot, type Language,
} from "./market";
import type { FloorDriver } from "./floorEngine";
import { drawLine } from "./screens";
import { openFloorSound } from "./sound";
import "./exchange.css";

type FloorAudio = Awaited<ReturnType<typeof openFloorSound>>;
type Phase = "loading" | "webgpu" | "webgl2" | "failed";
type Station = (typeof FLOOR.stations)[number];
const MARKETS_LIST = Object.keys(MARKETS) as ExchangeMarket[];
const t = (lang: Language, ko: string, en: string) => lang === "ko" ? ko : en;

function panelLabel(id: string, lang: Language) {
  return PANEL_LABELS[id]?.[lang === "ko" ? 0 : 1] ?? t(lang, "거래 포스트 ", "Trading post ") + String(postNumber(id) + 1).padStart(2, "0");
}

function LiveChart({ points, color, label, empty }: { points: number[]; color: string; label: string; empty: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    const paint = () => {
      const { width, height } = element.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawLine(ctx, points, 5, 8, Math.max(1, width - 10), Math.max(1, height - 16), color);
    };
    const observer = new ResizeObserver(paint);
    observer.observe(element);
    paint();
    return () => observer.disconnect();
  }, [points, color]);
  return <div className="exchange-chart">
    <canvas ref={canvas} role="img" aria-label={label} />
    {points.length < 2 && <span>{empty}</span>}
  </div>;
}

function Logo({ market, code }: { market: ExchangeMarket; code: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="exchange-stock-logo">{failed ? code.slice(0, 2)
    : <img src={companyLogo(market, code)} alt="" loading="lazy" onError={() => setFailed(true)} />}</span>;
}

function FocusPanel({ data, id, lang, histories, onClose }: {
  data: FloorSnapshot; id: string; lang: Language; histories: Record<string, number[]>; onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [stock, setStock] = useState<string>();
  const [commodity, setCommodity] = useState(data.quotes[0]?.symbol);
  const spec = MARKETS[data.market];
  const panelRows = rowsForPanel(data, id).slice(0, 14);
  const selected = panelRows.find(row => row.code === stock) ?? panelRows[0];
  const asset = data.quotes.find(item => item.symbol === commodity) ?? data.quotes[0];
  const isStock = id === "leaders" || id === "gainers" || id === "laggards" || postNumber(id) >= 0;
  const loadedSeries = useStockHistory(data.market, isStock && selected && !histories[selected.code]?.length ? selected.code : undefined);
  const stockPoints = (selected && histories[selected.code]) || loadedSeries;
  const chartEmpty = t(lang, "아직 수신된 차트 데이터가 없습니다.", "Chart data is unavailable.");
  useEffect(() => { closeButton.current?.focus(); }, []);

  let details: ReactNode;
  if (id === "overview") {
    details = <>
      <div className="exchange-focus-quote"><strong>{displayValue(data.index?.close)} <small>PT</small></strong>
        <b data-tone={changeTone(data.index?.change)}>{changeText(data.index?.change)}</b></div>
      <p className="exchange-fine">{t(lang, "지수 기준 시각", "Index timestamp")} · {shortTime(data.index?.time)}</p>
      <LiveChart points={data.series} color={spec.color} label={spec.label + " " + t(lang, "지수 차트", "index chart")} empty={chartEmpty} />
      <p className="exchange-fine">{data.market === "sp500" ? t(lang, "제공 장중 시계열 · Yahoo Finance", "Provided intraday series · Yahoo Finance")
        : t(lang, "최근 거래일 일별 종가 · KRX 지수 자료", "Recent daily closes · KRX index feed")}</p>
      <Link className="exchange-detail-link" to={spec.index}>{t(lang, "지수 상세 보기", "Open index details")} ↗</Link>
    </>;
  } else if (id === "commodities") {
    details = <>
      <div className="exchange-focus-quote"><strong>{displayValue(asset?.quote?.price)} <small>{asset?.unit}</small></strong>
        <b data-tone={changeTone(asset?.quote?.change_pct)}>{changeText(asset?.quote?.change_pct)}</b></div>
      <LiveChart points={asset?.quote?.points ?? []} color={spec.color} label={(asset?.name ?? "") + " chart"} empty={chartEmpty} />
      <p className="exchange-fine">Yahoo Finance · {shortTime(asset?.quote?.quote_time)}</p>
      <ul className="exchange-focus-rows">
        {data.quotes.map(item => <li key={item.symbol}><button type="button" aria-pressed={asset?.symbol === item.symbol} onClick={() => setCommodity(item.symbol)}>
          <strong>{item.name}</strong><span>{displayValue(item.quote?.price)} {item.unit}</span>
          <b data-tone={changeTone(item.quote?.change_pct)}>{changeText(item.quote?.change_pct)}</b>
        </button></li>)}
      </ul>
      {asset && <Link className="exchange-detail-link" to={asset.href}>{t(lang, "자산 시세·일별 차트", "Asset price and daily chart")} ↗</Link>}
    </>;
  } else if (id === "breadth" || id === "sectors") {
    const counted = data.up + data.flat + data.down;
    details = <>
      <dl className="exchange-breadth">
        {([[t(lang, "상승", "Up"), data.up, "up"], [t(lang, "보합", "Flat"), data.flat, "flat"], [t(lang, "하락", "Down"), data.down, "down"]] as const).map(([label, value, tone]) =>
          <div key={tone}><dt>{label}</dt><dd data-tone={tone}>{counted ? value : "—"}</dd></div>)}
      </dl>
      <p className="exchange-fine">{t(lang, "제공 표본 기준", "Displayed sample")} · {counted}/{data.rows.length} {t(lang, "종목 등락률 수신", "changes available")}</p>
      <ul className="exchange-focus-rows">
        {data.sectors.map(item => <li key={item.name}><div>
          <strong>{item.name}</strong><span>{item.count} {t(lang, "종목", "stocks")}</span>
          <b data-tone={changeTone(item.change)}>{changeText(item.change)}</b>
        </div></li>)}
      </ul>
      <p className="exchange-fine">{t(lang, "업종 등락률은 표본의 단순평균입니다.", "Sector changes are simple means of the sample.")}</p>
      <Link className="exchange-detail-link" to={spec.map}>{t(lang, "전체 시장 지도", "Open market map")} ↗</Link>
    </>;
  } else {
    details = selected ? <>
      <div className="exchange-focus-name"><Logo key={selected.code} market={data.market} code={selected.code} />
        <div><strong>{selected.name}</strong><small>{selected.code} · {selected.sector || spec.venue}</small></div></div>
      <div className="exchange-focus-quote"><strong>{displayValue(selected.close, data.market === "sp500" ? 2 : 0)} <small>{spec.currency}</small></strong>
        <b data-tone={changeTone(selected.change_pct)}>{changeText(selected.change_pct)}</b></div>
      <LiveChart points={stockPoints} color={spec.color} label={selected.name + " " + t(lang, "일별 종가", "daily closes")} empty={chartEmpty} />
      <div className="exchange-quote-notes">
        <span>{t(lang, "제공 시세 시각", "Quote timestamp")} · {shortTime(selected.quote_time)}</span>
        {data.market === "sp500"
          ? data.capBasis === "index_weight"
            ? <span>{t(lang, "지수 편입 비중", "Index weight")} · {displayValue(selected.marcap)}%</span>
            : <span>{t(lang, "시가총액", "Market cap")} · {displayValue(selected.market_cap, 0)} USD</span>
          : <span>{t(lang, "시가총액", "Market cap")} · {displayValue(selected.marcap, 0)} {t(lang, "억원", "× 100M KRW")}</span>}
      </div>
      <ul className="exchange-focus-rows">
        {panelRows.length > 1 && panelRows.map(row => <li key={row.code}><button type="button" aria-pressed={row.code === selected.code} onClick={() => setStock(row.code)}>
          <strong>{row.name}</strong><span>{row.code}</span><b data-tone={changeTone(row.change_pct)}>{changeText(row.change_pct)}</b>
        </button></li>)}
      </ul>
      <Link className="exchange-detail-link" to={"/stock/" + selected.code}>{t(lang, "종목 상세 보기", "Open stock details")} ↗</Link>
    </> : <p className="exchange-fine">{t(lang, "해당 조건의 수신 종목이 없습니다.", "No matching quotes received yet.")}</p>;
  }

  return <aside className="exchange-focus" aria-labelledby="exchange-panel-heading" data-panel={id}>
    <div className="exchange-focus-head">
      <div><span>{spec.venue} / {spec.label}</span><h2 id="exchange-panel-heading">{panelLabel(id, lang)}</h2></div>
      <button ref={closeButton} type="button" className="exchange-action" aria-label={t(lang, "관제 화면 닫기", "Close market monitor")} onClick={onClose}>×</button>
    </div>
    {details}
  </aside>;
}

function Joystick({ driver, lang }: { driver: FloorDriver | null; lang: Language }) {
  const stick = useRef<HTMLSpanElement>(null);
  const pointer = useRef<number>();
  const motion = (event: PointerEvent<HTMLButtonElement>) => {
    if (pointer.current !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - rect.left - rect.width / 2) / (rect.width * .36);
    const dy = (event.clientY - rect.top - rect.height / 2) / (rect.height * .36);
    const norm = Math.max(1, Math.hypot(dx, dy));
    if (stick.current) stick.current.style.transform = "translate(" + dx / norm * 23 + "px," + dy / norm * 23 + "px)";
    driver?.move(dx / norm, -dy / norm);
  };
  const end = () => {
    pointer.current = undefined;
    if (stick.current) stick.current.style.transform = "";
    driver?.move(0, 0);
  };
  return <button className="exchange-joystick" type="button" aria-label={t(lang, "이동 조이스틱", "Movement joystick")}
    onPointerDown={event => {
      pointer.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      motion(event);
    }} onPointerMove={motion} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
    <span ref={stick} />
  </button>;
}

export default function ExchangePage() {
  const { lang } = useLanguage();
  const [market, setMarket] = useState<ExchangeMarket>(() => marketCode(new URLSearchParams(location.search).get("market")));
  const data = useFloorQuotes(market);
  const histories = usePostSeries(market, data.rows);
  const [phase, setPhase] = useState<Phase>("loading");
  const [retry, setRetry] = useState(0);
  const [driver, setDriver] = useState<FloorDriver | null>(null);
  const [focus, setFocus] = useState<string>();
  const [showMap, setShowMap] = useState(true);
  const [sound, setSound] = useState(false);
  const [soundError, setSoundError] = useState(false);
  const [full, setFull] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const mark = useRef<HTMLElement>(null);
  const audio = useRef<FloorAudio | null>(null);
  const audioPending = useRef(false);
  const activeAudio = useRef(true);
  const currentPosition = useRef({ ...FLOOR.spawn });
  const spec = MARKETS[market];

  useEffect(() => {
    if (!host.current || !canvas.current) return;
    const container = host.current, element = canvas.current;
    let engine: FloorDriver | undefined;
    const controller = new AbortController();
    const signal = controller.signal;
    setPhase("loading");
    setDriver(null);
    void import("./floorEngine").then(({ createFloor }) => createFloor(container, element, signal, {
      renderer: setPhase,
      position(x, z, yaw) {
        currentPosition.current = { ...currentPosition.current, x, z, yaw };
        if (mark.current) {
          mark.current.style.left = (50 + x / FLOOR.room.width * 100) + "%";
          mark.current.style.top = (50 + z / FLOOR.room.depth * 100) + "%";
          mark.current.style.rotate = -yaw + "rad";
        }
        audio.current?.position(x, z, yaw);
      },
      select(id) { setFocus(id); audio.current?.select(); },
      error() { setDriver(null); setPhase("failed"); },
    })).then(value => {
      engine = value;
      if (signal.aborted) value.dispose();
      else setDriver(value);
    }).catch(() => { if (!signal.aborted) setPhase("failed"); });
    return () => { controller.abort(); engine?.dispose(); };
  }, [retry]);
  useEffect(() => { driver?.update(data, histories, lang); }, [data, driver, histories, lang]);
  useEffect(() => {
    activeAudio.current = true;
    return () => { activeAudio.current = false; audio.current?.close(); audio.current = null; };
  }, []);
  useEffect(() => {
    const watch = () => setFull(document.fullscreenElement === pageRef.current);
    document.addEventListener("fullscreenchange", watch);
    return () => document.removeEventListener("fullscreenchange", watch);
  }, []);
  useEffect(() => {
    if (!focus) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFocus(undefined);
        canvas.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);

  function chooseMarket(next: ExchangeMarket) {
    if (next === market) return;
    setMarket(next);
    const url = new URL(location.href);
    if (next === "kospi") url.searchParams.delete("market");
    else url.searchParams.set("market", next);
    window.history.replaceState(window.history.state, "", url);
  }
  function inspect(id: string) {
    driver?.stop();
    setFocus(id);
    audio.current?.select();
  }
  function visit(station: Station) {
    driver?.jump(station);
    if (!driver) inspect(station.id);
    else setFocus(undefined);
  }
  async function toggleSound() {
    if (audio.current) {
      audio.current.close();
      audio.current = null;
      setSound(false);
      return;
    }
    if (audioPending.current) return;
    audioPending.current = true;
    setSoundError(false);
    try {
      const instance = await openFloorSound();
      if (!activeAudio.current) { instance.close(); return; }
      const pose = currentPosition.current;
      instance.position(pose.x, pose.z, pose.yaw);
      audio.current = instance;
      setSound(true);
    } catch { if (activeAudio.current) setSoundError(true); }
    finally { audioPending.current = false; }
  }
  const toggleFullscreen = () => {
    const promise = document.fullscreenElement ? document.exitFullscreen() : pageRef.current?.requestFullscreen();
    void promise?.catch(() => {});
  };
  const status = data.failed ? t(lang, "표본 갱신 지연", "Sample delayed") : data.received
    ? t(lang, "10초 간격 조회", "10s polling") : t(lang, "시세 연결 중", "Connecting quotes");

  return <main ref={pageRef} className="exchange-page" data-market={market} data-phase={phase}>
    <header className="exchange-header">
      <div className="exchange-title"><span>KOSPIMAP <i /> TRADING FLOOR</span><h1>{t(lang, "증권 거래소", "Stock exchange")}</h1></div>
      <div className="exchange-market-switch" role="group" aria-label={t(lang, "거래소 시장 선택", "Select exchange market")}>
        {MARKETS_LIST.map(key => <button key={key} type="button" aria-pressed={market === key} onClick={() => chooseMarket(key)}>
          {MARKETS[key].label}
        </button>)}
      </div>
      <div className="exchange-benchmark"><span>{spec.label}</span><strong>{displayValue(data.index?.close)}</strong>
        <b data-tone={changeTone(data.index?.change)}>{changeText(data.index?.change)}</b></div>
    </header>
    <div className="exchange-stage">
      <div className="exchange-view" ref={host} style={{ backgroundImage: "url(" + STORAGE_ASSETS + "/floor-preview-v1.webp)" }}>
        <canvas key={retry} ref={canvas} className="exchange-canvas" tabIndex={0} aria-label={t(lang, "3D 거래소. 방향키로 이동하고 모니터를 선택하세요.", "3D trading floor. Use arrow keys to move and select a monitor.")} />
      </div>
      <div className="exchange-overlay-top">
        <div className="exchange-status"><i data-live={phase !== "failed"} />
          <div><strong>{phase === "webgpu" ? "WebGPU" : phase === "webgl2" ? "WebGL 2" : t(lang, "거래소", "EXCHANGE")} · {status}</strong>
            <small>{data.received ? t(lang, "표본 갱신", "Sample updated") + " " + shortTime(data.received) : t(lang, "수신된 시세만 표시", "Supplied quotes only")}</small></div>
        </div>
        <div className="exchange-stage-actions">
          <button type="button" className="exchange-action" aria-pressed={sound} onClick={() => { void toggleSound(); }}>{sound ? t(lang, "음향 켜짐", "Sound on") : t(lang, "음향", "Sound")}</button>
          {document.fullscreenEnabled && <button type="button" className="exchange-action" aria-pressed={full} onClick={toggleFullscreen}>{full ? t(lang, "전체화면 종료", "Exit full screen") : t(lang, "전체화면", "Full screen")}</button>}
        </div>
      </div>
      {soundError && <p className="exchange-sound-error" role="status">{t(lang, "이 기기에서 음향을 시작하지 못했습니다.", "Sound could not start on this device.")}</p>}
      {phase === "loading" && <div className="exchange-entry" role="status">
        <div><span>{t(lang, "200평 거래소", "661 m² trading floor")}</span><strong>{t(lang, "거래소를 불러오는 중", "Loading the trading floor")}</strong>
          <small>{t(lang, "3D 모델·소재 및 렌더러 준비", "Preparing the 3D model, materials and renderer")}</small></div>
      </div>}
      {phase === "failed" && <div className="exchange-entry" role="status"><div>
        <strong>{t(lang, "3D 거래소에 연결하지 못했습니다.", "The 3D trading floor could not start.")}</strong>
        <small>{t(lang, "아래 관제 화면에서 시세와 차트를 계속 볼 수 있습니다.", "The market monitors below still show quotes and charts.")}</small>
        <button type="button" className="exchange-action" onClick={() => setRetry(value => value + 1)}>{t(lang, "3D 다시 시도", "Retry 3D")}</button>
      </div></div>}
      {!focus && driver && <>
        <span className="exchange-reticle" aria-hidden="true" />
        <Joystick driver={driver} lang={lang} />
        {showMap && <div className="exchange-minimap">
          <span>{t(lang, "거래소 평면도", "Floor map")}</span>
          <div aria-hidden="true" className="exchange-plan">
            <i className="exchange-plan-wall" />
            {FLOOR.posts.map(({ x, z }) => <i className="exchange-plan-post" key={x + ":" + z}
              style={{ left: (50 + x / FLOOR.room.width * 100) + "%", top: (50 + z / FLOOR.room.depth * 100) + "%" }} />)}
            <b ref={mark} className="exchange-plan-person" />
          </div>
        </div>}
        <div className="exchange-instructions"><span>{t(lang, "WASD / 방향키 이동 · 드래그 시점 · 모니터 클릭", "WASD / arrows move · drag to look · click monitors")}</span>
          <small>{t(lang, "왼쪽 조이스틱 이동 · 화면 드래그 · 모니터 탭", "Left joystick moves · drag to look · tap monitors")}</small></div>
      </>}
      {focus && <FocusPanel key={market + ":" + focus} data={data} id={focus} lang={lang} histories={histories} onClose={() => {
        setFocus(undefined); canvas.current?.focus({ preventScroll: true });
      }} />}
    </div>
    <div className="exchange-controls">
      <div className="exchange-station-list" aria-label={t(lang, "거래소 내부 이동", "Move to a station")}>
        <button type="button" className="exchange-action" disabled={!driver} onClick={() => { driver?.jump(FLOOR.spawn); setFocus(undefined); }}>{t(lang, "입구", "Entrance")}</button>
        {FLOOR.stations.map(station => <button type="button" className="exchange-action" key={station.id} onClick={() => visit(station)}>{station[lang]}</button>)}
      </div>
      <div className="exchange-utilities">
        <button type="button" className="exchange-action" aria-pressed={showMap} disabled={!driver} onClick={() => setShowMap(value => !value)}>{t(lang, "평면도", "Floor map")}</button>
        <details className="exchange-monitor-picker"><summary className="exchange-action">{t(lang, "관제 화면", "Monitors")} <span>↑</span></summary>
          <div>{Object.keys(PANEL_LABELS).map(id => <button key={id} type="button" className="exchange-action" onClick={event => {
            event.currentTarget.closest("details")?.removeAttribute("open"); inspect(id);
          }}>{panelLabel(id, lang)}</button>)}</div>
        </details>
      </div>
    </div>
  </main>;
}
