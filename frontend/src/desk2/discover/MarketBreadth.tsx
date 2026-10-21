import { useId, useMemo, useRef, useState, type CSSProperties } from "react";
import type { MarketMapItem } from "../../api/client";
import { Link } from "../../router";
import { pct, useL } from "../lib";
import { RollingNumber } from "./OverviewMotion";
import { MOVE_BINS, overviewDistribution } from "./marketOverviewModel";

export default function MarketBreadth({ market, items, active, cycle }: { market: "kr" | "us"; items: MarketMapItem[]; active: boolean; cycle: number }) {
  const L = useL();
  const data = useMemo(() => overviewDistribution(items), [items]);
  const [selected, setSelected] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const bars = useRef<(HTMLButtonElement | null)[]>([]);
  const peak = Math.max(1, ...data.bins.map(bin => bin.length));
  const number = (text: string) => <RollingNumber text={text} active={active} />;
  return <section className="ed-market-breadth" aria-label={L("상승 비율과 종목 등락 분포", "Advancing share and stock return distribution")}>
    <div className="ed-breadth-heading"><div><span>{L("상승 종목 비율", "Advancing stocks")}</span><strong>{number(data.upShare == null ? "—" : data.upShare.toFixed(1))}<small>%</small></strong></div><p>{market === "kr" ? "KOSPI 500 · KOSDAQ 200" : "S&P 500 · NASDAQ 100"}<span>{data.total ? L(`${data.total.toLocaleString()}종목 시세 기준`, `${data.total.toLocaleString()} quoted stocks`) : L("종목 시세 확인 중", "Waiting for stock quotes")}</span></p></div>
    <div key={cycle} className="ed-breadth-line" role="img" aria-label={data.total ? L(`상승 ${data.up}, 보합 ${data.flat}, 하락 ${data.down}종목`, `${data.up} advancing, ${data.flat} unchanged, ${data.down} declining`) : L("종목 시세 확인 중", "Waiting for stock quotes")}>
      {(["up", "flat", "down"] as const).map(tone => <i key={tone} className={`is-${tone}`} style={{ width: `${data.total ? data[tone] / data.total * 100 : 0}%` }} />)}
    </div>
    <div className="ed-breadth-counts"><span className="is-up">{L("상승", "Up")} <b>{number(data.total ? String(data.up) : "—")}</b></span><span>{L("보합", "Flat")} <b>{number(data.total ? String(data.flat) : "—")}</b></span><span className="is-down">{L("하락", "Down")} <b>{number(data.total ? String(data.down) : "—")}</b></span></div>
    <div className="ed-distribution-heading"><span>{L("등락 분포", "Return distribution")}</span><small>{L("막대를 눌러 종목 보기", "Select a bar to explore")}</small><button className="ed-distribution-toggle" type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(value => !value)}>{expanded ? L("접기", "Hide") : L("분포 보기", "Explore")} <span aria-hidden="true">{expanded ? "−" : "＋"}</span></button></div>
    <div id={panelId} className={`ed-distribution-panel${expanded ? " is-open" : ""}`}>
    <div className={`ed-distribution${!data.total ? " is-empty" : ""}`} role="group" aria-label={L("등락률 구간별 종목 수", "Stock counts by return range")}>
      {MOVE_BINS.map((bin, index) => <button type="button" key={bin.label} ref={element => { bars.current[index] = element; }} className={`is-${bin.tone}${selected === index ? " is-selected" : ""}`} disabled={!data.total} aria-pressed={selected === index}
        aria-label={`${L(bin.range, bin.en)} · ${L(`${data.bins[index].length}종목`, `${data.bins[index].length} stocks`)}`} onClick={() => setSelected(current => current === index ? null : index)}>
        <span className="ed-distribution-plot"><i style={{ "--bar-height": `${data.bins[index].length / peak * 48}px` } as CSSProperties} /><b>{data.total ? data.bins[index].length : "—"}</b></span><span className="ed-distribution-label">{bin.label}</span>
      </button>)}
    </div>
    {selected != null && <div className="ed-distribution-detail" aria-live="polite"><div><b>{L(MOVE_BINS[selected].range, MOVE_BINS[selected].en)}</b><span>{L(`${data.bins[selected].length}종목`, `${data.bins[selected].length} stocks`)}</span><button type="button" aria-label={L("구간 종목 닫기", "Close selected range")} onClick={() => { setSelected(null); bars.current[selected]?.focus(); }}>×</button></div>
      {data.bins[selected].slice(0, 3).map(item => <Link key={item.code} to={`/stock/${encodeURIComponent(item.code)}`}><span>{item.name || item.code}</span><b className={`is-${item.change_pct > 0 ? "up" : item.change_pct < 0 ? "down" : "flat"}`}>{pct(item.change_pct)} ↗</b></Link>)}
      {!data.bins[selected].length && <p>{L("이 구간에 해당하는 종목이 없습니다.", "No stocks in this range.")}</p>}
      {data.bins[selected].length > 3 && <p>{L("등락 폭이 큰 3종목을 표시합니다.", "Showing the three largest absolute moves.")}</p>}
    </div>}
    <p className="ed-distribution-foot">{L("등락률 단위 % · 중복 종목 제외", "Returns in % · duplicate symbols excluded")}{data.received > data.total && ` · ${L(`시세 미확인 ${data.received - data.total}종목 제외`, `${data.received - data.total} unquoted stocks excluded`)}`}</p>
    </div>
  </section>;
}
