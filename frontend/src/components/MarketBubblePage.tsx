import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { StockBoard, StockBoardItem, api } from "../api/client";
import { Link, navigate } from "../router";
import { stockIconUrl } from "../stockIcon";
import { usCompanyLogoUrl } from "../usLogo";
import { useDocumentTitle } from "../useDocumentTitle";
import { reportMarketBubbleEvent } from "../useActivityTracking";
import MarketBubbleIcon from "./MarketBubbleIcon";
import MarketBubbleDiscussion from "./MarketBubbleDiscussion";
import "./marketBubble.css";

type Market = "kospi" | "kosdaq" | "nasdaq";
type Body = { x: number; y: number; vx: number; vy: number; r: number; el: HTMLButtonElement | null };

const MARKETS: { key: Market; label: string; title: string }[] = [
  { key: "kospi", label: "코스피", title: "KOSPI 주요종목" },
  { key: "kosdaq", label: "코스닥", title: "KOSDAQ 주요종목" },
  { key: "nasdaq", label: "나스닥", title: "NASDAQ 주요종목" },
];

const PALETTE = [
  ["#f7b7c6", "#d96c8a"], ["#afd8f4", "#5d9bc7"], ["#bfe9d0", "#61aa83"],
  ["#f8d7a4", "#d89c4d"], ["#d5c4f5", "#8970c0"], ["#bce8e5", "#55a7a2"],
  ["#f4c4ad", "#cd8062"], ["#c8dcf8", "#7796c5"], ["#d8e7b0", "#8ba95a"],
  ["#f0c6e7", "#b66ca4"], ["#c8e7f0", "#6eacbd"], ["#ead4b8", "#b58a59"],
];

function formatPrice(item: StockBoardItem, market: Market) {
  return market === "nasdaq"
    ? `$${item.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${Math.round(item.close).toLocaleString("ko-KR")}원`;
}

function shortName(item: StockBoardItem, market: Market) {
  const name = market === "nasdaq" ? item.name_ko || item.name : item.name;
  return name.replace(/\s+(Inc\.?|Corporation|Corp\.?|Common Stock).*$/i, "").slice(0, 18);
}

export default function MarketBubblePage() {
  const [market, setMarket] = useState<Market>("kospi");
  const [board, setBoard] = useState<StockBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [palette, setPalette] = useState(() => Array.from({ length: 20 }, (_, i) => i % PALETTE.length));
  const [colorPulse, setColorPulse] = useState(0);
  const [discussionIndex, setDiscussionIndex] = useState<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const bodiesRef = useRef<Body[]>([]);
  const pointerRef = useRef({ x: -9999, y: -9999, active: false });
  const pinnedRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const firstLoadRef = useRef(true);
  useDocumentTitle("증시버블 · K-Stock Hub");

  const items = useMemo(() => board?.items.slice().sort((a, b) => a.rank - b.rank).slice(0, 20) ?? [], [board]);

  useEffect(() => () => {
    if (clickTimerRef.current != null) window.clearTimeout(clickTimerRef.current);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setDiscussionIndex(null);
    api.stockBoard(market).then((next) => {
      if (!alive) return;
      setBoard(next);
      setLoading(false);
      firstLoadRef.current = true;
    }).catch(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [market]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.hidden) return;
      api.stockBoardRefresh(market).then((fresh) => {
        setBoard((prev) => prev ? { ...prev, ...fresh, spark_dates: prev.spark_dates, items: fresh.items.map((it) => ({ ...it, points: prev.items.find((old) => old.code === it.code)?.points ?? [] })) } : prev);
      }).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(id);
  }, [market]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || items.length === 0) return;
    const rect = stage.getBoundingClientRect();
    const base = Math.max(54, Math.min(88, Math.min(rect.width, rect.height) / 9.2));
    const nextBodies: Body[] = items.map((_, i) => {
      const col = i % 5, row = Math.floor(i / 5);
      const r = base * (i < 4 ? 1.16 : i < 10 ? 1.04 : .92);
      return {
        x: ((col + .65 + (row % 2) * .16) / 5.35) * rect.width,
        y: ((row + .7) / 4.45) * rect.height,
        vx: (Math.random() - .5) * .44,
        vy: (Math.random() - .5) * .44,
        r,
        el: null,
      };
    });
    stage.querySelectorAll<HTMLButtonElement>(".stock-bubble").forEach((el, i) => {
      const body = nextBodies[i];
      if (!body) return;
      body.el = el;
      el.style.width = `${body.r * 2}px`;
      el.style.height = `${body.r * 2}px`;
      el.style.transform = `translate3d(${body.x - body.r}px,${body.y - body.r}px,0)`;
    });
    bodiesRef.current = nextBodies;
    firstLoadRef.current = false;
  }, [market, items.map((it) => it.code).join(",")]);

  useEffect(() => {
    let frame = 0, previous = performance.now();
    const tick = (now: number) => {
      const stage = stageRef.current;
      if (!stage) { frame = requestAnimationFrame(tick); return; }
      const dt = Math.min(2, (now - previous) / 16.667); previous = now;
      const width = stage.clientWidth, height = stage.clientHeight;
      const bodies = bodiesRef.current;
      const pointer = pointerRef.current;
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i];
        if (pinnedRef.current === i) {
          a.vx = 0; a.vy = 0;
          continue;
        }
        if (pointer.active) {
          const dx = a.x - pointer.x, dy = a.y - pointer.y;
          const d = Math.hypot(dx, dy) || 1;
          const reach = a.r + 68;
          if (d < reach) { const f = (reach - d) / reach * .72; a.vx += dx / d * f; a.vy += dy / d * f; }
        }
        a.vx += Math.sin(now * .00038 + i * 1.71) * .005;
        a.vy += Math.cos(now * .00031 + i * 1.13) * .005;
        a.vx *= .994; a.vy *= .994;
        a.x += a.vx * dt; a.y += a.vy * dt;
        if (a.x < a.r) { a.x = a.r; a.vx = Math.abs(a.vx) * .82; }
        if (a.x > width - a.r) { a.x = width - a.r; a.vx = -Math.abs(a.vx) * .82; }
        if (a.y < a.r) { a.y = a.r; a.vy = Math.abs(a.vy) * .82; }
        if (a.y > height - a.r) { a.y = height - a.r; a.vy = -Math.abs(a.vy) * .82; }
      }
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
        if (pinnedRef.current === i || pinnedRef.current === j) continue;
        const a = bodies[i], b = bodies[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        const min = (a.r + b.r) * .9;
        if (d < min) {
          const nx = dx / d, ny = dy / d, overlap = (min - d) * .5;
          a.x -= nx * overlap; a.y -= ny * overlap; b.x += nx * overlap; b.y += ny * overlap;
          const impulse = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (impulse < 0) { a.vx += impulse * nx * .72; a.vy += impulse * ny * .72; b.vx -= impulse * nx * .72; b.vy -= impulse * ny * .72; }
        }
      }
      bodies.forEach((body) => {
        if (body.el) body.el.style.transform = `translate3d(${body.x - body.r}px,${body.y - body.r}px,0)`;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const randomizeTen = (sourceIndex?: number) => {
    const order = Array.from({ length: 20 }, (_, i) => i).sort(() => Math.random() - .5).slice(0, 10);
    setPalette((old) => old.map((value, i) => order.includes(i) ? (value + 1 + Math.floor(Math.random() * (PALETTE.length - 1))) % PALETTE.length : value));
    setColorPulse((n) => n + 1);
    if (sourceIndex != null) {
      const source = bodiesRef.current[sourceIndex];
      bodiesRef.current.forEach((body, i) => {
        if (i === sourceIndex || !source) return;
        const dx = body.x - source.x, dy = body.y - source.y, d = Math.hypot(dx, dy) || 1;
        body.vx += dx / d * 1.25; body.vy += dy / d * 1.25;
      });
    }
  };

  const movePointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    pointerRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top, active: true };
  };

  return (
    <main className="bubble-page" data-color-pulse={colorPulse}>
      <header className="bubble-header">
        <Link to="/desk" className="bubble-brand" aria-label="K-Stock Hub 홈">
          <span className="bubble-brand-mark"><MarketBubbleIcon /></span>
          <span><strong>증시버블</strong><small>MARKET BUBBLES</small></span>
        </Link>
        <div className="bubble-heading">
          <p>시가총액 TOP 20 · 5초마다 갱신</p>
          <h1>{MARKETS.find((it) => it.key === market)?.title}</h1>
        </div>
        <div className="bubble-live"><i /> LIVE <span>{board ? new Date(board.generated_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--"}</span></div>
      </header>

      <section
        ref={stageRef}
        className="bubble-stage"
        aria-label={`${market} 시가총액 상위 20개 종목 버블`}
        onPointerMove={movePointer}
        onPointerLeave={() => { pointerRef.current.active = false; }}
        onClick={(event) => { if (event.target === event.currentTarget) randomizeTen(); }}
      >
        <div className="bubble-stage-hint">버블을 건드려 보세요 <span>마우스 이동 · 클릭</span></div>
        {loading && <div className="bubble-loading"><MarketBubbleIcon /><span>시장 데이터를 불러오는 중</span></div>}
        {!loading && items.map((item, index) => {
          const colors = PALETTE[palette[index] % PALETTE.length];
          const body = bodiesRef.current[index];
          const diameter = (body?.r ?? 72) * 2;
          const positive = item.change_pct > .04, negative = item.change_pct < -.04;
          return (
            <button
              key={`${market}-${item.code}`}
              ref={(el) => { if (bodiesRef.current[index]) bodiesRef.current[index].el = el; }}
              type="button"
              className="stock-bubble"
              style={{ width: diameter, height: diameter, "--bubble-light": colors[0], "--bubble-dark": colors[1] } as React.CSSProperties}
              onClick={(event) => {
                event.stopPropagation();
                if (clickTimerRef.current != null) window.clearTimeout(clickTimerRef.current);
                clickTimerRef.current = window.setTimeout(() => {
                  randomizeTen(index);
                  setDiscussionIndex(index);
                  reportMarketBubbleEvent({ action: "bubble_click", market, code: item.code, name: item.name });
                  clickTimerRef.current = null;
                }, 260);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                if (clickTimerRef.current != null) window.clearTimeout(clickTimerRef.current);
                clickTimerRef.current = null;
                reportMarketBubbleEvent({ action: "stock_detail", market, code: item.code, name: item.name });
                navigate(market === "nasdaq" ? `/global?code=${item.code}` : `/stock/${item.code}`);
              }}
              onPointerEnter={() => {
                pinnedRef.current = index;
                const body = bodiesRef.current[index];
                if (body) { body.vx = 0; body.vy = 0; }
              }}
              onPointerLeave={() => { if (pinnedRef.current === index) pinnedRef.current = null; }}
              aria-label={`${shortName(item, market)} ${formatPrice(item, market)} ${item.change_pct.toFixed(2)}%, 더블 클릭해 종목 열기`}
            >
              <span className="stock-bubble-glass" />
              <span className="stock-bubble-content">
                <span className="stock-bubble-rank">#{item.rank}</span>
                <span className="stock-bubble-logo-wrap">
                  <img src={market === "nasdaq" ? usCompanyLogoUrl(item.code) : stockIconUrl(item.code)} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                </span>
                <strong>{shortName(item, market)}</strong>
                <b>{formatPrice(item, market)}</b>
                <em className={positive ? "is-up" : negative ? "is-down" : "is-flat"}>{item.change_pct > 0 ? "+" : ""}{item.change_pct.toFixed(2)}%</em>
              </span>
            </button>
          );
        })}
      </section>

      {discussionIndex != null && items[discussionIndex] && (
        <>
          <button className="bubble-panel-scrim" type="button" aria-label="종목토론 닫기" onClick={() => setDiscussionIndex(null)} />
          <MarketBubbleDiscussion
            item={items[discussionIndex]}
            market={market}
            colors={PALETTE[palette[discussionIndex] % PALETTE.length] as [string, string]}
            onClose={() => setDiscussionIndex(null)}
          />
        </>
      )}

      <div className="bubble-switcher" role="tablist" aria-label="시장 선택">
        {MARKETS.map((entry) => <button key={entry.key} role="tab" aria-selected={market === entry.key} className={market === entry.key ? "is-active" : ""} onClick={() => { if (market !== entry.key) reportMarketBubbleEvent({ action: "market_switch", market: entry.key }); setMarket(entry.key); }}>{entry.label}</button>)}
      </div>
      <div className="bubble-instruction"><span>CLICK</span> 종목토론 보기 · <span>DOUBLE CLICK</span> 종목 상세</div>
    </main>
  );
}
