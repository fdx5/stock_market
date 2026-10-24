import { Link } from "../router";
import { SERVICES, serviceForPath, serviceLink } from "./catalog";
import NewBadge from "./ResearchNewBadge";

export default function ServiceConnections({ path, code, market, region, compact = false }: { path: string; code?: string; market?: string; region?: string; compact?: boolean }) {
  const service = serviceForPath(path);
  const group = service?.group ?? (path === "/etf" ? "funds" : path === "/news" ? "events" : "stocks");
  const preferred = region ? ["/etf-overlap", "/etf-tradeoffs", "/dividend-reality"] : code ? ["/stock-context", "/stock-tradeoffs", "/signal-crosscheck", "/news-evidence", "/decision-brief"] : [];
  const related = SERVICES.filter(s => s.path !== path && (preferred.length ? preferred.includes(s.path) : s.group === group)).slice(0, 5);
  const links = <nav aria-label="관련 서비스">{related.map(s => <Link key={s.path} to={serviceLink(s.path, { code, market, region })}><span>{s.name}</span><NewBadge /><small>{s.question}</small></Link>)}{code && <Link to={`/stock/${encodeURIComponent(code)}${region ? "?asset=ETF" : ""}`}><span>종목 원표로 돌아가기 ↗</span></Link>}<Link to="/markets"><span>전체 서비스 탐색 ↗</span></Link></nav>;
  return compact ? <details className="service-connections service-connections--compact"><summary>이어서 확인할 질문과 신규 분석 <NewBadge /></summary>{links}</details> : <section className="service-connections" aria-label="이어지는 분석"><div><small>CONTINUE YOUR RESEARCH</small><h2>다음 질문으로 이어서 보기</h2></div>{links}</section>;
}
