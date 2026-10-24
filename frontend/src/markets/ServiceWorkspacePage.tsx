import { reportResearchEvent } from "../useActivityTracking";
import { FormEvent, useEffect, useState } from "react";
import { Link } from "../router";
import { serviceForPath } from "./catalog";
import { DiscoveryMarket } from "./discoveryModel";
import ServiceConnections from "./ServiceConnections";
import { BoardResearch, FundamentalResearch, NewsResearch, PriceResearch, SnapshotResearch, StockContext } from "./StockServices";
import FundServices from "./FundServices";
import { BondTradeoffs, CommodityImpact, CurveLab, MacroCompare, RatePaths } from "./MacroServices";
import { EventResearch, SessionPlanner } from "./EventServices";
import CryptoServices from "./CryptoServices";
import NewBadge from "./ResearchNewBadge";
import SymbolPicker, { symbolMarket } from "./SymbolPicker";
import "./marketDiscovery.css";
import "./researchServices.css";
import "./neoResearch.css";

const STOCK_KINDS = new Set(["liquidity-quality", "stock-context", "earnings-gap", "signal-crosscheck", "news-evidence", "theme-evidence", "gap-context", "fundamental-gap", "decision-brief"]);
const FUND_KINDS = new Set(["etf-overlap", "etf-tradeoffs", "dividend-reality"]);
function initial(path: string) {
  const p = new URLSearchParams(window.location.search), raw = p.get("market");
  const code = p.get("code");
  const market = ["kospi", "kosdaq", "nasdaq"].includes(raw ?? "") ? raw as DiscoveryMarket : path === "/currency-lens" ? "nasdaq" : code && /^[A-Za-z]/.test(code) ? "nasdaq" : "kospi";
  return { market, code: code && /^[A-Za-z0-9.-]{1,16}$/.test(code) ? code.toUpperCase() : FUND_KINDS.has(path.slice(1)) ? p.get("region") === "US" ? "VOO" : "069500" : market === "nasdaq" ? "AAPL" : "005930", period: ["6mo", "1y", "2y", "5y"].includes(p.get("period") ?? "") ? p.get("period")! : "1y", region: p.get("region") === "US" ? "US" : "KR" };
}
export default function ServiceWorkspacePage({ path }: { path: string }) {
  const service = serviceForPath(path)!;
  const [context, setContext] = useState(() => initial(path));
  const [draft, setDraft] = useState(context.code), [message, setMessage] = useState("");
  const kind = path.slice(1), stock = STOCK_KINDS.has(kind) || kind === "currency-lens";
  useEffect(() => { const sync = () => { const next = initial(path); setContext(next); setDraft(next.code); }; window.addEventListener("popstate", sync); window.addEventListener("research:context", sync); return () => { window.removeEventListener("popstate", sync); window.removeEventListener("research:context", sync); }; }, [path]);
  const update = (values: Partial<typeof context>) => {
    const next = { ...context, ...values }; setContext(next);
    const params = new URLSearchParams(); params.set("market", next.market); params.set("code", next.code); params.set("period", next.period); params.set("region", next.region);
    window.history.replaceState(window.history.state, "", `${path}?${params}`);
    window.dispatchEvent(new Event("research:context"));
  };
  const apply = (e: FormEvent) => { e.preventDefault(); if (!/^[A-Za-z0-9.-]{1,16}$/.test(draft)) { setMessage("검색 결과에서 종목을 선택하거나 올바른 코드를 입력하세요."); return; } reportResearchEvent("symbol_apply", {code:draft.toUpperCase()}); update({ code: draft.toUpperCase() }); setMessage(""); };
  const copy = async () => { try { await navigator.clipboard.writeText(window.location.href); setMessage("공개 조회 조건을 복사했습니다. 개인 입력은 포함하지 않습니다."); } catch { setMessage("주소창의 링크를 복사해 공유할 수 있습니다."); } };
  let page;
  const props: { context: StockContext; kind: string } = { context, kind };
  switch (kind) {
    case "liquidity-quality": case "stock-context": case "signal-crosscheck": case "gap-context": case "currency-lens": page = <PriceResearch {...props} />; break;
    case "earnings-gap": case "fundamental-gap": page = <FundamentalResearch {...props} />; break;
    case "news-evidence": case "theme-evidence": page = <NewsResearch {...props} />; break;
    case "global-peers": case "decision-brief": case "data-confidence": page = <BoardResearch {...props} />; break;
    case "sector-replay": case "change-digest": page = <SnapshotResearch kind={kind} market={context.market} />; break;
    case "etf-overlap": case "etf-tradeoffs": case "dividend-reality": page = <FundServices key={context.region} kind={kind} region={context.region} initialCode={context.code} />; break;
    case "event-impact": case "event-collision": page = <EventResearch kind={kind} />; break;
    case "session-planner": page = <SessionPlanner />; break;
    case "macro-context": page = <MacroCompare />; break;
    case "yield-curve-lab": page = <CurveLab />; break;
    case "rate-paths": page = <RatePaths />; break;
    case "commodity-impact": page = <CommodityImpact />; break;
    case "bond-tradeoffs": page = <BondTradeoffs />; break;
    case "crypto-inside": case "crypto-liquidity": case "derivatives-context": page = <CryptoServices kind={kind} />; break;
    default: throw new Error("Unregistered service route");
  }
  return <div className="mdis rs ng-research" lang="ko"><a className="d2-skip" href="#research-main">본문 바로가기</a><main id="research-main" className="mdis-main"><section className="mdis-hero"><div><p className="mdis-kicker">RESEARCH WORKSPACE / {service.id}</p><h1>{service.name}<span aria-hidden="true">.</span></h1><p>{service.question}</p><small>가입 없이 탐색 · 근거와 비교 기준을 함께</small></div><div className="mdis-hero-aside"><span>CONTEXT BEFORE CONCLUSION</span><p>관측한 사실에서<br />다음 질문으로.</p><button type="button" data-research-action="copy_link" onClick={() => void copy()}>조회 링크 복사</button><p className="rs-message" role="status">{message}</p></div></section>
    {stock && <form className="rs-context" onSubmit={apply}><label className="rs-field">시장<select value={context.market} onChange={e => { const market = e.target.value as DiscoveryMarket; const code = market === "nasdaq" ? "AAPL" : market === "kosdaq" ? "247540" : "005930"; update({ market, code }); setDraft(code); }}><option value="kospi">코스피</option><option value="kosdaq">코스닥</option><option value="nasdaq">미국</option></select></label><SymbolPicker label="종목명 · 코드 검색" value={draft} onChange={setDraft} region={kind === "currency-lens" ? "US" : undefined} onSelect={item => { const market = symbolMarket(item); update({ code: item.code.toUpperCase(), market, region: market === "nasdaq" ? "US" : "KR" }); setMessage(`${item.name} (${item.code}) 적용`); }} /><label className="rs-field">가격 조회 기간<select value={context.period} onChange={e => update({ period: e.target.value })}><option value="6mo">6개월</option><option value="1y">1년</option><option value="2y">2년</option><option value="5y">5년</option></select></label><button type="submit">종목 적용</button><Link to={`/stock/${context.code}`}>기존 종목 원표 ↗</Link></form>}
    {FUND_KINDS.has(kind) && <label className="rs-field">ETF 시장<select value={context.region} onChange={e => { const region = e.target.value; update({ region, code: region === "US" ? "VOO" : "069500", market: region === "US" ? "nasdaq" : "kospi" }); }}><option value="KR">국내</option><option value="US">미국</option></select></label>}
    {["sector-replay", "change-digest"].includes(kind) && <label className="rs-field">기록 시장<select value={context.market} onChange={e => update({ market: e.target.value as DiscoveryMarket })}><option value="kospi">코스피</option><option value="kosdaq">코스닥</option><option value="nasdaq">나스닥</option></select></label>}
    <div className="rs-workspace" key={`${kind}:${context.code}:${context.market}`}>{page}</div><ServiceConnections path={path} code={stock || FUND_KINDS.has(kind) ? context.code : undefined} market={context.market} region={FUND_KINDS.has(kind) ? context.region : undefined} /><details className="mdis-explainer"><summary>이 화면의 비교 기준</summary><p>{service.criteria}</p><p>자료를 제공하지 않는 항목은 미확인으로 남깁니다. 시세·재무·공시·일정의 기준시각과 단위를 함께 확인하세요. 로컬 자료는 해당 화면 메모리에서만 처리하며 서버에 저장하지 않습니다.</p></details></main></div>;
}
