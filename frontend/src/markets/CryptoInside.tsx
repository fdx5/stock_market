import { useMemo, useState } from "react";
import { useResearch } from "./researchApi";
import type { DataRow } from "./researchApi";
import { n, p, ResourceState } from "./ResearchUI";
import "./cryptoInside.css";

const MAJORS = ["BTC", "ETH", "XRP", "SOL", "DOGE"];
const MIN_TURNOVER = 1e9; // 강세·약세 목록은 24시간 거래대금 10억 원 이상만
const BUCKETS: [string, number, number][] = [["-10% 이하", -Infinity, -10], ["-10~-5%", -10, -5], ["-5~-2%", -5, -2], ["-2~0%", -2, 0], ["0~+2%", 0, 2], ["+2~+5%", 2, 5], ["+5~+10%", 5, 10], ["+10% 이상", 10, Infinity]];
const SORTS = { turnover: "거래대금 많은 순", up: "상승률 높은 순", down: "하락률 높은 순", drawdown: "52주 고점에서 먼 순", near: "52주 고점에 가까운 순" } as const;

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => xs.length ? sum(xs) / xs.length : null;
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const tone = (v: unknown) => !num(v) || v === 0 ? "" : v > 0 ? "ci-up" : "ci-down";
const share = (part: number, whole: number) => whole > 0 ? part / whole * 100 : null;
const pct = (v: number | null, digits = 1) => v === null ? "—" : `${n(v, digits)}%`;
export function krw(v: unknown) {
  if (!num(v)) return "—";
  if (v >= 1e12) return `${n(v / 1e12, 2)}조`;
  if (v >= 1e8) return `${n(v / 1e8, v >= 1e10 ? 0 : 1)}억`;
  if (v >= 1e4) return `${n(v / 1e4, 0)}만`;
  return n(v, 0);
}
const price = (v: unknown) => !num(v) ? "—" : n(v, v >= 100 ? 0 : v >= 1 ? 2 : 4);
const fromHigh = (r: DataRow) => num(r.price) && num(r.high_52w) && r.high_52w > 0 ? (r.price / r.high_52w - 1) * 100 : null;
const range52 = (r: DataRow) => num(r.price) && num(r.high_52w) && num(r.low_52w) && r.high_52w > r.low_52w ? Math.min(100, Math.max(0, (r.price - r.low_52w) / (r.high_52w - r.low_52w) * 100)) : null;

type Regime = { title: string; body: string };
function readRegime(btc: number | null, altMedian: number | null, upRatio: number | null, btcShare: number | null): Regime {
  if (btc === null || altMedian === null || upRatio === null) return { title: "시세를 받는 중입니다", body: "자료가 도착하면 비트코인과 나머지 코인의 움직임을 비교합니다." };
  const gap = altMedian - btc, s = (v: number) => p(v);
  const lead = `비트코인 ${s(btc)}, 알트코인 중앙값 ${s(altMedian)}, 오른 코인은 ${pct(upRatio, 0)}입니다.`;
  if (upRatio >= 65 && altMedian > 0 && gap >= 0) return { title: "비트코인보다 알트코인이 더 강한, 넓게 퍼진 상승", body: `${lead} 대장주만이 아니라 대부분의 코인이 함께 오르고 있습니다. 이런 날에는 평소 거래가 적던 코인까지 들썩이기 쉬워 거래대금이 함께 늘었는지 확인하는 것이 좋습니다.` };
  if (upRatio >= 55 && altMedian > 0) return { title: "비트코인이 끌고 알트코인이 따라가는 상승", body: `${lead} 상승이 시장 전반으로 번지고 있지만 폭은 비트코인이 더 큽니다. 알트코인 거래대금 비중이 늘어나는지가 확산이 이어질지의 단서입니다.` };
  if (btc > 0 && upRatio < 45) return { title: "비트코인만 오르는 집중 장세", body: `${lead} 비트코인 가격만 보면 시장이 좋아 보이지만 실제로는 내린 코인이 더 많습니다.${btcShare !== null ? ` 비트코인이 전체 거래대금의 ${pct(btcShare)}를 차지합니다.` : ""} 보유 코인이 비트코인이 아니라면 체감은 더 나쁠 수 있습니다.` };
  if (btc < 0 && upRatio >= 50) return { title: "비트코인은 쉬고 알트코인이 버티는 장", body: `${lead} 대장주는 내렸지만 절반 이상의 코인이 올랐습니다. 비트코인에서 빠진 자금이 다른 코인으로 옮겨갔을 수도 있지만, 단일 거래소 하루 표본만으로 자금 이동을 단정할 수는 없습니다.` };
  if (upRatio <= 30 && altMedian < 0) return { title: "대부분의 코인이 함께 내리는 약세", body: `${lead} 하락이 특정 코인이 아니라 시장 전반에 퍼져 있습니다. 이럴 때는 스테이블코인 거래가 늘어나는지(관망·환전 수요)를 함께 보세요.` };
  return { title: "방향이 뚜렷하지 않은 혼조", body: `${lead} 오른 코인과 내린 코인이 비슷하게 섞여 있습니다. 개별 코인의 소식이나 거래량 급등이 가격을 좌우하는 날일 가능성이 큽니다.` };
}

function Section({ no, kicker, title, lead, children }: { no: string; kicker: string; title: string; lead?: string; children: React.ReactNode }) {
  return <section className="ci-section" aria-labelledby={`ci-${no}`}><header><span>{no} · {kicker}</span><h2 id={`ci-${no}`}>{title}</h2>{lead && <p>{lead}</p>}</header>{children}</section>;
}
function Meter({ label, value, max = 100, note, signed }: { label: string; value: number | null; max?: number; note?: string; signed?: boolean }) {
  const w = value === null ? 0 : Math.min(100, Math.abs(value) / max * 100);
  return <div className="ci-meter"><span>{label}</span><div><i className={signed ? tone(value) : ""} style={{ width: `${w}%` }} /></div><b className={signed ? tone(value) : ""}>{value === null ? "—" : signed ? p(value) : pct(value)}</b>{note && <small>{note}</small>}</div>;
}
function CoinList({ title, rows, empty }: { title: string; rows: DataRow[]; empty: string }) {
  return <div className="ci-list"><h3>{title}</h3>{rows.length ? <ol>{rows.map(r => <li key={r.code}><span><b>{r.name}</b><small>{r.symbol}{r.warning && <em className="ci-flag">유의</em>}</small></span><span className={tone(r.change)}>{p(r.change)}</span><small>{krw(r.turnover)}</small></li>)}</ol> : <p className="ci-muted">{empty}</p>}</div>;
}

export default function CryptoInside() {
  const resource = useResearch("/api/discovery/crypto");
  const [q, setQ] = useState(""), [sort, setSort] = useState<keyof typeof SORTS>("turnover"), [hideStable, setHideStable] = useState(true), [onlyFlag, setOnlyFlag] = useState(false), [limit, setLimit] = useState(20);
  const data = resource.data, rows: DataRow[] = data?.items ?? [];

  const m = useMemo(() => {
    const valid = rows.filter(r => num(r.change));
    const stable = valid.filter(r => r.stable), coins = valid.filter(r => !r.stable);
    const alts = coins.filter(r => !["BTC", "ETH"].includes(r.symbol));
    const bySym = Object.fromEntries(valid.map(r => [r.symbol, r]));
    const t = (xs: DataRow[]) => sum(xs.map(r => num(r.turnover) ? r.turnover : 0));
    const total = t(valid), altTurn = t(alts);
    const altW = altTurn > 0 ? sum(alts.map(r => r.change * (num(r.turnover) ? r.turnover : 0))) / altTurn : null;
    const up = coins.filter(r => r.change > 0).length, down = coins.filter(r => r.change < 0).length;
    const ranked = [...valid].sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0));
    const liquid = alts.filter(r => num(r.turnover) && r.turnover >= MIN_TURNOVER);
    const dd = coins.map(fromHigh).filter(num);
    const flagged = valid.filter(r => r.warning || (r.cautions?.length ?? 0) > 0);
    const cautionCount: Record<string, number> = {};
    for (const r of valid) for (const c of r.cautions ?? []) cautionCount[c] = (cautionCount[c] ?? 0) + 1;
    return {
      valid, coins, alts, stable, bySym, total, up, down, flat: coins.length - up - down,
      upRatio: coins.length ? up / coins.length * 100 : null,
      btc: num(bySym.BTC?.change) ? bySym.BTC.change : null, eth: num(bySym.ETH?.change) ? bySym.ETH.change : null,
      allMean: mean(coins.map(r => r.change)), altMean: mean(alts.map(r => r.change)), altMedian: median(alts.map(r => r.change)), altW,
      btcShare: share(t(valid.filter(r => r.symbol === "BTC")), total), ethShare: share(t(valid.filter(r => r.symbol === "ETH")), total),
      altShare: share(altTurn, total), stableShare: share(t(stable), total), top10Share: share(t(ranked.slice(0, 10)), total), top10: ranked.slice(0, 10),
      hist: BUCKETS.map(([label, lo, hi]) => ({ label, lo, count: coins.filter(r => r.change > lo && r.change <= hi || (lo === -Infinity && r.change <= hi)).length })),
      gainers: [...liquid].sort((a, b) => b.change - a.change).slice(0, 8).filter(r => r.change > 0),
      losers: [...liquid].sort((a, b) => a.change - b.change).slice(0, 8).filter(r => r.change < 0),
      nearHigh: dd.filter(v => v >= -10).length, deep: dd.filter(v => v <= -70).length, ddMedian: median(dd), ddCount: dd.length,
      nearLow: coins.filter(r => num(r.price) && num(r.low_52w) && r.low_52w > 0 && r.price <= r.low_52w * 1.1).length,
      flagged, warnings: valid.filter(r => r.warning), cautionCount,
    };
  }, [rows]);

  const regime = readRegime(m.btc, m.altMedian, m.upRatio, m.btcShare);
  const scale = Math.max(5, ...[m.btc, m.altMean, m.altMedian, m.altW].map(v => Math.abs(v ?? 0)));
  const histMax = Math.max(1, ...m.hist.map(h => h.count));
  const premium = data?.premium;
  const table = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = m.valid.filter(r => (!hideStable || !r.stable) && (!onlyFlag || r.warning || r.cautions?.length) && (!needle || `${r.name} ${r.symbol} ${r.english_name ?? ""}`.toLowerCase().includes(needle)));
    const key = { turnover: (r: DataRow) => -(r.turnover ?? 0), up: (r: DataRow) => -r.change, down: (r: DataRow) => r.change, drawdown: (r: DataRow) => fromHigh(r) ?? 0, near: (r: DataRow) => -(fromHigh(r) ?? -999) }[sort];
    return list.sort((a, b) => key(a) - key(b));
  }, [m.valid, q, sort, hideStable, onlyFlag]);

  return <div className="ci">
    <ResourceState resource={resource} />
    <section className="ci-verdict" aria-live="polite">
      <span>TODAY'S READ · 지금 시장의 모양</span>
      <h2>{regime.title}</h2>
      <p>{regime.body}</p>
      <button type="button" onClick={resource.reload}>최신 시세로 다시 계산</button>
    </section>

    <div className="ci-kpis">
      {[
        { label: "비트코인", value: p(m.btc), cls: tone(m.btc), note: `거래대금 비중 ${pct(m.btcShare)}` },
        { label: "이더리움", value: p(m.eth), cls: tone(m.eth), note: `거래대금 비중 ${pct(m.ethShare)}` },
        { label: "알트코인 중앙값", value: p(m.altMedian), cls: tone(m.altMedian), note: `BTC·ETH·스테이블 제외 ${m.alts.length}개` },
        { label: "오른 코인 비율", value: pct(m.upRatio, 0), cls: "", note: `상승 ${m.up} · 보합 ${m.flat} · 하락 ${m.down}` },
        { label: "상위 10개 거래 집중도", value: pct(m.top10Share, 0), cls: "", note: "전체 거래대금 중 상위 10개 몫" },
        { label: "스테이블코인 거래 비중", value: pct(m.stableShare), cls: "", note: "달러 연동 코인 매매(환전·관망 수요)" },
      ].map(k => <article key={k.label}><small>{k.label}</small><strong className={k.cls}>{k.value}</strong><p>{k.note}</p></article>)}
    </div>

    <Section no="01" kicker="집중인가 확산인가" title="평균을 어떻게 내느냐에 따라 시장이 달라 보입니다" lead="같은 업비트 원화마켓 표본을 네 가지 방식으로 요약했습니다. 비트코인과 알트코인 수치의 차이가 클수록 비트코인 쪽으로 쏠린 장입니다.">
      <div className="ci-meters">
        <Meter label="비트코인" value={m.btc} max={scale} signed />
        <Meter label="알트 거래대금 가중" value={m.altW} max={scale} signed note="거래가 많은 코인일수록 크게 반영" />
        <Meter label="알트 단순평균" value={m.altMean} max={scale} signed note="급등 코인 몇 개에 끌려 올라갈 수 있음" />
        <Meter label="알트 중앙값" value={m.altMedian} max={scale} signed note="가운데 순번 코인 · 보통 코인의 체감" />
      </div>
      {m.altMean !== null && m.altMedian !== null && Math.abs(m.altMean - m.altMedian) >= 1 && <p className="ci-callout">알트코인 단순평균({p(m.altMean)})과 중앙값({p(m.altMedian)})이 {n(Math.abs(m.altMean - m.altMedian), 1)}%p 벌어져 있습니다. {m.altMean > m.altMedian ? "일부 코인의 급등이 평균을 끌어올렸다는 뜻입니다. 보통 코인의 체감은 중앙값 쪽에 가깝습니다." : "일부 코인의 급락이 평균을 끌어내렸다는 뜻입니다. 보통 코인은 평균만큼 나쁘지 않습니다."}</p>}
    </Section>

    <Section no="02" kicker="등락 분포" title="코인 몇 개가 얼마나 움직였나" lead="스테이블코인을 뺀 전체 코인의 오늘 등락률을 구간별로 셌습니다. 오른쪽 막대가 길면 상승이 넓게 퍼진 것이고, 양 끝이 길면 급등락이 많은 과열·투매 국면입니다.">
      <div className="ci-hist" role="img" aria-label={m.hist.map(h => `${h.label} ${h.count}개`).join(", ")}>
        {m.hist.map(h => <div key={h.label} className={h.lo >= 0 ? "ci-up-bg" : "ci-down-bg"}><b>{h.count}</b><i style={{ height: `${h.count / histMax * 100}%` }} /><small>{h.label}</small></div>)}
      </div>
    </Section>

    <Section no="03" kicker="돈의 쏠림" title="거래대금은 어디로 몰렸나" lead="시가총액 대신 최근 24시간 원화 거래대금으로 관심의 크기를 봅니다. 스테이블코인 비중이 크면 코인을 사기보다 원화와 달러 사이를 오가는 거래가 많다는 뜻입니다.">
      <div className="ci-split">
        <div className="ci-stack" aria-label="거래대금 구성">
          <div className="ci-stackbar">{[["비트코인", m.btcShare, "a"], ["이더리움", m.ethShare, "b"], ["알트코인", m.altShare, "c"], ["스테이블코인", m.stableShare, "d"]].map(([label, v, k]) => <i key={String(label)} className={`ci-seg-${k}`} style={{ width: `${v ?? 0}%` }} title={`${label} ${pct(v as number | null)}`} />)}</div>
          <ul>{[["비트코인", m.btcShare, "a"], ["이더리움", m.ethShare, "b"], ["알트코인", m.altShare, "c"], ["스테이블코인", m.stableShare, "d"]].map(([label, v, k]) => <li key={String(label)}><i className={`ci-seg-${k}`} />{label}<b>{pct(v as number | null)}</b></li>)}</ul>
          <p className="ci-muted">전체 24시간 거래대금 {krw(m.total)}원</p>
        </div>
        <ol className="ci-rank">{m.top10.map((r, i) => <li key={r.code}><span>{i + 1}</span><b>{r.name}<small>{r.symbol}{r.stable && " · 스테이블"}</small></b><div><i style={{ width: `${share(r.turnover ?? 0, m.top10[0]?.turnover ?? 0) ?? 0}%` }} /></div><em className={tone(r.change)}>{p(r.change)}</em><small>{krw(r.turnover)} · {pct(share(r.turnover ?? 0, m.total))}</small></li>)}</ol>
      </div>
    </Section>

    <Section no="04" kicker="강세와 약세" title="오늘 가장 강한 코인과 약한 코인" lead={`거래가 거의 없는 코인의 착시를 줄이려고 24시간 거래대금 ${krw(MIN_TURNOVER)}원 이상인 알트코인만 골랐습니다. '유의' 표시는 업비트가 지정한 투자유의 종목입니다.`}>
      <div className="ci-lists"><CoinList title="상승 상위" rows={m.gainers} empty="조건을 만족하는 상승 코인이 없습니다." /><CoinList title="하락 상위" rows={m.losers} empty="조건을 만족하는 하락 코인이 없습니다." /></div>
    </Section>

    <Section no="05" kicker="1년 위치" title="52주 고점과 저점 사이 어디쯤인가" lead="하루 등락만으로는 지금이 비싼지 싼지 알 수 없습니다. 업비트가 제공하는 52주 최고가·최저가로 현재 위치를 봅니다.">
      <div className="ci-kpis ci-kpis--3">
        <article><small>52주 고점에서 10% 이내</small><strong>{m.nearHigh}개</strong><p>신고가 부근 · 강한 추세</p></article>
        <article><small>52주 저점에서 10% 이내</small><strong>{m.nearLow}개</strong><p>바닥권 · 약세 지속 또는 반등 후보</p></article>
        <article><small>고점 대비 하락률 중앙값</small><strong className={tone(m.ddMedian)}>{p(m.ddMedian)}</strong><p>{m.ddCount}개 중 {m.deep}개는 고점 대비 -70% 이하</p></article>
      </div>
      <div className="ci-ranges">{MAJORS.map(s => m.bySym[s]).filter(Boolean).map(r => { const pos = range52(r); return <div key={r.code}><b>{r.name}<small>{r.symbol}</small></b><div className="ci-range"><i style={{ left: `${pos ?? 0}%` }} /></div><span>{price(r.low_52w)}</span><span>{price(r.high_52w)}</span><em className={tone(fromHigh(r))}>고점 대비 {p(fromHigh(r))}</em><small>고점 {r.high_52w_date ?? "—"} · 저점 {r.low_52w_date ?? "—"}</small></div>; })}</div>
    </Section>

    <Section no="06" kicker="김치 프리미엄" title="국내 코인 가격은 해외보다 얼마나 비싼가" lead="업비트 원화 가격을 해외 거래소(Coinbase) 달러 가격에 환율을 곱한 값과 비교합니다. 국내 수요가 몰리면 프리미엄이 커지고, 국내 투자심리가 식으면 작아지거나 역전됩니다.">
      {premium?.rows?.length ? <>
        <div className="ci-kpis ci-kpis--3">
          <article><small>원/달러 환율 (하나은행 고시)</small><strong>{n(premium.usd_krw, 1)}</strong><p>환율 미수신 시 프리미엄 계산 생략</p></article>
          <article><small>업비트 테더(USDT) 가격</small><strong>{n(premium.usdt_krw, 0)}</strong><p>국내에서 거래되는 달러 가격</p></article>
          <article><small>테더 프리미엄</small><strong className={tone(premium.tether_premium)}>{p(premium.tether_premium)}</strong><p>국내 달러 수요의 온도</p></article>
        </div>
        <div className="rs-table-wrap"><table className="rs-table ci-table"><caption>주요 코인 국내외 가격 차이</caption><thead><tr><th scope="col">코인</th><th scope="col">업비트 원화</th><th scope="col">해외 달러 가격</th><th scope="col">환율 기준 프리미엄</th><th scope="col">테더 기준 차이</th></tr></thead><tbody>{premium.rows.map((r: DataRow) => <tr key={r.coin}><th scope="row">{m.bySym[r.coin]?.name ?? r.coin} <small className="ci-muted">{r.coin}</small></th><td>{price(r.krw)}</td><td>{n(r.usdt, r.usdt >= 100 ? 1 : 4)}</td><td className={tone(r.premium_fx)}>{p(r.premium_fx)}</td><td className={tone(r.premium_usdt)}>{p(r.premium_usdt)}</td></tr>)}</tbody></table></div>
        <p className="ci-callout">환율 기준 프리미엄은 "해외에서 사서 국내에서 팔면 얼마나 차이 나는가"에 가깝고, 테더 기준 차이는 국내 달러(테더) 가격을 썼을 때 남는 코인 자체의 차이입니다. 두 값이 비슷하면 프리미엄의 대부분이 코인이 아니라 국내 달러 수요에서 나온 것입니다. 환율 고시 시각과 코인 시세 시각이 조금 다를 수 있습니다.</p>
      </> : <p className="ci-muted">해외 시세나 환율을 받지 못해 이번에는 프리미엄을 계산하지 않았습니다.</p>}
    </Section>

    <Section no="07" kicker="경고 신호" title="업비트가 붙인 주의 표시" lead="업비트는 가격 급등락·거래량 급등·입금량 급등·해외 가격 차이·소수 계정 집중이 감지된 코인에 주의 표시를, 위험이 큰 코인에는 투자유의를 지정합니다. 표시가 많은 날은 단기 투기성 거래가 활발하다는 신호입니다.">
      <div className="ci-chips">{Object.entries(m.cautionCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => <span key={k}>{k}<b>{v}</b></span>)}<span className="ci-chip-warn">투자유의<b>{m.warnings.length}</b></span></div>
      {m.flagged.length ? <div className="ci-flagged">{m.flagged.slice(0, 24).map(r => <span key={r.code}><b>{r.name}</b><em className={tone(r.change)}>{p(r.change)}</em><small>{r.warning ? "투자유의" : ""}{r.warning && r.cautions?.length ? " · " : ""}{(r.cautions ?? []).join(" · ")}</small></span>)}</div> : <p className="ci-muted">현재 주의 표시가 붙은 코인이 없습니다.</p>}
    </Section>

    <Section no="08" kicker="전체 원표" title="모든 원화마켓 코인 한눈에 보기" lead="검색·정렬·필터로 직접 확인하세요. 모든 수치는 위 계산과 같은 수신 표본입니다.">
      <div className="ci-controls">
        <label className="rs-field">코인 검색<input value={q} onChange={e => { setQ(e.target.value); setLimit(20); }} placeholder="비트코인, BTC, Solana" /></label>
        <label className="rs-field">정렬<select value={sort} onChange={e => setSort(e.target.value as keyof typeof SORTS)}>{Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="ci-check"><input type="checkbox" checked={hideStable} onChange={e => setHideStable(e.target.checked)} />스테이블코인 숨기기</label>
        <label className="ci-check"><input type="checkbox" checked={onlyFlag} onChange={e => setOnlyFlag(e.target.checked)} />주의 표시 코인만</label>
      </div>
      <div className="rs-table-wrap" tabIndex={0} role="region" aria-label="원화마켓 전체 코인"><table className="rs-table ci-table"><caption>원화마켓 코인 · {table.length}개</caption><thead><tr><th scope="col">코인</th><th scope="col">현재가(원)</th><th scope="col">오늘 등락</th><th scope="col">24시간 거래대금</th><th scope="col">52주 고점 대비</th><th scope="col">1년 범위 위치</th><th scope="col">신호</th></tr></thead>
        <tbody>{table.slice(0, limit).map(r => { const pos = range52(r); return <tr key={r.code}><th scope="row">{r.name}<small className="ci-muted"> {r.symbol}</small></th><td>{price(r.price)}</td><td className={tone(r.change)}>{p(r.change)}</td><td>{krw(r.turnover)}</td><td className={tone(fromHigh(r))}>{p(fromHigh(r))}</td><td>{pos === null ? "—" : <span className="ci-mini"><i style={{ left: `${pos}%` }} /></span>}</td><td>{r.warning && <em className="ci-flag">유의</em>}{r.stable && <em className="ci-tag">스테이블</em>}{(r.cautions ?? []).map((c: string) => <em key={c} className="ci-tag">{c}</em>)}</td></tr>; })}</tbody></table>
        {table.length > limit && <button type="button" className="rs-table-more" onClick={() => setLimit(v => v + 30)}>30개 더 보기 ({Math.min(limit, table.length)}/{table.length})</button>}
        {!table.length && <p className="rs-empty">조건에 맞는 코인이 없습니다.</p>}
      </div>
    </Section>

    <Section no="09" kicker="읽는 법" title="크립토 시장을 볼 때 자주 헷갈리는 다섯 가지">
      <div className="ci-faq">
        <details open><summary>비트코인이 오르면 코인 시장 전체가 오른 건가요?</summary><p>아닙니다. 비트코인은 거래대금과 시가총액이 압도적으로 커서 뉴스와 차트를 독점하지만, 수백 개 알트코인은 전혀 다르게 움직일 수 있습니다. 이 화면의 '오른 코인 비율'과 '알트코인 중앙값'이 비트코인 등락과 같은 방향인지 확인하세요.</p></details>
        <details><summary>평균과 중앙값은 왜 다르게 나오나요?</summary><p>코인 하나가 하루에 +80% 오르면 평균은 크게 올라가지만 나머지 코인의 사정은 변하지 않습니다. 중앙값은 등락률 순으로 줄 세웠을 때 가운데 코인의 값이라 이런 극단값에 덜 흔들립니다. 보통 코인을 들고 있는 사람의 체감은 중앙값에 가깝습니다.</p></details>
        <details><summary>'오늘 등락'은 언제를 기준으로 계산하나요?</summary><p>코인 시장은 24시간 열려 있어 '하루'의 기준이 거래소마다 다릅니다. 업비트는 UTC 0시, 즉 한국시간 오전 9시 가격을 기준으로 등락률을 계산합니다. 반면 거래대금은 지금부터 거슬러 올라간 최근 24시간 합계입니다. 해외 사이트의 24시간 등락률과 숫자가 다를 수 있는 이유입니다.</p></details>
        <details><summary>스테이블코인 거래가 많다는 건 어떤 의미인가요?</summary><p>테더(USDT)·USDC 같은 스테이블코인은 달러에 가치가 묶여 있어 가격이 거의 움직이지 않습니다. 이 거래가 많다는 것은 원화를 달러로 바꾸거나 해외 거래소로 옮기려는 수요, 또는 코인을 팔고 잠시 쉬어 가려는 수요가 많다는 뜻입니다. 등락률 계산에서는 시장 분위기를 흐리지 않도록 제외했습니다.</p></details>
        <details><summary>김치 프리미엄이 높으면 무엇을 조심해야 하나요?</summary><p>국내 가격이 해외보다 비싸다는 것은 국내 매수세가 강하다는 뜻이지만, 같은 코인을 해외보다 비싸게 사고 있다는 뜻이기도 합니다. 과거 프리미엄이 크게 벌어진 시기에는 이후 국내 가격이 해외 가격 쪽으로 되돌아가는 일이 많았습니다. 반대로 프리미엄이 마이너스(역프리미엄)면 국내 투자심리가 해외보다 식어 있다는 신호로 읽힙니다.</p></details>
      </div>
    </Section>

    <p className="rs-notice">계산 기준 · 업비트 원화마켓 {m.valid.length}개 거래쌍을 한 번에 받은 같은 시각 표본입니다. 스테이블코인({(data?.stablecoins ?? []).join(", ")})은 등락·분포·강세 목록에서 빼고 거래대금 구성에만 넣었습니다. 시가총액은 제공되지 않아 시총가중 지수나 '도미넌스'로 표현하지 않으며, 거래대금 비중은 업비트 한 곳의 관심도일 뿐 세계 시장 점유율이 아닙니다. 투자 권유가 아닌 참고 자료입니다.</p>
  </div>;
}
