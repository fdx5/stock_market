import { useState } from "react";
import { Link } from "../router";
import { pct } from "../desk2/lib";
import { DiscoveryMarket, DiscoveryRow, MARKET_NAMES } from "./discoveryModel";
import { marketInside, peerTradeoffs, recoveryScenario, targetDistance } from "./insightModel";
import { BoardSymbolPicker } from "./SymbolPicker";

const sign = (v: number | null, suffix = "%") => v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}${suffix}`;
function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="mdis-insight-metric"><small>{label}</small><strong>{value}</strong><p>{note}</p></article>;
}

export function MarketInside({ rows, market }: { rows: DiscoveryRow[]; market: DiscoveryMarket }) {
  const inside = marketInside(rows.filter(r => r.market === market));
  const upRatio = inside.count ? inside.up / inside.count * 100 : null;
  return <section aria-labelledby="mdis-inside-title">
    <div className="mdis-verdict"><span>QUESTION 01 / 체감과 숫자가 다른 이유</span><h2 id="mdis-inside-title">{inside.weighted === null ? "비교할 집계를 기다리고 있습니다." : inside.divergence ? "평균은 상승, 오른 종목은 절반 미만입니다." : inside.signFlip ? "시총 상위 3종목을 빼면 상승·하락 방향이 바뀝니다." : inside.weighted > 0 && (upRatio ?? 0) >= 60 ? "현재 표본에서는 상승이 비교적 넓게 퍼져 있습니다." : "표본 평균과 개별 종목의 움직임을 함께 읽어보세요."}</h2><p>아래 두 평균은 같은 {inside.count}종목으로 계산했습니다. {inside.total - inside.count}종목은 시가총액 또는 등락률이 없어 제외했습니다. 실제 {market === "nasdaq" ? "나스닥 지수" : market === "kospi" ? "코스피 지수" : "코스닥 지수"} 등락률이 아닙니다.</p></div>
    <div className="mdis-insight-grid"><Metric label="덩치대로 반영하면" value={sign(inside.weighted)} note="현재 표본 시가총액 가중 평균" /><Metric label="한 종목에 한 표씩 주면" value={sign(inside.equal)} note="위와 동일한 종목의 단순평균" /><Metric label="실제로 오른 종목 비율" value={upRatio === null ? "—" : `${upRatio.toFixed(1)}%`} note={`상승 ${inside.up} · 보합 ${inside.flat} · 하락 ${inside.down}`} /></div>
    <section className="mdis-counterfactual" aria-labelledby="mdis-exclude-title"><div><span>WHAT IF / 같은 표본에서 빼보기</span><h2 id="mdis-exclude-title">시가총액 상위 3종목을 빼면?</h2><p>상승 기여도가 큰 종목 순위가 아니라, 현재 시가총액 순으로 3종목을 제외합니다. 실제 지수를 재구성한 결과가 아닙니다.</p></div><div><strong>{sign(inside.withoutTop3)}</strong><small>나머지 종목의 시총가중 평균</small></div></section>
    <div className="mdis-insight-grid"><Metric label="상위 3종목 시총 비중" value={inside.topShare === null ? "—" : `${inside.topShare.toFixed(1)}%`} note="완전한 데이터가 있는 표본 내 비중" /><Metric label="상위 3종목의 평균 기여" value={sign(inside.contribution, "%p")} note="세 종목이 표본 가중평균에 더한 값" /><Metric label="가중평균 − 단순평균" value={inside.weighted === null || inside.equal === null ? "—" : sign(inside.weighted - inside.equal, "%p")} note="두 계산방식의 차이, 예측 지표가 아닙니다." /></div>
    <div className="mdis-evidence-list"><h3>제외한 종목을 직접 확인하세요</h3>{inside.leaders.map(r => <Link key={r.id} to={`/stock/${r.code}`}><span>{r.name} <small>{r.code}</small></span><b>{pct(r.change)} ↗</b></Link>)}</div>
    <details className="mdis-explainer"><summary>해석 규칙과 한계</summary><p>“평균 상승·절반 미만 상승”은 시총가중 평균이 0보다 크고 상승 종목 수가 계산 표본의 절반보다 작을 때 표시합니다. “넓게 퍼진 상승”은 시총가중 평균이 양수이고 상승 비율이 60% 이상일 때 쓰는 화면 설명 규칙입니다. 60%는 통계적으로 검증된 매매 기준이 아닙니다.</p><p>TOP 100 표본 편향, 시장별 시세 지연, 장전·장후 거래 기준을 확인하세요. 상위 종목을 제외한 결과는 반사실적 계산이며 이후 시장 방향을 예측하지 않습니다.</p></details>
  </section>;
}

export function TradeoffLab({ rows, market, baseId, onBase }: { rows: DiscoveryRow[]; market: DiscoveryMarket; baseId: string | null; onBase: (id: string) => void }) {
  const candidates = rows.filter(r => r.market === market);
  const base = candidates.find(r => r.id === baseId) ?? candidates[0];
  const peers = base ? candidates.filter(r => r.sector === base.sector && r.id !== base.id).sort((a, b) => a.name.localeCompare(b.name, "ko-KR")) : [];
  return <section aria-labelledby="mdis-tradeoff-title"><div className="mdis-verdict"><span>QUESTION 02 / 후보를 바꾸면 달라지는 것</span><h2 id="mdis-tradeoff-title">같은 업종에서 후보를 바꾸면, 어떤 조건이 달라질까요?</h2><p>같은 시장·같은 업종의 표본끼리 비교합니다. 기준 종목과 다른 점, 비교할 수 없는 항목과 그 이유를 함께 보여줍니다.</p></div>
    <div className="mdis-base-picker"><BoardSymbolPicker rows={candidates} value={base?.id ?? ""} onSelect={onBase} /></div>
    {base && <p className="mdis-method">{MARKET_NAMES[market]} / {base.sector} / 같은 업종 후보 {peers.length}종목. 차이는 “후보 − {base.name}”입니다. 서로 다른 결산 기준일의 지표일 수 있습니다.</p>}
    <div className="mdis-sector-grid">{peers.map(peer => {
      const trades = peerTradeoffs(base!, peer), available = trades.filter(t => t.delta !== null).length;
      return <article className="mdis-sector-card mdis-tradeoff-card" key={peer.id}><h3><Link to={`/stock/${peer.code}`}>{peer.name} ↗</Link></h3><small>{peer.code} · 비교 가능 {available}/4 항목</small><dl>{trades.map(t => <div key={t.label}><dt>{t.label} 차이</dt><dd>{sign(t.delta, ` ${t.unit}`)}</dd><small>{t.delta === null ? "한쪽 이상 미제공: 비교하지 않습니다." : t.interpretation}</small></div>)}</dl><Link className="mdis-text-link" to={`/stock-compare?codes=${encodeURIComponent(`${base!.id},${peer.id}`)}`}>두 종목 원표 비교 ↗</Link></article>;
    })}</div>{!peers.length && <p className="mdis-empty">현재 표본에서 같은 업종의 다른 종목을 찾지 못했습니다. 다른 기준 종목이나 시장을 선택하세요.</p>}
  </section>;
}

export function RecoveryLab({ rows, market }: { rows: DiscoveryRow[]; market: DiscoveryMarket }) {
  // Private hypothetical input stays in component memory: never URL, storage, API, or logs.
  const [lossInput, setLossInput] = useState("30");
  const [targetInput, setTargetInput] = useState("");
  const [stockId, setStockId] = useState("");
  const choices = rows.filter(r => r.market === market);
  const stock = choices.find(r => r.id === stockId) ?? choices[0];
  const loss = lossInput.trim() ? recoveryScenario(Number(lossInput)) : null;
  const target = targetInput.trim() ? Number(targetInput) : null;
  const distance = targetDistance(stock?.close ?? null, target);
  return <section aria-labelledby="mdis-recovery-title" data-track="self"><div className="mdis-verdict"><span>QUESTION 03 / 손실과 회복은 대칭이 아닙니다</span><h2 id="mdis-recovery-title">30% 하락한 뒤, 30% 오르면 회복될까요?</h2><p>가상의 출발값 100으로 직접 실험하세요. 수수료·세금·배당·환율을 제외한 산술 계산입니다. 개인 입력값은 이 화면의 메모리에서만 사용합니다.</p></div>
    <div className="mdis-recovery-controls"><label>가정한 하락률 (%)<input type="number" min="0" max="99.99" step="any" value={lossInput} onChange={e => setLossInput(e.target.value)} /></label><div className="mdis-presets" role="group" aria-label="하락률 시나리오">{[10, 20, 30, 50, 70].map(v => <button type="button" key={v} aria-pressed={Number(lossInput) === v} onClick={() => setLossInput(String(v))}>{v}% 하락</button>)}</div></div>
    {loss ? <><div className="mdis-insight-grid"><Metric label="출발" value="100.00" note="원화 금액이 아닌 가상의 기준값" /><Metric label="하락한 뒤 남은 값" value={loss.remaining.toFixed(2)} note={`100 × (1 − ${loss.loss.toFixed(2)} / 100)`} /><Metric label="100으로 돌아가는 데 필요한 상승" value={`+${loss.recovery.toFixed(2)}%`} note="하락률 / (100 − 하락률) × 100" /></div><div className="mdis-recovery-bars" aria-label="출발값과 잔여값"><div><span>출발 100</span><i style={{ width: "100%" }} /></div><div><span>하락 후 {loss.remaining.toFixed(2)}</span><i style={{ width: `${loss.remaining}%` }} /></div></div></> : <p className="mdis-notice" role="status">하락률은 0 이상, 100 미만의 숫자로 입력하세요. 100% 손실에서는 상승률로 원금을 회복할 수 없습니다.</p>}
    <section className="mdis-target-lab" aria-labelledby="mdis-target-title"><h3 id="mdis-target-title">선택한 종목의 목표 가격까지는 얼마나 멀까요?</h3><p>원하는 가격까지의 단순 거리입니다. 목표 도달 가능성이나 소요 기간을 예측하지 않습니다.</p><div className="mdis-recovery-controls"><BoardSymbolPicker rows={choices} value={stock?.id ?? ""} onSelect={id => { setStockId(id); setTargetInput(""); }} /><label>가정한 목표 가격 ({stock?.currency ?? "KRW"})<input type="number" step="any" min="0.01" placeholder="직접 입력" value={targetInput} onChange={e => setTargetInput(e.target.value)} /></label></div><div className="mdis-insight-grid"><Metric label="수신 현재가" value={stock?.close?.toLocaleString("ko-KR") ?? "—"} note={stock?.currency ?? "통화 미제공"} /><Metric label="입력한 목표까지" value={sign(distance)} note="(목표 가격 / 현재가 − 1) × 100" /><Metric label="52주 고가까지" value={sign(targetDistance(stock?.close ?? null, stock?.high ?? null))} note="과거 고가의 재도달을 보장하지 않습니다." /></div>{targetInput && distance === null && <p className="mdis-notice" role="status">양수인 목표 가격과 유효한 현재가가 필요합니다.</p>}</section>
  </section>;
}
