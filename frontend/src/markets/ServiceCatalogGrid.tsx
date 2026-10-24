import { useState } from "react";
import { Link } from "../router";
import { SERVICES, SERVICE_GROUPS } from "./catalog";
import NewBadge from "./ResearchNewBadge";
export default function ServiceCatalogGrid() {
  const [group, setGroup] = useState(""), [q, setQ] = useState("");
  const items = SERVICES.filter(s => (!group || s.group === group) && `${s.name} ${s.question}`.includes(q));
  return <section className="service-catalog" aria-labelledby="service-catalog-title"><div className="mdis-section-title"><span>36 RESEARCH DESTINATIONS</span><h2 id="service-catalog-title">질문에 맞는 서비스 찾기</h2></div><div className="rs-control-grid"><label className="rs-field">관심 영역<select value={group} onChange={e => setGroup(e.target.value)}><option value="">모든 영역</option>{SERVICE_GROUPS.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label><label className="rs-field">궁금한 점<input type="search" placeholder="예: 환율, 배당, 실적" value={q} onChange={e => setQ(e.target.value)} /></label></div><p className="rs-result-count" role="status">{items.length}개 서비스</p><div className="service-catalog-grid">{items.map(s => <Link to={s.path} key={s.path}><small>{SERVICE_GROUPS.find(g => g.id === s.group)?.name}</small><h3>{s.name} <NewBadge /></h3><p>{s.question}</p><span>확인하기 ↗</span></Link>)}</div>{!items.length && <p className="rs-empty">검색어를 줄이거나 다른 영역을 선택하세요.</p>}</section>;
}
