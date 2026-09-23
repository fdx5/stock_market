import { useEffect, useMemo, useRef, useState } from "react";
import { StockBoard, StockBoardItem, api } from "../api/client";
import { Link, navigate } from "../router";
import { stockIconUrl } from "../stockIcon";
import { usCompanyLogoProxyUrl } from "../usLogo";
import { useDocumentTitle } from "../useDocumentTitle";
import { reportMarketBubbleEvent } from "../useActivityTracking";
import { BubbleDatum, BubbleEngine } from "./bubble/engine";
import { logoPalette } from "./bubble/assets";
import MarketBubbleDiscussion from "./MarketBubbleDiscussion";
import "./marketBubble.css";
import "./bubble/observatory.css";

/* 증시버블 — the market as an observatory.
 *
 * The top twenty names of a market float freely as glass spheres:
 * size is market value, the rim and the light inside are the day's move (red up,
 * blue down, brighter the further it went), the logo sits inside each sphere like a
 * medallion, and each drifts on its own path, only ever bumped by its neighbours.
 * The rendering lives in bubble/engine.ts; this file is the data and the instruments
 * around the glass — the pulse panel, sector focus, the hover card, the controls. */

type Market = "kospi" | "kosdaq" | "nasdaq";

const COUNT = 20;
const MARKETS: { key: Market; label: string; title: string }[] = [
  { key: "kospi", label: "코스피", title: "KOSPI" },
  { key: "kosdaq", label: "코스닥", title: "KOSDAQ" },
  { key: "nasdaq", label: "나스닥", title: "NASDAQ" },
];

const FPS_METER = (() => {
  const p = new URLSearchParams(window.location.search);
  return p.has("fps") && !["0", "off", "false", "no"].includes((p.get("fps") ?? "").toLowerCase());
})();

const FONT_HREF = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";

function priceText(item: StockBoardItem, market: Market) {
  return market === "nasdaq"
    ? `$${item.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${Math.round(item.close).toLocaleString("ko-KR")}원`;
}

function capValue(item: StockBoardItem) {
  return Math.max(0, item.market_cap || item.marcap || 0);
}

function capText(item: StockBoardItem, market: Market) {
  if (market === "nasdaq") {
    const v = item.market_cap;
    if (!v || v <= 0) return null;
    return v >= 1e12 ? `시총 $${(v / 1e12).toFixed(2)}T` : `시총 $${(v / 1e9).toFixed(0)}B`;
  }
  if (!item.marcap || item.marcap <= 0) return null;
  return item.marcap >= 1e12 ? `시총 ${(item.marcap / 1e12).toFixed(item.marcap >= 100e12 ? 0 : 1)}조 원` : `시총 ${Math.round(item.marcap / 1e8).toLocaleString("ko-KR")}억 원`;
}

function shortName(item: StockBoardItem, market: Market) {
  const name = market === "nasdaq" ? item.name_ko || item.name : item.name;
  return name.replace(/\s+(Inc\.?|Corporation|Corp\.?|Common Stock).*$/i, "");
}

function signed(v: number, digits = 2) {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}%`;
}

const tone = (v: number) => (v > 0.04 ? "up" : v < -0.04 ? "down" : "flat");

function Spark({ points }: { points: number[] }) {
  const pts = points.filter((p) => Number.isFinite(p));
  if (pts.length < 2) return null;
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const d = pts.map((v, i) => `${i ? "L" : "M"}${((i / (pts.length - 1)) * 100).toFixed(1)},${(30 - ((v - lo) / span) * 28).toFixed(1)}`).join("");
  return (
    <svg className={`ob-spark is-${tone(pts[pts.length - 1] / pts[0] - 1)}`} viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <path d={`${d}L100,32L0,32Z`} className="ob-spark-area" />
      <path d={d} className="ob-spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function FpsMeter() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0, frames = 0, since = performance.now(), worst = 0, prev = since;
    const tick = (now: number) => {
      worst = Math.max(worst, now - prev);
      prev = now;
      frames += 1;
      if (now - since > 500 && ref.current) {
        const fps = (frames * 1000) / (now - since);
        ref.current.textContent = `${fps.toFixed(0)} FPS · worst ${worst.toFixed(1)}ms`;
        ref.current.dataset.tone = fps >= 50 ? "good" : fps >= 30 ? "fair" : "bad";
        frames = 0;
        since = now;
        worst = 0;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <div className="ob-fps" ref={ref} />;
}

export default function MarketBubblePage() {
  useDocumentTitle("증시버블 · K-Stock Hub");
  const [market, setMarket] = useState<Market>(() => {
    const m = new URLSearchParams(window.location.search).get("market")?.toLowerCase();
    return m === "kosdaq" || m === "nasdaq" ? m : "kospi";
  });
  const [board, setBoard] = useState<StockBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  const [panel, setPanel] = useState<number | null>(null);
  const [sector, setSector] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [quality, setQuality] = useState("");
  const [palettes, setPalettes] = useState<Record<string, [string, string]>>({});
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<BubbleEngine | null>(null);
  const hoverRef = useRef<number | null>(null);
  const builtFor = useRef<string>("");

  useEffect(() => {
    if (!document.querySelector(`link[href="${FONT_HREF}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = FONT_HREF;
      document.head.appendChild(link);
    }
  }, []);

  const items = useMemo(() => board?.items.slice().sort((a, b) => a.rank - b.rank).slice(0, COUNT) ?? [], [board]);
  const logoOf = (item: StockBoardItem) => (market === "nasdaq" ? usCompanyLogoProxyUrl(item.code) : stockIconUrl(item.code));

  // data: full board on market change, the slim refresh every five seconds
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setPanel(null);
    setSector(null);
    api
      .stockBoard(market)
      .then((b) => alive && setBoard(b))
      .catch((e: Error) => alive && setError(e.message || "시장 데이터를 불러오지 못했습니다."))
      .finally(() => alive && setLoading(false));
    const id = window.setInterval(() => {
      if (document.hidden) return;
      api
        .stockBoardRefresh(market)
        .then((fresh) => {
          if (!alive) return;
          setBoard((prev) => (prev ? { ...prev, ...fresh, spark_dates: prev.spark_dates, items: fresh.items.map((it) => ({ ...it, points: prev.items.find((o) => o.code === it.code)?.points ?? [] })) } : prev));
        })
        .catch(() => undefined);
    }, 5000);
    const params = new URLSearchParams(window.location.search);
    if (market === "kospi") params.delete("market");
    else params.set("market", market);
    const url = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState(window.history.state, "", url);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [market]);

  useEffect(() => {
    let alive = true;
    items.forEach((it) =>
      logoPalette(logoOf(it), `${market}:${it.code}`).then((p) => alive && setPalettes((prev) => (prev[`${market}:${it.code}`] ? prev : { ...prev, [`${market}:${it.code}`]: p })))
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, items.map((i) => i.code).join(",")]);

  // the engine lives as long as the page
  useEffect(() => {
    const stage = stageRef.current, canvas = canvasRef.current;
    if (!stage || !canvas) return;
    let engine: BubbleEngine;
    try {
      engine = new BubbleEngine(stage, canvas, {
        onHover: (i) => {
          hoverRef.current = i;
          setHover(i);
        },
        onSelect: (i) => setPanel(i),
        onOpen: (i) => {
          const it = itemsRef.current[i];
          if (!it) return;
          reportMarketBubbleEvent({ action: "stock_detail", market: marketRef.current, code: it.code, name: it.name });
          navigate(`/stock/${it.code}`);
        },
        onQuality: setQuality,
        onFrame: () => {
          const card = cardRef.current, i = hoverRef.current;
          if (!card || i === null) return;
          const a = engine.screenAnchor(i);
          if (!a) return;
          const w = stage.clientWidth;
          const x = Math.max(12, Math.min(w - 292, a.x + a.r * 0.75 + 18));
          const y = Math.max(76, a.y - a.r - 20);
          card.style.transform = `translate3d(${x.toFixed(0)}px,${y.toFixed(0)}px,0)`;
        },
      });
    } catch {
      setError("이 기기에서 3D 그래픽(WebGL)을 사용할 수 없습니다.");
      return;
    }
    engineRef.current = engine;
    if (import.meta.env.DEV) (window as unknown as { __bubble?: BubbleEngine }).__bubble = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const itemsRef = useRef<StockBoardItem[]>([]);
  const marketRef = useRef<Market>(market);
  itemsRef.current = items;
  marketRef.current = market;

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || items.length === 0) return;
    const data: BubbleDatum[] = items.map((it) => ({
      key: `${market}:${it.code}`,
      code: it.code,
      rank: it.rank,
      name: shortName(it, market),
      sector: it.sector || "기타",
      cap: capValue(it),
      changePct: it.change_pct,
      price: priceText(it, market),
      capText: capText(it, market),
      logoUrl: logoOf(it),
    }));
    const key = data.map((d) => d.key).join(",");
    engine.setData(data, builtFor.current !== key);
    builtFor.current = key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, market]);

  useEffect(() => {
    engineRef.current?.setSectorFocus(sector);
  }, [sector, items]);
  useEffect(() => {
    engineRef.current?.setAutoRotate(auto);
  }, [auto]);
  // Closing a company's panel returns to the whole market.
  const hadPanel = useRef(false);
  useEffect(() => {
    if (panel !== null) hadPanel.current = true;
    else if (hadPanel.current) {
      hadPanel.current = false;
      engineRef.current?.resetCamera();
    }
  }, [panel]);

  const pulse = useMemo(() => {
    const up = items.filter((i) => i.change_pct > 0.04).length;
    const down = items.filter((i) => i.change_pct < -0.04).length;
    const totalCap = items.reduce((s, i) => s + capValue(i), 0);
    const weighted = totalCap ? items.reduce((s, i) => s + capValue(i) * i.change_pct, 0) / totalCap : 0;
    const movers = [...items].sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct)).slice(0, 3);
    const sectors = new Map<string, { n: number; cap: number; move: number }>();
    for (const it of items) {
      const k = it.sector || "기타";
      const e = sectors.get(k) ?? { n: 0, cap: 0, move: 0 };
      e.n += 1;
      e.cap += capValue(it);
      e.move += capValue(it) * it.change_pct;
      sectors.set(k, e);
    }
    const sectorList = [...sectors.entries()]
      .map(([k, e]) => ({ sector: k, n: e.n, share: totalCap ? e.cap / totalCap : 0, move: e.cap ? e.move / e.cap : 0 }))
      .sort((a, b) => b.share - a.share);
    return { up, down, flat: items.length - up - down, weighted, movers, sectors: sectorList };
  }, [items]);

  const openPanel = (i: number) => {
    const it = items[i];
    if (!it) return;
    engineRef.current?.focus(i);
    setPanel(i);
    reportMarketBubbleEvent({ action: "bubble_click", market, code: it.code, name: it.name });
  };

  const hovered = hover !== null ? items[hover] : null;
  const title = MARKETS.find((m) => m.key === market)!;

  return (
    <main className="ob" data-mood={tone(pulse.weighted)}>
      <div ref={stageRef} className="ob-stage" aria-label={`${title.label} 시가총액 상위 ${COUNT}개 종목 3D 버블`}>
        <canvas ref={canvasRef} className="ob-canvas" />
      </div>

      <header className="ob-top">
        <div className="ob-brand">
          <Link to="/desk" className="ob-back" aria-label="마켓 데스크로 돌아가기">
            ←
          </Link>
          <span>
            <b>증시버블</b>
            <small>MARKET OBSERVATORY</small>
          </span>
        </div>
        <nav className="ob-markets" role="tablist" aria-label="시장 선택">
          {MARKETS.map((m) => (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={market === m.key}
              className={market === m.key ? "is-on" : ""}
              onClick={() => {
                if (market === m.key) return;
                reportMarketBubbleEvent({ action: "market_switch", market: m.key });
                setMarket(m.key);
              }}
            >
              {m.label}
            </button>
          ))}
        </nav>
        <div className="ob-live">
          <span className="ob-live-dot" />
          LIVE
          <time>{board ? new Date(board.generated_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "--:--:--"}</time>
          <Link to="/kospi-orbit" className="ob-orbit">
            증시궤도 ✦
          </Link>
        </div>
      </header>

      {items.length > 0 && (
        <aside className="ob-pulse" aria-label="시장 요약">
          <p className="ob-kicker">
            {title.title} · TOP {COUNT}
          </p>
          <div className={`ob-big is-${tone(pulse.weighted)}`}>
            {signed(pulse.weighted)}
            <small>시총가중</small>
          </div>
          <div className="ob-breadth" role="img" aria-label={`상승 ${pulse.up}, 보합 ${pulse.flat}, 하락 ${pulse.down}`}>
            <i className="is-up" style={{ flexGrow: pulse.up }} />
            <i className="is-flat" style={{ flexGrow: Math.max(pulse.flat, 0.4) }} />
            <i className="is-down" style={{ flexGrow: pulse.down }} />
          </div>
          <p className="ob-breadth-read">
            <span className="is-up">상승 {pulse.up}</span>
            <span>보합 {pulse.flat}</span>
            <span className="is-down">하락 {pulse.down}</span>
          </p>
          <h3>크게 움직인 종목</h3>
          <ol className="ob-movers">
            {pulse.movers.map((m) => {
              const i = items.indexOf(m);
              return (
                <li key={m.code}>
                  <button type="button" onClick={() => openPanel(i)}>
                    <span>{shortName(m, market)}</span>
                    <b className={`is-${tone(m.change_pct)}`}>{signed(m.change_pct)}</b>
                  </button>
                </li>
              );
            })}
          </ol>
          <h3>
            섹터 <small>누르면 그 섹터만 밝힙니다</small>
          </h3>
          <ul className="ob-sectors">
            {pulse.sectors.slice(0, 7).map((s) => (
              <li key={s.sector}>
                <button type="button" className={sector === s.sector ? "is-on" : ""} aria-pressed={sector === s.sector} onClick={() => setSector(sector === s.sector ? null : s.sector)}>
                  <span>{s.sector}</span>
                  <i style={{ width: `${Math.max(6, s.share * 100)}%` }} />
                  <b className={`is-${tone(s.move)}`}>{signed(s.move, 1)}</b>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}

      <div className="ob-legend" aria-hidden="true">
        <span className="ob-scale">
          <i />
        </span>
        <span className="ob-scale-read">
          <b>−5%</b>
          <em>등락 = 빛의 색과 세기</em>
          <b>+5%</b>
        </span>
        <span className="ob-legend-size">
          <i />
          <i />
          <i /> 크기 = 시가총액
        </span>
      </div>

      <div className="ob-tools">
        <button type="button" onClick={() => engineRef.current?.resetCamera()} title="처음 시점으로">
          ⌂ <span>전체 보기</span>
        </button>
        <button type="button" className={auto ? "is-on" : ""} aria-pressed={auto} onClick={() => setAuto((v) => !v)} title="자동 회전">
          ↻ <span>자동 회전</span>
        </button>
        {quality && <em title="기기 성능에 맞춰 자동 조정되는 화질">{quality}</em>}
      </div>

      <p className="ob-hint">
        <b>클릭</b> 종목토론 · <b>더블클릭</b> 종목 상세 · <b>드래그</b> 회전 · <b>휠/핀치</b> 확대
      </p>

      {hovered && hover !== null && (
        <div className="ob-card" ref={cardRef} role="status">
          <p>
            <span className="ob-card-rank">{hovered.rank}</span>
            <span className="ob-card-sector">{hovered.sector}</span>
          </p>
          <h4>{shortName(hovered, market)}</h4>
          <div className="ob-card-price">
            <b>{priceText(hovered, market)}</b>
            <em className={`is-${tone(hovered.change_pct)}`}>{signed(hovered.change_pct)}</em>
          </div>
          <Spark points={hovered.points} />
          <dl>
            <div>
              <dt>시가총액</dt>
              <dd>{capText(hovered, market)?.replace("시총 ", "") ?? "—"}</dd>
            </div>
            {hovered.week52_pos != null && (
              <div>
                <dt>52주 위치</dt>
                <dd>
                  <span className="ob-52">
                    <i style={{ left: `${hovered.week52_pos * 100}%` }} />
                  </span>
                </dd>
              </div>
            )}
          </dl>
          <small>클릭 토론 · 더블클릭 상세</small>
        </div>
      )}

      {loading && (
        <div className="ob-loading">
          <span className="ob-loading-orb" />
          관측소를 여는 중…
        </div>
      )}
      {error && <div className="ob-error">{error}</div>}

      {/* Keyboard and screen-reader access to the same twenty names. */}
      <ul className="ob-sr">
        {items.map((it, i) => (
          <li key={it.code}>
            <button type="button" onClick={() => openPanel(i)}>
              {shortName(it, market)} {priceText(it, market)} {signed(it.change_pct)} — 종목토론 열기
            </button>
          </li>
        ))}
      </ul>

      {panel !== null && items[panel] && (
        <>
          <button className="bubble-panel-scrim ob-scrim" type="button" aria-label="종목토론 닫기" onClick={() => setPanel(null)} />
          <MarketBubbleDiscussion
            item={items[panel]}
            market={market}
            colors={palettes[`${market}:${items[panel].code}`] ?? ["#a9bfd2", "#58748d"]}
            onClose={() => setPanel(null)}
          />
        </>
      )}
      {FPS_METER && <FpsMeter />}
    </main>
  );
}
