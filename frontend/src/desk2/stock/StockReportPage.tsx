import { useEffect, useMemo } from "react";
import { useLanguage } from "../../i18n/LanguageContext";
import { Link } from "../../router";
import { reportStockView } from "../../useActivityTracking";
import { useStockDetailSeo } from "../../useStockDetailSeo";
import { recordRecent } from "../../watchlist";
import Colophon from "../Colophon";
import Masthead from "../Masthead";
import { useBroadsheet } from "../shell";
import { useStockReport } from "./useStockReport";
import { stockBrief } from "./stockBriefModel";
import StockInsights, { briefPct } from "./StockInsights";
import "../pages.css";

export default function StockReportPage({ code, isEtf = false }: { code: string; isEtf?: boolean }) {
  useBroadsheet();
  const { lang } = useLanguage();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const data = useStockReport(code, isEtf);
  const name = data.summary?.name ?? data.quote?.name ?? "";
  const m = useMemo(() => stockBrief(data), [data.points, data.quote, data.summary, data.peers]);
  const market = data.us ? "US" : "KR";
  useStockDetailSeo({ code, name: name || undefined, market, price: m.price ?? undefined, report: true });
  useEffect(() => {
    if (!name) return;
    recordRecent({ code, name, market, asset_type: isEtf ? "ETF" : "STOCK" });
    reportStockView(code, name);
  }, [code, name, market, isEtf]);
  const stockUrl = `/stock/${code}${isEtf ? "?asset=ETF" : ""}`;
  const quotePrice = m.price == null ? "—" : data.us ? `$${m.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `${m.price.toLocaleString()}${L("원", " KRW")}`;
  const loading = Object.values(data.status).some((s) => s === "loading");
  const missing = Object.entries(data.status).filter(([, status]) => status === "unavailable").map(([feed]) => ({ quote: L("시세", "Quote"), history: L("일별 지표", "Daily indicators"), profile: L("기업 개요", "Profile"), peers: L("업종 비교", "Peers") }[feed]));
  const description = data.us ? data.enrich?.description : data.overview?.overview.join(" ");
  const cap = data.enrich?.marcap_usd;
  return <div className="d2 report-page" lang={lang}>
    <a className="d2-skip" href="#report-cover">{L("보고서 바로가기", "Skip to report")}</a>
    <Masthead onPrint={() => window.print()} section={{ ko: "종목 한 장 보고서", en: "One-page stock report", taglineKo: "가격의 변화와 분석 근거를 한 장에", taglineEn: "Price changes and their evidence on one page" }} />
    <main className="d2-main report-main">
      <article id="report-cover" className="report-cover">
        <nav className="report-tools" aria-label={L("보고서 도구", "Report tools")}><Link to={stockUrl}>← {L("종목 상세", "Stock details")}</Link><div><button type="button" onClick={data.reload} disabled={loading}>{loading ? L("자료 확인 중…", "Loading…") : L("자료 새로고침", "Refresh data")}</button> <button type="button" onClick={() => window.print()}>{L("인쇄 · PDF 저장", "Print · save PDF")}</button></div></nav>
        <p className="report-kicker">{L("종목 한 장 보고서", "ONE-PAGE STOCK REPORT")}</p>
        <h1>{name || code}</h1><div className="report-code">{code} · {data.us ? L("미국", "US") : L("국내", "KRX")} {isEtf ? "ETF" : L("주식", "stock")}</div>
        <div className="report-price"><b>{quotePrice}</b><span className={m.day == null || m.day === 0 ? "" : m.day > 0 ? "is-up" : "is-down"}>{briefPct(m.day)}</span></div>
        {(loading || missing.length > 0) && <p className="report-status" role="status">{loading && L("자료를 독립적으로 확인하고 있습니다. 도착한 자료부터 표시합니다. ", "Feeds load independently; available figures appear first. ")}{missing.length > 0 && L(`${missing.join(" · ")} 자료를 확인하지 못했습니다. 미제공 항목은 —로 표시합니다.`, `${missing.join(" · ")} unavailable. Missing figures are shown as —.`)}</p>}
        <StockInsights model={m} code={code} isEtf={isEtf} report receivedAt={data.receivedAt} quoteUnavailable={data.status.quote === "unavailable"} />
        <section className="report-evidence" aria-labelledby="report-periods-title"><h2 id="report-periods-title">{L("기간을 넓혀서 확인하기", "A wider view")}</h2><div className="report-periods">{m.returns.filter((r) => ["1w", "3m", "1y"].includes(r.key)).map((r) => <div key={r.key}><span>{lang === "ko" ? r.ko : r.en}</span><b className={r.value == null || r.value === 0 ? "" : r.value > 0 ? "is-up" : "is-down"}>{briefPct(r.value)}</b><small>{r.start && r.end ? `${r.start} → ${r.end}` : L("일별 자료 부족", "Insufficient history")}</small></div>)}</div></section>
        {!isEtf && <details className="report-profile"><summary>{L("기업 개요 · 추가 확인 항목", "Company profile · further reading")}</summary><p>{description || L("기업 개요 자료가 없습니다.", "Profile unavailable.")}</p>{data.overview?.per_estimate && <p>{L("예상 PER", "Forward PER")}: {data.overview.per_estimate}</p>}{cap != null && cap > 0 && Number.isFinite(cap) && <p>{L("시가총액", "Market cap")}: ${cap.toLocaleString("en-US")}</p>}{m.peers && <p>{L("함께 비교한 종목", "Compared names")}: {m.peers.names.map((p, i) => <span key={p.code}>{i > 0 && " · "}<Link to={`/stock/${p.code}`}>{p.name}</Link> ({briefPct(p.change)})</span>)}</p>}<Link to={`${stockUrl}#sk-room`}>{L("관련 기사와 토론 확인", "Read related news and discussion")} →</Link></details>}
        <p className="report-note">{L("공개 시장 자료로 확인된 가격·거래량·지표의 변화를 정리한 보고서입니다. 가격 변동의 원인이나 미래 수익률을 추정하지 않습니다. 일별 수익률은 종가 기준이며 배당·환율 효과를 별도로 합산하지 않습니다.", "This report summarizes observed changes in public price, volume and indicator data. It does not infer causes or predict returns. Daily-close returns do not separately add dividends or currency effects.")}</p>
      </article>
    </main><Colophon />
  </div>;
}
