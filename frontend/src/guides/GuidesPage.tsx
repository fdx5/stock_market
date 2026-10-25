import { useEffect, useRef, useState } from "react";
import { Link } from "../router";
import { HoloPanel, HUDSectionTitle } from "../neo/NeoComponents";
import { guideCatalog, guidePath, guideStructuredData } from "./catalog";
import "./guides.css";

function ShareGuide({ path, title }: { path: string; title: string }) {
  const [status, setStatus] = useState("");
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const url = `https://kospimap.com${path}`;
  useEffect(() => { if (manual) field.current?.select(); }, [manual]);
  const share = async () => {
    setBusy(true); setStatus(""); setManual(false);
    try {
      if (navigator.share) {
        try { await navigator.share({ title, url }); return; }
        catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; }
      }
      if (!navigator.clipboard?.writeText) { setManual(true); return; }
      try { await navigator.clipboard.writeText(url); setStatus("링크를 복사했습니다."); }
      catch { setManual(true); }
    } finally { setBusy(false); }
  };
  return <div className="guide-share ng-setting-actions">
    <button type="button" disabled={busy} onClick={share}>안내 공유하기 ↗</button>
    <span role="status">{status}</span>
    {manual && <label>아래 링크를 선택해 복사하세요<input ref={field} readOnly value={url} onFocus={e => e.currentTarget.select()} /></label>}
  </div>;
}

/** Content only: the existing App/NeoShell owns the theme, header, menu and footer. */
export default function GuidesPage({ path }: { path: string }) {
  useEffect(() => {
    let script = document.getElementById("route-structured-data") as HTMLScriptElement | null;
    if (!script) { script = document.createElement("script"); script.id = "route-structured-data"; script.type = "application/ld+json"; document.head.appendChild(script); }
    script.textContent = JSON.stringify(guideStructuredData(path));
    return () => { script.remove(); };
  }, [path]);
  const guide = guideCatalog.guides.find(item => guidePath(item.slug) === path);
  const title = guide?.title ?? guideCatalog.title;
  return <div className="ng-guides" lang="ko">
    {guide && <nav className="guide-crumbs" aria-label="현재 위치"><Link to="/guides">{guideCatalog.title}</Link><span aria-hidden="true">/</span><span aria-current="page">{guide.category}</span></nav>}
    <header className="ng-page-heading"><span className="ng-kicker">KOSPIMAP / MARKET GUIDES</span><h1>{title}</h1><p>{guide?.description ?? guideCatalog.description}</p>{guide && <p className="guide-byline">작성·검토: K-Stock Hub · <time dateTime={guideCatalog.updated}>{guideCatalog.updated}</time> · 약 {guide.minutes}분</p>}</header>
    {guide ? <div className="guide-layout">
      <article aria-label={title}>
        <HoloPanel className="guide-toc"><h2>이 글에서 확인할 것</h2><ol>{guide.sections.map((section, index) => <li key={section.title}><a href={`#guide-section-${index}`}>{section.title}</a></li>)}</ol></HoloPanel>
        {guide.sections.map((section, index) => <section id={`guide-section-${index}`} className="guide-section" key={section.title}><HUDSectionTitle code={`0${index + 1}`} title={section.title} />{section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</section>)}
        {"sources" in guide && guide.sources && <section className="guide-sources"><h2>참고 자료</h2><ul>{guide.sources.map(source => <li key={source.href}><a href={source.href} target="_blank" rel="noopener noreferrer">{source.label} ↗</a></li>)}</ul></section>}
        <ShareGuide key={path} path={path} title={title} />
      </article>
      <aside className="guide-tools" aria-labelledby="guide-tools-title"><HoloPanel><HUDSectionTitle code="EXPLORE" title="직접 확인하기" /><p id="guide-tools-title">읽은 내용을 실제 데이터와 나란히 살펴보세요.</p>{guide.tools.map(tool => <Link key={tool.href} to={tool.href}>{tool.label} <span aria-hidden="true">↗</span></Link>)}</HoloPanel></aside>
    </div> : <p className="guide-intro">가격을 보기 전에 비교 기준부터 정리하세요. 각 안내에서 실제 시장 도구로 바로 이동할 수 있습니다.</p>}
    <section className="guide-related" aria-label={guide ? "함께 읽기" : "안내 목록"}><HUDSectionTitle code="READ MORE" title={guide ? "함께 읽기" : "무엇부터 살펴볼까요?"} /><div className="guide-grid">{guideCatalog.guides.filter(item => item !== guide).map(item => <HoloPanel key={item.slug}><Link className="guide-card" to={guidePath(item.slug)}><small>{item.category} · 약 {item.minutes}분</small><h3>{item.title} <span aria-hidden="true">↗</span></h3><p>{item.description}</p><span>안내 읽기 →</span></Link></HoloPanel>)}</div></section>
    <p className="guide-note">시세와 데이터는 투자 참고용입니다. 데이터의 기준 시점과 표본 범위를 확인하세요.</p>
  </div>;
}
