import { Fragment, useEffect, useState } from "react";
import { api, type MoverStock, type MoversEdition } from "../api/client";
import { Link } from "../router";
import { reportHotIssue } from "../useActivityTracking";
import { useDocumentTitle } from "../useDocumentTitle";
import { InArticleAd, MultiplexAd } from "./AdZone";
import { NeoEmptyState, NeoSkeleton } from "./NeoComponents";
import "./movers.css";

const REFRESH_MS = 5 * 60 * 1000;
const PAGE_TITLE = "오늘 급등주·급락주 이유 총정리 — 상한가·특징주 실시간 | KOSPIMAP";
const pct = (v: number | null | undefined) => v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
const won = (v: number) => `${Math.round(v).toLocaleString("ko-KR")}원`;
const eok = (v: number) => v >= 10000 ? `${(v / 10000).toFixed(v >= 100000 ? 0 : 1)}조` : `${v.toLocaleString("ko-KR")}억`;
const dotDay = (iso?: string) => iso ? iso.slice(0, 10).replace(/-/g, ".") : "";
const report = (action: string, label = "") => reportHotIssue(`movers:${action}`, label);

function Spark({ line, up }: { line: number[]; up: boolean }) {
  if (line.length < 3) return null;
  const min = Math.min(...line), max = Math.max(...line), span = max - min || 1;
  const pts = line.map((v, i) => `${(i / (line.length - 1)) * 100},${36 - ((v - min) / span) * 32 - 2}`).join(" ");
  const last = pts.split(" ").pop()!.split(",");
  return <svg className={`mv-spark ${up ? "is-up" : "is-down"}`} viewBox="0 0 100 36" preserveAspectRatio="none" role="img" aria-label={`최근 ${line.length}거래일 종가 흐름`}>
    <polyline points={`0,36 ${pts} 100,36`} className="mv-spark-fill" />
    <polyline points={pts} className="mv-spark-line" vectorEffect="non-scaling-stroke" />
    <circle cx={last[0]} cy={last[1]} r="2.4" className="mv-spark-dot" />
  </svg>;
}

function Board({ title, rows, up }: { title: string; rows: MoverStock[]; up: boolean }) {
  const peak = Math.max(...rows.map(r => Math.abs(r.change_pct)), 1);
  return <section className={`mv-board-col ${up ? "is-up" : "is-down"}`} aria-label={title}>
    <h2>{title}</h2>
    <ol>{rows.map(r => <li key={r.code}>
      <a href={`#m-${r.code}`} onClick={() => report("board", r.name)}>
        <span className="mv-bar" style={{ width: `${Math.max(8, (Math.abs(r.change_pct) / peak) * 100)}%` }} aria-hidden="true" />
        <b>{r.name}</b>{r.limit && <em>{r.limit}</em>}<small>{r.theme}</small><strong>{pct(r.change_pct)}</strong>
      </a>
    </li>)}</ol>
  </section>;
}

function Card({ s, rank }: { s: MoverStock; rank: number }) {
  const up = s.direction === "up";
  return <article className={`mv-card ${up ? "is-up" : "is-down"}`} id={`m-${s.code}`} aria-labelledby={`m-${s.code}-t`}>
    <header className="mv-card-head">
      <span className="mv-rank" aria-hidden="true">{rank}</span>
      <div className="mv-card-id">
        <h3 id={`m-${s.code}-t`}><Link to={`/stock/${s.code}`} onClick={() => report("stock", s.name)}>{s.name}</Link></h3>
        <p><span>{s.market}</span>{s.theme && <span className="mv-theme">{s.theme}</span>}{s.limit && <span className="mv-limit">{s.limit}</span>}</p>
      </div>
      <div className="mv-card-move"><strong>{pct(s.change_pct)}</strong><span>{won(s.close)}</span></div>
    </header>
    <div className="mv-card-chart">
      <Spark line={s.line} up={up} />
      <dl><div><dt>거래대금</dt><dd>{eok(s.turnover_100m)}원</dd></div><div><dt>시가총액</dt><dd>{eok(s.marcap_100m)}원</dd></div></dl>
    </div>
    <div className="mv-why"><b>{up ? "왜 올랐나" : "왜 내렸나"}</b><p>{s.reason}</p></div>
    {s.news.length > 0 && <ul className="mv-news" aria-label={`${s.name} 관련 뉴스`}>{s.news.slice(0, 3).map(n =>
      <li key={n.url}><a href={n.url} target="_blank" rel="noopener noreferrer" onClick={() => report("news", s.name)}><span>{n.title}</span><small>{n.press} · {n.at.slice(5).replace("-", ".")}</small></a></li>)}</ul>}
    <nav className="mv-card-links">
      <Link to={`/stock/${s.code}`} onClick={() => report("chart", s.name)}>차트·수급 보기</Link>
      <Link to={`/investor/${s.code}`} onClick={() => report("investor", s.name)}>외국인·기관 매매</Link>
      <Link to={`/discussion-explorer?code=${s.code}&name=${encodeURIComponent(s.name)}`} onClick={() => report("talk", s.name)}>종목토론</Link>
    </nav>
  </article>;
}

/** 오늘의 급등·급락 이유: 평일 09:20 · 12:30 · 16:00 KST. */
export default function MoversPage({ archiveDay, archiveTime }: { archiveDay?: string; archiveTime?: string }) {
  const [data, setData] = useState<MoversEdition | null>(null);
  const [failed, setFailed] = useState(false);
  useDocumentTitle(archiveDay && data?.headline ? `${data.headline} | ${data.edition} ${data.slot_label} 급등·급락 이유 · KOSPIMAP` : archiveDay ? document.title : PAGE_TITLE);
  useEffect(() => {
    let live = true;
    const load = () => (archiveDay && archiveTime ? api.moversSlot(archiveDay, archiveTime) : api.movers())
      .then(v => { if (live) { setData(v); setFailed(false); } }).catch(() => { if (live) setFailed(true); });
    load();
    const timer = archiveDay ? undefined : window.setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, [archiveDay, archiveTime]);

  if (!data) return <main className="mv-page">{failed ? <NeoEmptyState title="급등·급락 종목을 불러오지 못했습니다" error /> : <NeoSkeleton rows={8} />}</main>;
  if (!data.stocks.length) return <main className="mv-page"><NeoEmptyState title="첫 정리를 준비하고 있습니다">평일 09:20 · 12:30 · 16:00에 급등·급락 종목과 이유를 정리합니다.</NeoEmptyState></main>;
  const ups = data.stocks.filter(s => s.direction === "up");
  const downs = data.stocks.filter(s => s.direction === "down");
  const ordered = [...ups, ...downs];
  const shot = new URLSearchParams(window.location.search).get("shot") === "1";
  return <main className={`mv-page${shot ? " is-shot" : ""}`} lang="ko">
    <div id="mv-capture" className="mv-capture">
      <header className="mv-mast">
        <div className="mv-mast-top">
          <span className="mv-kicker"><i aria-hidden="true" />급등·급락 이유</span>
          <nav className="mv-slots" aria-label="시간대별 정리">
            {archiveDay ? <Link to="/movers">최신 보기</Link> : (data.day_slots ?? []).map(s => s.published
              ? <Link key={s.slot} to={`/movers/${s.slot.slice(0, 10)}/${s.label.replace(":", "")}`} aria-current={s.slot === data.slot ? "page" : undefined}>{s.label}<small>{s.name}</small></Link>
              : <span key={s.slot} className="is-off">{s.label}<small>{s.name}</small></span>)}
          </nav>
        </div>
        <p className="mv-stamp"><b>{dotDay(data.slot)} {data.slot_label} {data.slot_name} 기준</b>{!archiveDay && data.next_update && <span>다음 업데이트 {dotDay(data.next_update) !== dotDay(data.slot) ? dotDay(data.next_update).slice(5) + " " : ""}{data.next_update.slice(11, 16)}</span>}</p>
        <h1>{data.headline}</h1>
        <p className="mv-dek">{data.dek}</p>
        <ul className="mv-chips" aria-label="시장 요약">
          {(data.indices ?? []).map(i => <li key={i.name} className={(i.change_pct ?? 0) >= 0 ? "is-up" : "is-down"}><span>{i.name}</span><b>{pct(i.change_pct)}</b></li>)}
          <li><span>상한가</span><b>{data.limit_up ?? 0}</b></li><li><span>하한가</span><b>{data.limit_down ?? 0}</b></li>
        </ul>
      </header>
      <div className="mv-board">
        {ups.length > 0 && <Board title="많이 오른 종목" rows={shot ? ups.slice(0, 7) : ups} up />}
        {downs.length > 0 && <Board title="많이 내린 종목" rows={shot ? downs.slice(0, 7) : downs} up={false} />}
      </div>
      {!!data.themes?.length && !shot && <section className="mv-themes" aria-label="오늘의 테마">
        <h2>같이 움직인 종목</h2>
        <ul>{data.themes.map(t => <li key={t.name}><b>{t.name}</b><span>{t.codes.map(c => data.stocks.find(s => s.code === c)?.name).filter(Boolean).join(" · ")}</span></li>)}</ul>
      </section>}
      <p className="mv-site">{shot ? "종목별 이유 전체 보기  kospimap.com/movers" : "kospimap.com/movers"}</p>
    </div>

    <InArticleAd className="mv-ad" />
    <section className="mv-cards" aria-label="종목별 이유">
      {ordered.map((s, i) => <Fragment key={s.code}>
        {i === ups.length && downs.length > 0 && <h2 className="mv-split is-down">많이 내린 종목</h2>}
        {i === 0 && <h2 className="mv-split is-up">많이 오른 종목</h2>}
        <Card s={s} rank={s.direction === "up" ? i + 1 : i - ups.length + 1} />
        {(i === 3 || i === 9) && i < ordered.length - 1 && <InArticleAd className="mv-ad" />}
      </Fragment>)}
      <MultiplexAd slot="5479707639" className="mv-multiplex" />
    </section>

    <nav className="mv-more" aria-label="더 보기">
      <Link to="/map">코스피 히트맵</Link><Link to="/kosdaq-map">코스닥 히트맵</Link><Link to="/hot-issues">오늘의 핫이슈</Link><Link to="/world-markets">세계 증시</Link>
    </nav>
    <footer className="mv-foot">
      <p>코스피·코스닥 전 종목 중 거래대금 30억원·시가총액 500억원 이상 종목에서 등락률 상위를 골랐습니다(우선주·스팩 제외). 이유는 공개 뉴스를 바탕으로 정리했으며, 뉴스로 확인되지 않는 움직임은 그렇게 적었습니다. 투자 판단의 근거가 아닌 참고 정보입니다.</p>
    </footer>
  </main>;
}
