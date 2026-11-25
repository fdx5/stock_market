import { Fragment, useEffect, useState } from "react";
import { api, type MoverStock, type MoversEdition } from "../api/client";
import StockLogo from "../components/StockLogo";
import { Link } from "../router";
import { reportHotIssue } from "../useActivityTracking";
import { useDocumentTitle } from "../useDocumentTitle";
import { InArticleAd, MultiplexAd } from "./AdZone";
import { NeoEmptyState, NeoSkeleton } from "./NeoComponents";
import "./movers.css";

type Market = "kr" | "us";
const REFRESH_MS = 5 * 60 * 1000;
const COPY: Record<Market, { title: string; base: string; schedule: string; foot: string; kicker: string }> = {
  kr: {
    title: "오늘 급등주·급락주 이유 총정리 — 상한가·특징주 실시간 | KOSPIMAP", base: "/movers",
    schedule: "평일 09:20 · 12:30 · 16:00", kicker: "급등·급락 이유 · 국내",
    foot: "코스피·코스닥 전 종목 중 거래대금 30억원·시가총액 500억원 이상 종목에서 등락률 상위를 골랐습니다(우선주·스팩 제외).",
  },
  us: {
    title: "나스닥100 급등주·급락주 이유 — 미국 주식 특징주 정리 | KOSPIMAP", base: "/movers/us",
    schedule: "미국장 거래일 21:00 · 00:40 · 06:40(한국 시간)", kicker: "급등·급락 이유 · 나스닥100",
    foot: "나스닥100 구성 종목 중 등락률 상위를 골랐습니다. 프리마켓·애프터마켓 시간에는 시간외 가격을 반영합니다.",
  },
};
const pct = (v: number | null | undefined) => v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
const num = (v: number) => Math.round(v).toLocaleString("ko-KR");
const eok = (v: number) => v >= 10000 ? `${(v / 10000).toFixed(v >= 100000 ? 0 : 1)}조원` : `${num(v)}억원`;
const dotDay = (iso?: string) => iso ? iso.slice(0, 10).replace(/-/g, ".") : "";
const report = (action: string, label = "") => reportHotIssue(`movers:${action}`, label);
const price = (s: MoverStock) => s.price_label ?? `${num(s.close)}원`;

/** The move as a badge: tinted surface, white figure — colour marks direction, the text stays neutral. */
function Move({ value, limit, size = "md" }: { value: number; limit?: string; size?: "sm" | "md" }) {
  return <span className={`mv-move mv-move--${size} ${value >= 0 ? "is-up" : "is-down"}`}>
    <i aria-hidden="true">{value >= 0 ? "▲" : "▼"}</i>{Math.abs(value).toFixed(2)}%{limit && <em>{limit}</em>}
  </span>;
}

function Logo({ s, size }: { s: Pick<MoverStock, "code" | "name">; size: number }) {
  return <span className="mv-logo" style={{ width: size, height: size }}><StockLogo code={s.code} name={s.name} className="mv-logo-img" /></span>;
}

/** Up to 20 sessions: risers in red, fallers in blue; high/low/dates on the axes, start price dashed, latest close tagged. */
function PriceChart({ s, us }: { s: MoverStock; us: boolean }) {
  const line = s.line ?? [];
  if (line.length < 3) return null;
  const up = s.direction === "up";
  const W = 340, H = 132, padR = 66, padB = 20, top = 12;
  const min = Math.min(...line), max = Math.max(...line), span = max - min || 1;
  const x = (i: number) => (i / (line.length - 1)) * (W - padR);
  const y = (v: number) => top + (1 - (v - min) / span) * (H - padB - top);
  const pts = line.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const fmt = (v: number) => us ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : num(v);
  const last = line[line.length - 1];
  const dates = s.line_dates ?? [];
  const id = `mvg-${s.code.replace(/[^A-Za-z0-9]/g, "")}`;
  const lastY = y(last);
  const tagY = Math.min(H - padB - 9, Math.max(top + 9, lastY));
  return <figure className={`mv-chart ${up ? "is-up" : "is-down"}`}>
    <figcaption><span>최근 {line.length}거래일 종가</span><b>{pct(s.ret_20d)}</b></figcaption>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${s.name} 최근 ${line.length}거래일 종가, 최고 ${fmt(max)}, 최저 ${fmt(min)}`}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--mv-tone)" stopOpacity=".38" /><stop offset="1" stopColor="var(--mv-tone)" stopOpacity="0" /></linearGradient></defs>
      {[0, .5, 1].map(f => <line key={f} x1="0" x2={W - padR} y1={top + f * (H - padB - top)} y2={top + f * (H - padB - top)} className="mv-chart-grid" />)}
      <line x1="0" x2={W - padR} y1={y(line[0])} y2={y(line[0])} className="mv-chart-base" />
      <polygon points={`0,${H - padB} ${pts} ${W - padR},${H - padB}`} fill={`url(#${id})`} />
      <polyline points={pts} className="mv-chart-line" />
      <circle cx={x(line.length - 1)} cy={lastY} r="7" className="mv-chart-halo" />
      <circle cx={x(line.length - 1)} cy={lastY} r="3.6" className="mv-chart-dot" />
      <rect x={W - padR + 6} y={tagY - 9} width={padR - 8} height="18" rx="5" className="mv-chart-tag" />
      <text x={W - padR + 6 + (padR - 8) / 2} y={tagY + 4} textAnchor="middle" className="mv-chart-tagtext">{fmt(last)}</text>
      {tagY - top > 22 && <text x={W - padR + 8} y={top + 4} className="mv-chart-axis">{fmt(max)}</text>}
      {H - padB - tagY > 22 && <text x={W - padR + 8} y={H - padB + 2} className="mv-chart-axis">{fmt(min)}</text>}
      {dates.length > 1 && <>
        <text x="0" y={H - 3} className="mv-chart-axis">{dates[0].slice(5).replace("-", ".")}</text>
        <text x={W - padR} y={H - 3} textAnchor="end" className="mv-chart-axis">{dates[dates.length - 1].slice(5).replace("-", ".")}</text>
      </>}
    </svg>
  </figure>;
}

function Board({ title, rows, up, limit }: { title: string; rows: MoverStock[]; up: boolean; limit?: number }) {
  const shown = limit ? rows.slice(0, limit) : rows;
  const peak = Math.max(...rows.map(r => Math.abs(r.change_pct)), 1);
  return <section className="mv-board-col" aria-label={title}>
    <h2><span className={`mv-dot ${up ? "is-up" : "is-down"}`} aria-hidden="true" />{title}<small>{rows.length}종목</small></h2>
    <ol>{shown.map((r, i) => <li key={r.code}>
      <a href={`#m-${r.code}`} onClick={() => report("board", r.name)}>
        <span className="mv-board-rank">{i + 1}</span>
        <Logo s={r} size={32} />
        <span className="mv-board-name"><b>{r.name}</b><small>{r.theme || r.market}</small></span>
        <Move value={r.change_pct} size="sm" />
        <span className={`mv-board-bar ${up ? "is-up" : "is-down"}`} style={{ width: `${Math.max(6, (Math.abs(r.change_pct) / peak) * 100)}%` }} aria-hidden="true" />
      </a>
    </li>)}</ol>
  </section>;
}

function Card({ s, rank, us }: { s: MoverStock; rank: number; us: boolean }) {
  const up = s.direction === "up";
  return <article className="mv-card" id={`m-${s.code}`} aria-labelledby={`m-${s.code}-t`}>
    <header className="mv-card-head">
      <Logo s={s} size={48} />
      <div className="mv-card-id">
        <p className="mv-card-kicker">{up ? "상승" : "하락"} {rank}위 · {s.market}</p>
        <h3 id={`m-${s.code}-t`}><Link to={`/stock/${s.code}`} onClick={() => report("stock", s.name)}>{s.name}</Link>{us && <small>{s.code}</small>}</h3>
        {s.theme && <span className="mv-tag">{s.theme}</span>}
      </div>
      <div className="mv-card-move"><Move value={s.change_pct} limit={s.limit} /><span>{price(s)}</span></div>
    </header>
    <dl className="mv-stats">
      <div><dt>거래대금</dt><dd>{s.turnover_label ?? eok(s.turnover_100m)}</dd></div>
      <div><dt>시가총액</dt><dd>{s.marcap_label ?? eok(s.marcap_100m)}</dd></div>
      <div><dt>20일 수익률</dt><dd>{pct(s.ret_20d)}</dd></div>
    </dl>
    <PriceChart s={s} us={us} />
    <section className="mv-why" aria-label={up ? "오른 이유" : "내린 이유"}>
      <h4>{up ? "왜 올랐을까" : "왜 내렸을까"}</h4>
      <p>{s.reason}</p>
    </section>
    {s.news.length > 0 && <section className="mv-news" aria-label={`${s.name} 관련 뉴스`}>
      <h4>관련 뉴스</h4>
      <ul>{s.news.slice(0, 3).map(n => <li key={n.url}><a href={n.url} target="_blank" rel="noopener noreferrer" onClick={() => report("news", s.name)}>
        <span>{n.title}</span><small>{[n.press, n.at.slice(5, 16).replace("-", ".")].filter(Boolean).join(" · ")}</small></a></li>)}</ul>
    </section>}
    <nav className="mv-card-links" aria-label={`${s.name} 더 보기`}>
      <Link to={`/stock/${s.code}`} onClick={() => report("chart", s.name)}>{us ? "차트·실적" : "차트·수급"}</Link>
      {!us && <Link to={`/investor/${s.code}`} onClick={() => report("investor", s.name)}>외국인·기관</Link>}
      <Link to={`/discussion-explorer?code=${s.code}&name=${encodeURIComponent(s.name)}${us ? "&market=US" : ""}`} onClick={() => report("talk", s.name)}>종목토론</Link>
    </nav>
  </article>;
}

/** 급등·급락 이유 — 국내(/movers)와 나스닥100(/movers/us)을 따로 정리합니다. */
export default function MoversPage({ market = "kr", archiveDay, archiveTime }: { market?: Market; archiveDay?: string; archiveTime?: string }) {
  const copy = COPY[market];
  const us = market === "us";
  const [data, setData] = useState<MoversEdition | null>(null);
  const [failed, setFailed] = useState(false);
  useDocumentTitle(archiveDay && data?.headline ? `${data.headline} | ${data.edition} ${data.slot_label} ${us ? "나스닥100 " : ""}급등·급락 이유 · KOSPIMAP` : archiveDay ? document.title : copy.title);
  useEffect(() => {
    let live = true;
    setData(null);
    const load = () => (archiveDay && archiveTime ? api.moversSlot(archiveDay, archiveTime, market) : api.movers(market))
      .then(v => { if (live) { setData(v); setFailed(false); } }).catch(() => { if (live) setFailed(true); });
    load();
    const timer = archiveDay ? undefined : window.setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, [archiveDay, archiveTime, market]);

  const tabs = <nav className="mv-markets" aria-label="시장 선택">
    <Link to="/movers" aria-current={!us ? "page" : undefined}>국내 코스피·코스닥</Link>
    <Link to="/movers/us" aria-current={us ? "page" : undefined}>미국 나스닥100</Link>
  </nav>;
  if (!data) return <main className="mv-page">{tabs}{failed ? <NeoEmptyState title="급등·급락 종목을 불러오지 못했습니다" error /> : <NeoSkeleton rows={8} />}</main>;
  if (!data.stocks.length) return <main className="mv-page">{tabs}<NeoEmptyState title="첫 정리를 준비하고 있습니다">{copy.schedule}에 급등·급락 종목과 이유를 정리합니다.</NeoEmptyState></main>;
  const ups = data.stocks.filter(s => s.direction === "up");
  const downs = data.stocks.filter(s => s.direction === "down");
  const shot = new URLSearchParams(window.location.search).get("shot") === "1";
  const spot = [...ups].sort((a, b) => (b.turnover_100m ?? 0) - (a.turnover_100m ?? 0))[0];
  return <main className={`mv-page${shot ? " is-shot" : ""}`} lang="ko">
    {!shot && tabs}
    <div id="mv-capture" className="mv-capture">
      <header className="mv-mast">
        <div className="mv-mast-top">
          <span className="mv-kicker"><i aria-hidden="true" />{copy.kicker}</span>
          <nav className="mv-slots" aria-label="시간대별 정리">
            {archiveDay ? <Link to={copy.base}>최신 보기</Link> : (data.day_slots ?? []).map(s => s.published
              ? <Link key={s.slot} to={`${copy.base}/${s.slot.slice(0, 10)}/${s.label.replace(":", "")}`} aria-current={s.slot === data.slot ? "page" : undefined}>{s.label}<small>{s.name}</small></Link>
              : <span key={s.slot} className="is-off">{s.label}<small>{s.name}</small></span>)}
          </nav>
        </div>
        <p className="mv-stamp">{dotDay(data.slot)} {data.slot_label} {data.slot_name} 기준{!archiveDay && data.next_update && <span>다음 업데이트 {dotDay(data.next_update) !== dotDay(data.slot) ? dotDay(data.next_update).slice(5) + " " : ""}{data.next_update.slice(11, 16)}</span>}</p>
        <h1>{data.headline}</h1>
        <p className="mv-dek">{data.dek}</p>
        <dl className="mv-summary">
          {(data.indices ?? []).map(i => <div key={i.name}><dt>{i.name}</dt><dd><span>{i.close != null ? i.close.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}</span>{i.change_pct != null && <Move value={i.change_pct} size="sm" />}</dd></div>)}
          {!us && <><div><dt>상한가</dt><dd><span>{data.limit_up ?? 0}</span><small>종목</small></dd></div>
            <div><dt>하한가</dt><dd><span>{data.limit_down ?? 0}</span><small>종목</small></dd></div></>}
        </dl>
      </header>
      {!shot && spot && <a className="mv-spot" href={`#m-${spot.code}`} onClick={() => report("spotlight", spot.name)}>
        <span className="mv-spot-label">오늘 가장 뜨거운 종목 · 거래대금 1위 급등주</span>
        <Logo s={spot} size={56} />
        <span className="mv-spot-main">
          <span className="mv-spot-name"><b>{spot.name}</b><Move value={spot.change_pct} limit={spot.limit} /></span>
          <p>{spot.reason}</p>
        </span>
        <span className="mv-spot-go">이유 자세히 보기 ↓</span>
      </a>}
      {!shot && <nav className="mv-jump" aria-label="종목 바로가기">{[...ups, ...downs].map(s =>
        <a key={s.code} href={`#m-${s.code}`} onClick={() => report("jump", s.name)}><Logo s={s} size={22} />{s.name}<em>{pct(s.change_pct)}</em></a>)}</nav>}
      <div className="mv-board">
        {ups.length > 0 && <Board title="많이 오른 종목" rows={ups} up limit={shot ? 7 : undefined} />}
        {downs.length > 0 && <Board title="많이 내린 종목" rows={downs} up={false} limit={shot ? 7 : undefined} />}
      </div>
      {!!data.themes?.length && !shot && <section className="mv-themes" aria-label="같이 움직인 종목">
        <h2>같이 움직인 종목</h2>
        <ul>{data.themes.map(t => <li key={t.name}><b>{t.name}</b><span>{t.codes.map(c => data.stocks.find(s => s.code === c)).filter((s): s is MoverStock => !!s).map(s =>
          <a key={s.code} href={`#m-${s.code}`}><Logo s={s} size={20} />{s.name}</a>)}</span></li>)}</ul>
      </section>}
      {shot && <p className="mv-site">종목별 이유 전체 보기 · kospimap.com{copy.base}</p>}
    </div>


    <InArticleAd className="mv-ad" />
    <section className="mv-cards" aria-label="종목별 이유">
      {[...ups, ...downs].map((s, i) => <Fragment key={s.code}>
        {i === 0 && <h2 className="mv-split">많이 오른 종목<small>종목별 이유와 최근 흐름</small></h2>}
        {i === ups.length && downs.length > 0 && <h2 className="mv-split">많이 내린 종목<small>종목별 이유와 최근 흐름</small></h2>}
        <Card s={s} us={us} rank={s.direction === "up" ? i + 1 : i - ups.length + 1} />
        {(i === 3 || i === 9) && i < ups.length + downs.length - 1 && <InArticleAd className="mv-ad" />}
      </Fragment>)}
      <MultiplexAd slot="5479707639" className="mv-multiplex" />
    </section>

    <nav className="mv-more" aria-label="더 보기">
      {us ? <><Link to="/nasdaq100-map">나스닥100 히트맵</Link><Link to="/nasdaq">나스닥 지수</Link><Link to="/movers">국내 급등·급락 이유</Link></>
        : <><Link to="/map">코스피 히트맵</Link><Link to="/kosdaq-map">코스닥 히트맵</Link><Link to="/movers/us">나스닥100 급등·급락 이유</Link></>}
      <Link to="/hot-issues">오늘의 핫이슈</Link><Link to="/world-markets">세계 증시</Link>
    </nav>
    <footer className="mv-foot">
      <p>{copy.foot} 이유는 공개 뉴스를 바탕으로 정리했으며, 뉴스로 확인되지 않는 움직임은 그렇게 적었습니다. 투자 판단의 근거가 아닌 참고 정보입니다.</p>
    </footer>
  </main>;
}
