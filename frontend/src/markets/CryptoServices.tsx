import { useState } from "react";
import MarketChart from "../charts/MarketChart";
import { useResearch } from "./researchApi";
import { Bars, delta, n, Notice, Outcome, p, ResourceState, Stats, Table } from "./ResearchUI";
import { orderCost } from "./researchModel";

export default function CryptoServices({ kind }: { kind: string }) {
  const [coin, setCoin] = useState("KRW-BTC"), [contract, setContract] = useState("BTCUSDT"), [budget, setBudget] = useState(1000000), [q, setQ] = useState("");
  const resource = useResearch(kind === "crypto-inside" ? "/api/discovery/crypto" : kind === "crypto-liquidity" ? `/api/discovery/orderbook?market=${coin}` : `/api/discovery/derivatives?code=${contract}`);
  const rows = resource.data?.items ?? [];
  if (kind === "crypto-inside") {
    const included = rows.filter(r => typeof r.change === "number"), rest = included.filter(r => !["KRW-BTC", "KRW-ETH"].includes(r.code));
    const average = (items: typeof rows) => items.length ? items.reduce((s, r) => s + r.change, 0) / items.length : null;
    const up = included.filter(r => r.change > 0).length;
    const filtered = rows.filter(r => `${r.code} ${r.name}`.toLowerCase().includes(q.toLowerCase()));
    return <><ResourceState resource={resource} /><Outcome title="BTC·ETH를 빼면 다른 코인은 어떻게 보일까요?"><p>업비트 원화마켓의 같은 수신 표본을 한 코인 한 표로 계산합니다. 시가총액이 없는 거래소 자료를 세계 시총가중 지수로 표현하지 않습니다.</p></Outcome><Stats items={[{ label: "전체 표본 단순평균", value: p(average(included)) }, { label: "BTC·ETH 제외 평균", value: p(average(rest)) }, { label: "상승 코인 비율", value: included.length ? `${n(up / included.length * 100)}%` : "—", note: `${up}/${included.length}개` }]} /><label className="rs-field">코인 검색<input value={q} onChange={e => setQ(e.target.value)} placeholder="비트코인, BTC" /></label><Table caption="원화 거래쌍 관측 원표" rows={filtered} columns={[{ key: "name", label: "코인" }, { key: "code", label: "거래쌍" }, { key: "price", label: "가격 KRW", render: n }, { key: "change", label: "UTC 전일 종가 대비", render: p }, { key: "turnover", label: "24시간 거래대금 KRW", render: n }]} /></>;
  }
  if (kind === "crypto-liquidity") {
    const cost = orderCost(rows, budget), best = rows[0];
    const spread = best?.ask_price > 0 && best?.bid_price > 0 ? (best.ask_price - best.bid_price) / ((best.ask_price + best.bid_price) / 2) * 100 : null;
    return <div data-track="self"><label className="rs-field">같은 원화 거래쌍<select value={coin} onChange={e => setCoin(e.target.value)}><option>KRW-BTC</option><option>KRW-ETH</option><option>KRW-SOL</option></select></label><ResourceState resource={resource} /><Outcome title="거래대금과 실제 호가의 두께는 다릅니다"><p>현재 공개 매도호가를 순서대로 소진하는 가상 매수 계산입니다. 주문을 보내지 않습니다. 호가 변경·수수료·체결 우선순위는 포함하지 않습니다.</p></Outcome><label className="rs-field">가정 매수 금액 (원)<input type="number" min={1} value={budget} onChange={e => setBudget(Number(e.target.value))} /></label><Stats items={[{ label: "수신 최우선 호가 스프레드", value: p(spread) }, { label: "가상 평균 매수 가격", value: n(cost?.average) }, { label: "최우선 매도 대비 비용", value: p(cost?.impact) }, { label: "호가 부족으로 미계산한 금액", value: n(cost?.unfilled, 0), note: "호가 밖 가격을 만들어 채우지 않습니다." }]} /><Table caption="공개된 매수·매도 30호가" rows={rows} columns={[{ key: "ask_price", label: "매도 가격", render: n }, { key: "ask_size", label: "매도 수량", render: n }, { key: "bid_price", label: "매수 가격", render: n }, { key: "bid_size", label: "매수 수량", render: n }]} /><button type="button" onClick={resource.reload}>호가 다시 확인</button><Notice>입력 금액은 URL·스토리지·서버로 전송하지 않습니다. 미체결 부분이 있으면 위 평균은 계산 가능한 수량만의 평균입니다.</Notice></div>;
  }
  const data = resource.data, history = rows, first = history[0], last = history[history.length - 1];
  return <><label className="rs-field">같은 USDT 무기한 계약<select value={contract} onChange={e => setContract(e.target.value)}><option>BTCUSDT</option><option>ETHUSDT</option><option>SOLUSDT</option></select></label><ResourceState resource={resource} /><Outcome title="가격과 레버리지 포지션은 따로 확인하세요"><p>같은 거래소·같은 계약의 가격·미결제약정·펀딩을 나란히 놓았습니다. 양의 펀딩이나 OI 증가만으로 매수·매도 방향을 확정하지 않습니다. 청산액은 수신되지 않아 표시하지 않습니다.</p></Outcome><Stats items={[{ label: "선물·지수 가격 차이", value: p(delta(data?.price, data?.index_price)) }, { label: "다음 지급 주기의 펀딩 비율", value: data?.funding_rate == null ? "—" : `${n(data.funding_rate * 100, 5)}%`, note: data?.funding_interval_hours ? `${data.funding_interval_hours}시간 주기` : "주기 미제공 · 원문 확인" }, { label: "OI 수량 변화", value: p(delta(last?.value, first?.value)), note: "수신한 1시간 간격의 구간 비교" }, { label: "미결제 약정 명목 USD", value: n(data?.open_interest_usd) }]} />{history.length > 1 && <MarketChart label="같은 계약의 시간별 미결제약정" dates={history.map(r => new Date(Number(r.time)).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }))} series={[{ name: "OI 기초자산 수량", values: history.map(r => r.value), color: "var(--brass)" }]} height={280} />}<Table caption="미결제약정 원표" rows={[...history].reverse().map(r => ({ ...r, at: new Date(Number(r.time)).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) }))} columns={[{ key: "at", label: "KST" }, { key: "value", label: "OI (기초자산 수량)", render: n }]} /></>;
}
