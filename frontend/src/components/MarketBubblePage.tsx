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
type Body = {
  x: number; y: number; vx: number; vy: number; r: number;
  deform: number; deformTarget: number; deformVelocity: number;
  deformAngle: number; deformAngleTarget: number;
  wobbleEnergy: number; wobblePhase: number;
  lastMatrix: string; lastOrigin: string; lastPosition: string;
  el: HTMLButtonElement | null; shell: HTMLSpanElement | null;
};

const FPS_METER_ENABLED = (() => {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("fps")) return false;
  return !["0", "off", "false", "no"].includes((params.get("fps") ?? "").trim().toLowerCase());
})();

const MARKETS: { key: Market; label: string; title: string }[] = [
  { key: "kospi", label: "코스피", title: "KOSPI 주요종목" },
  { key: "kosdaq", label: "코스닥", title: "KOSDAQ 주요종목" },
  { key: "nasdaq", label: "나스닥", title: "NASDAQ 주요종목" },
];

const PALETTE = [
  ["#e26078", "#68172f"], ["#568ed2", "#183967"], ["#45ad7d", "#174f3b"],
  ["#d39b46", "#684316"], ["#9472c5", "#412b6b"], ["#45aaa5", "#18575a"],
  ["#d87561", "#71312c"], ["#6e7fc2", "#2c3868"], ["#94aa58", "#455621"],
  ["#bd6698", "#622c4d"], ["#4d9cb4", "#225365"], ["#b98556", "#60401f"],
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

function BubbleFpsMeter({ bubbles }: { bubbles: number }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLSpanElement>(null);
  const worstRef = useRef<HTMLSpanElement>(null);
  const heapRef = useRef<HTMLSpanElement>(null);
  const runtimeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0, frames = 0, worst = 0;
    const started = performance.now();
    let since = started, previous = started;
    const tick = (now: number) => {
      const delta = now - previous; previous = now;
      if (delta < 1000) worst = Math.max(worst, delta);
      frames += 1;
      const elapsed = now - since;
      if (elapsed >= 500) {
        const fps = frames * 1000 / elapsed;
        if (fpsRef.current) fpsRef.current.textContent = fps.toFixed(0);
        if (frameRef.current) frameRef.current.textContent = `${(elapsed / frames).toFixed(1)} ms`;
        if (worstRef.current) worstRef.current.textContent = `${worst.toFixed(1)} ms`;
        if (runtimeRef.current) runtimeRef.current.textContent = `${Math.floor((now - started) / 1000)} s`;
        if (rootRef.current) rootRef.current.dataset.tone = fps >= 50 ? "good" : fps >= 30 ? "fair" : "bad";
        const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
        if (heapRef.current) heapRef.current.textContent = memory ? `${(memory.usedJSHeapSize / 1048576).toFixed(0)} MB` : "N/A";
        frames = 0; worst = 0; since = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="bubble-fps" ref={rootRef} data-tone="good" aria-hidden="true">
      <div><strong ref={fpsRef}>—</strong><b>FPS</b><span ref={frameRef}>— ms</span></div>
      <small>WORST <span ref={worstRef}>— ms</span></small>
      <small>HEAP <span ref={heapRef}>—</span></small>
      <small>RUNTIME <span ref={runtimeRef}>— s</span></small>
      <small>BUBBLES <span>{bubbles}</span></small>
    </div>
  );
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
  const stageSizeRef = useRef({ width: 0, height: 0 });
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
    const getBaseRadius = (width: number, height: number) => Math.max(22, Math.min(
      88,
      width / 10,
      height / 9.2,
      Math.sqrt((width * height) / 20) * .42,
    ));
    const base = getBaseRadius(rect.width, rect.height);
    const nextBodies: Body[] = items.map((_, i) => {
      const col = i % 5, row = Math.floor(i / 5);
      const r = base * (i < 4 ? 1.16 : i < 10 ? 1.04 : .92);
      return {
        x: ((col + .65 + (row % 2) * .16) / 5.35) * rect.width,
        y: ((row + .7) / 4.45) * rect.height,
        vx: (Math.random() - .5) * .44,
        vy: (Math.random() - .5) * .44,
        r,
        deform: 0,
        deformTarget: 0,
        deformVelocity: 0,
        deformAngle: 0,
        deformAngleTarget: 0,
        wobbleEnergy: 0,
        wobblePhase: Math.random() * Math.PI * 2,
        lastMatrix: "",
        lastOrigin: "",
        lastPosition: "",
        el: null,
        shell: null,
      };
    });
    stage.querySelectorAll<HTMLButtonElement>(".stock-bubble").forEach((el, i) => {
      const body = nextBodies[i];
      if (!body) return;
      body.el = el;
      body.shell = el.querySelector<HTMLSpanElement>(".stock-bubble-shell");
      el.style.width = `${body.r * 2}px`;
      el.style.height = `${body.r * 2}px`;
      el.style.transform = `translate3d(${body.x - body.r}px,${body.y - body.r}px,0)`;
    });
    bodiesRef.current = nextBodies;
    stageSizeRef.current = { width: rect.width, height: rect.height };
    firstLoadRef.current = false;

    const resizeStage = () => {
      const nextRect = stage.getBoundingClientRect();
      const previousSize = stageSizeRef.current;
      if (nextRect.width <= 0 || nextRect.height <= 0 ||
          (nextRect.width === previousSize.width && nextRect.height === previousSize.height)) return;

      const nextBase = getBaseRadius(nextRect.width, nextRect.height);
      bodiesRef.current.forEach((body, i) => {
        const radiusScale = i < 4 ? 1.16 : i < 10 ? 1.04 : .92;
        const nextRadius = nextBase * radiusScale;
        body.x = previousSize.width > 0 ? body.x / previousSize.width * nextRect.width : nextRect.width / 2;
        body.y = previousSize.height > 0 ? body.y / previousSize.height * nextRect.height : nextRect.height / 2;
        body.r = nextRadius;
        body.x = Math.max(nextRadius, Math.min(nextRect.width - nextRadius, body.x));
        body.y = Math.max(nextRadius, Math.min(nextRect.height - nextRadius, body.y));
        if (body.el) {
          body.el.style.width = `${nextRadius * 2}px`;
          body.el.style.height = `${nextRadius * 2}px`;
          body.el.style.transform = `translate3d(${body.x - nextRadius}px,${body.y - nextRadius}px,0)`;
        }
      });
      pointerRef.current.active = false;
      stageSizeRef.current = { width: nextRect.width, height: nextRect.height };
    };

    const observer = new ResizeObserver(resizeStage);
    observer.observe(stage);
    window.addEventListener("orientationchange", resizeStage);
    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", resizeStage);
    };
  }, [market, items.map((it) => it.code).join(",")]);

  useEffect(() => {
    let frame = 0, previous = performance.now();
    const tick = (now: number) => {
      const stage = stageRef.current;
      if (!stage) { frame = requestAnimationFrame(tick); return; }
      if (document.hidden) {
        previous = now;
        pointerRef.current.active = false;
        frame = requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min(2, (now - previous) / 16.667); previous = now;
      const width = stage.clientWidth, height = stage.clientHeight;
      const bodies = bodiesRef.current;
      const pointer = pointerRef.current;
      const excite = (body: Body, amount: number, angle: number) => {
        // Preserve the actual contact side (not only the collision axis), while
        // still taking the shortest path as that contact direction changes.
        const difference = ((angle - body.deformAngleTarget + 180) % 360 + 360) % 360 - 180;
        if (amount >= body.deformTarget * .92) body.deformAngleTarget += difference;
        if (amount > body.deformTarget + .008) {
          body.wobbleEnergy = Math.min(.225, Math.max(body.wobbleEnergy, amount * .9));
        }
        body.deformTarget = Math.max(body.deformTarget, amount);
      };
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i];
        // Ease toward a decaying target. Sustained contact holds a soft shape;
        // separation releases it gradually with a subtle gelatin overshoot.
        a.deformTarget *= Math.pow(.935, dt);
        a.wobbleEnergy *= Math.pow(.972, dt);
        a.wobblePhase += (.105 + a.wobbleEnergy * .34) * dt;
        a.deformVelocity += (a.deformTarget - a.deform) * .038 * dt;
        a.deformVelocity *= Math.pow(.94, dt);
        a.deform += a.deformVelocity * dt;
        const angleDifference = ((a.deformAngleTarget - a.deformAngle + 180) % 360 + 360) % 360 - 180;
        a.deformAngle += angleDifference * Math.min(1, .075 * dt);
        if (a.deformTarget < .0003 && Math.abs(a.deform) < .0003 && Math.abs(a.deformVelocity) < .0003) {
          a.deform = 0;
          a.deformVelocity = 0;
        }
        a.deform = Math.max(-.12, Math.min(.465, a.deform));
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
        const speed = Math.hypot(a.vx, a.vy);
        if (speed > 3.2) { const limit = 3.2 / speed; a.vx *= limit; a.vy *= limit; }
        a.x += a.vx * dt * 4.5; a.y += a.vy * dt * 4.5;
        if (a.x < a.r) { const speed = Math.abs(a.vx); a.x = a.r; a.vx = speed * .82; excite(a, Math.min(.3825, (.025 + speed * .022) * 2.8125), 180); }
        if (a.x > width - a.r) { const speed = Math.abs(a.vx); a.x = width - a.r; a.vx = -speed * .82; excite(a, Math.min(.3825, (.025 + speed * .022) * 2.8125), 0); }
        if (a.y < a.r) { const speed = Math.abs(a.vy); a.y = a.r; a.vy = speed * .82; excite(a, Math.min(.3825, (.025 + speed * .022) * 2.8125), -90); }
        if (a.y > height - a.r) { const speed = Math.abs(a.vy); a.y = height - a.r; a.vy = -speed * .82; excite(a, Math.min(.3825, (.025 + speed * .022) * 2.8125), 90); }
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
          const softness = Math.min(.405, (.025 + overlap / Math.max(20, Math.min(a.r, b.r)) * .23 + Math.max(0, -impulse) * .018) * 2.8125);
          const angle = Math.atan2(ny, nx) * 180 / Math.PI;
          excite(a, softness, angle); excite(b, softness, angle + 180);
          if (impulse < 0) { a.vx += impulse * nx * .72; a.vy += impulse * ny * .72; b.vx -= impulse * nx * .72; b.vy -= impulse * ny * .72; }
        }
      }
      bodies.forEach((body) => {
        if (body.el) {
          const squash = body.deform;
          // A settled bubble must leave its expensive translucent shell cached.
          // Continuous sub-pixel "breathing" forced all shells to composite forever.
          const isDeforming = Math.abs(squash) > .0008 || body.wobbleEnergy > .001;
          const waveA = Math.sin(body.wobblePhase) * body.wobbleEnergy;
          const impactRadians = body.deformAngle * Math.PI / 180;
          const impactX = Math.cos(impactRadians);
          const impactY = Math.sin(impactRadians);
          const normalScale = isDeforming ? Math.max(.4, Math.min(1.25, 1 - squash * 1.5 + waveA * .1)) : 1;
          const tangentScale = isDeforming ? Math.max(.78, Math.min(1.68, 1 + squash * 1.02 - waveA * .07)) : 1;
          const scaleDifference = normalScale - tangentScale;
          const matrix11 = tangentScale + scaleDifference * impactX * impactX;
          const matrix12 = scaleDifference * impactX * impactY;
          const matrix21 = matrix12;
          const matrix22 = tangentScale + scaleDifference * impactY * impactY;
          const matrix = isDeforming ? `matrix(${matrix11.toFixed(3)},${matrix12.toFixed(3)},${matrix21.toFixed(3)},${matrix22.toFixed(3)},0,0)` : "matrix(1,0,0,1,0,0)";
          const origin = `${(50 - impactX * 48).toFixed(1)}% ${(50 - impactY * 48).toFixed(1)}%`;
          const position = `translate3d(${(body.x - body.r).toFixed(1)}px,${(body.y - body.r).toFixed(1)}px,0)`;
          if (position !== body.lastPosition) { body.el.style.transform = position; body.lastPosition = position; }
          if (body.shell && matrix !== body.lastMatrix) { body.shell.style.transform = matrix; body.lastMatrix = matrix; }
          if (body.shell && origin !== body.lastOrigin) { body.shell.style.transformOrigin = origin; body.lastOrigin = origin; }
        }
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
        <div className="bubble-header-start">
          <Link to="/desk" className="bubble-back-link" aria-label="메인 대시보드로 돌아가기">
            <span aria-hidden="true">←</span>
          </Link>
          <Link to="/desk" className="bubble-brand" aria-label="K-Stock Hub 홈">
          <span className="bubble-brand-mark"><MarketBubbleIcon /></span>
          <span><strong>증시버블</strong><small>MARKET BUBBLES</small></span>
          </Link>
        </div>
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
          const lightAngle = 108 + (index * 17) % 46;
          const rimAngle = (index * 47 + 18) % 360;
          const rimWidth = 3.4 + (index % 4) * .9;
          const rimAlpha = .55 + (index % 5) * .06;
          const positive = item.change_pct > .04, negative = item.change_pct < -.04;
          return (
            <button
              key={`${market}-${item.code}`}
              ref={(el) => { if (bodiesRef.current[index]) bodiesRef.current[index].el = el; }}
              type="button"
              className="stock-bubble"
              style={{
                width: diameter,
                height: diameter,
                "--bubble-light": colors[0],
                "--bubble-dark": colors[1],
                "--bubble-light-angle": `${lightAngle}deg`,
                "--bubble-rim-angle": `${rimAngle}deg`,
                "--bubble-rim-width": `${rimWidth}px`,
                "--bubble-rim-color": `rgba(255,255,255,${rimAlpha})`,
              } as React.CSSProperties}
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
              <span className="stock-bubble-shell"><span className="stock-bubble-glass" /></span>
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
      {FPS_METER_ENABLED && <BubbleFpsMeter bubbles={items.length} />}
    </main>
  );
}
