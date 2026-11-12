import { useEffect, useMemo, useState } from "react";
import { api, type HotIssueEdition, type HotIssueStory } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { Link } from "../router";
import { reportHotIssue } from "../useActivityTracking";
import { useDocumentTitle } from "../useDocumentTitle";
import { NeoEmptyState, NeoSkeleton } from "./NeoComponents";
import "./hotIssues.css";

const CATEGORY: Record<string, string> = {
  global: "글로벌", korea: "국내", macro: "거시경제", policy: "정책", earnings: "실적", geopolitics: "지정학",
  tech: "기술", commodity: "원자재", fx: "환율", crypto: "가상자산",
};
const IMPACT_CLASS: Record<string, string> = { 호재: "is-good", 악재: "is-bad", 중립: "is-neutral", 혼재: "is-mixed" };
const MOOD: Record<string, [string, string]> = { "risk-on": ["위험선호", "is-good"], "risk-off": ["위험회피", "is-bad"], mixed: ["혼조", "is-mixed"] };
const LANG: Record<string, string> = { ko: "국내", en: "영문", ja: "일문", zh: "중문", other: "해외" };
const REFRESH_MS = 5 * 60 * 1000;

const grouped = (v: string) => /^-?\d{4,}(\.\d+)?$/.test(v) ? Number(v).toLocaleString("en-US", { maximumFractionDigits: 4 }) : v;
const time = (iso?: string) => iso ? iso.slice(11, 16) : "";
const day = (iso?: string) => iso ? iso.slice(0, 10).replace(/-/g, ".") : "";

function Importance({ value }: { value: number }) {
  return <span className="hi-importance" role="img" aria-label={`중요도 ${value}/5`}>{[1, 2, 3, 4, 5].map(n => <i key={n} className={n <= value ? "is-on" : ""} />)}</span>;
}

function Media({ story }: { story: HotIssueStory }) {
  const [play, setPlay] = useState(false);
  if (story.video) {
    const v = story.video;
    return <figure className="hi-media hi-media--video">
      {play ? <iframe src={`https://www.youtube-nocookie.com/embed/${v.youtube_id}?autoplay=1&rel=0`} title={v.title} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen loading="lazy" />
        : <button type="button" className="hi-video-poster" onClick={() => { setPlay(true); reportHotIssue(`video:${story.id}`, v.title); }} aria-label={`영상 재생: ${v.title}`}>
          <img src={`https://i.ytimg.com/vi/${v.youtube_id}/hqdefault.jpg`} alt="" loading="lazy" /><span className="hi-play" aria-hidden="true" />
        </button>}
      <figcaption>▶ {v.title}{v.channel && <> · {v.channel}</>}</figcaption>
    </figure>;
  }
  if (story.image) {
    const img = story.image;
    return <figure className="hi-media">
      <img src={img.url} alt={img.alt} loading="lazy" referrerPolicy="no-referrer" />
      <figcaption>{img.alt}{(img.credit || img.license) && <> · <a href={img.source_url || img.url} target="_blank" rel="noopener noreferrer">{[img.credit, img.license].filter(Boolean).join(", ")}</a></>}</figcaption>
    </figure>;
  }
  return null;
}

function Story({ story, lead = false }: { story: HotIssueStory; lead?: boolean }) {
  const [open, setOpen] = useState(lead || story.importance >= 4);
  const media = <Media story={story} />;
  return <article className={`hi-story${lead ? " hi-story--lead" : ""}`} id={story.id} aria-labelledby={`${story.id}-t`}>
    <div className="hi-story-rank" aria-hidden="true">{String(story.rank).padStart(2, "0")}</div>
    <div className="hi-story-main">
      <div className="hi-story-meta">
        <span className={`hi-impact ${IMPACT_CLASS[story.impact] ?? "is-neutral"}`}>{story.impact}</span>
        <span className="hi-tag">{story.region === "korea" ? "국내" : "해외"} · {CATEGORY[story.category] ?? story.category}</span>
        <Importance value={story.importance} />
      </div>
      <h2 id={`${story.id}-t`}>{story.title}</h2>
      {story.original_title && <p className="hi-original" lang="en"><span>원문</span>{story.original_title}</p>}
      <p className="hi-summary">{story.summary}</p>
      {(story.image || story.video) && <div className="hi-story-media">{media}</div>}
      {open ? <div className="hi-body">
        {story.body.map((p, i) => <p key={i}>{p}</p>)}
        {story.why_it_matters && <aside className="hi-why"><b>왜 중요한가</b><p>{story.why_it_matters}</p></aside>}
      </div> : <button type="button" className="hi-more" onClick={() => { setOpen(true); reportHotIssue(`open:${story.id}`, story.title); }}>자세히 읽기 <span aria-hidden="true">↓</span></button>}
      {story.affected.length > 0 && <ul className="hi-affected" aria-label="관련 종목">{story.affected.map(a => {
        const chip = <><i className={`is-${a.direction}`} aria-hidden="true">{a.direction === "up" ? "▲" : a.direction === "down" ? "▼" : "◆"}</i>{a.name}</>;
        return <li key={a.name}>{a.code ? <Link to={`/stock/${encodeURIComponent(a.code)}`} onClick={() => reportHotIssue(`stock:${a.code}`, a.name)}>{chip}</Link> : <span>{chip}</span>}</li>;
      })}</ul>}
      <ul className="hi-sources" aria-label="출처">{story.sources.map(s => <li key={s.url}>
        <a href={s.url} target="_blank" rel="noopener noreferrer" onClick={() => reportHotIssue(`source:${story.id}`, s.publisher)}>
          <b>{s.publisher}</b><span>{s.title}</span>{s.language !== "ko" && <em>{LANG[s.language] ?? "해외"} · 번역 요약</em>}
        </a>
      </li>)}</ul>
    </div>
  </article>;
}

/** 오늘의 핫이슈: one page per edition, refreshed at 07:00, 13:00 and 22:00 KST. */
export default function HotIssuesPage() {
  const { lang } = useLanguage();
  const [data, setData] = useState<HotIssueEdition | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [home, setHome] = useState<HotIssueEdition | null>(null);
  useDocumentTitle("오늘의 핫이슈 — 국내·해외 증시 호재·악재 한 장 정리 | KOSPIMAP");
  useEffect(() => {
    let live = true;
    const load = () => (picked ? api.hotIssueSlot(picked.slice(0, 10), picked.slice(11, 16).replace(":", "")) : api.hotIssues())
      .then(value => { if (!live) return; if (!picked) setHome(value); setData(value); setFailed(false); })
      .catch(() => { if (live) setFailed(true); });
    load();
    const timer = picked ? undefined : window.setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, [picked]);
  const tally = useMemo(() => {
    const out = { 호재: 0, 악재: 0, 중립: 0, 혼재: 0 } as Record<string, number>;
    data?.stories.forEach(s => { out[s.impact] = (out[s.impact] ?? 0) + 1; });
    return out;
  }, [data]);
  if (!data) return <main className="hi-page">{failed ? <NeoEmptyState title="핫이슈를 불러오지 못했습니다" error /> : <NeoSkeleton rows={8} />}</main>;
  if (!data.stories.length) return <main className="hi-page"><NeoEmptyState title="첫 판을 준비하고 있습니다">매일 07:00 · 13:00 · 22:00에 새 판이 올라옵니다. 다음 갱신 {time(home?.next_update)}</NeoEmptyState></main>;
  const [lead, ...rest] = data.stories;
  const mood = MOOD[data.mood?.tone ?? "mixed"];
  return <main className="hi-page" lang="ko">
    <header className="hi-mast">
      <div className="hi-mast-top">
        <span className="hi-kicker"><i aria-hidden="true" />TODAY'S HOT ISSUES</span>
        <nav className="hi-editions" aria-label="오늘 발행된 판">
          {(home?.today_slots ?? []).map(s => <button type="button" key={s.slot} disabled={!s.published} aria-pressed={(picked ?? home?.slot) === s.slot}
            onClick={() => { setPicked(s.slot === home?.slot ? null : s.slot); reportHotIssue(`edition:${s.label}`, `${s.label}판`); }}>{s.label}<small>{s.published ? "판" : "미발행"}</small></button>)}
        </nav>
      </div>
      <p className="hi-stamp"><b>{day(data.slot)} {data.slot_label}판</b>{home?.next_update && <span>다음 갱신 {day(home.next_update) !== day(home.latest_slot) ? "내일 " : ""}{time(home.next_update)}</span>}{home?.is_latest === false && !picked && <span className="hi-late">최신 판 준비 중 · 직전 판을 보여드립니다</span>}</p>
      <h1>{data.headline}</h1>
      {data.dek && <p className="hi-dek">{data.dek}</p>}
      <div className="hi-mood-row">
        {mood && <span className={`hi-mood ${mood[1]}`}><b>{mood[0]}</b>{data.mood?.summary}</span>}
        <span className="hi-tally" aria-label="이슈 성격 분포">{(["호재", "악재", "혼재", "중립"] as const).filter(k => tally[k]).map(k => <span key={k} className={IMPACT_CLASS[k]}>{k} {tally[k]}</span>)}</span>
      </div>
      {!!data.key_numbers?.length && <dl className="hi-numbers">{data.key_numbers.map(n => {
        const tone = /^[+▲]/.test(n.change) ? "is-up" : /^[-−▼]/.test(n.change) ? "is-down" : "";
        return <div key={n.label}><dt>{n.label}</dt><dd><b>{grouped(n.value)}</b><span className={tone}>{n.change}</span></dd>{n.note && <small>{n.note}</small>}</div>;
      })}</dl>}
    </header>

    <div className="hi-layout">
      <div className="hi-stories">
        <Story story={lead} lead />
        {rest.map(story => <Story key={story.id} story={story} />)}
      </div>
      <aside className="hi-side">
        <section className="hi-panel" aria-labelledby="hi-index-h"><h3 id="hi-index-h">이번 판 이슈</h3><ol className="hi-index">{data.stories.map(s => <li key={s.id}><a href={`#${s.id}`}><span className={`hi-dot ${IMPACT_CLASS[s.impact]}`} aria-hidden="true" />{s.title}</a></li>)}</ol></section>
        {!!data.takeaways?.length && <section className="hi-panel" aria-labelledby="hi-take-h"><h3 id="hi-take-h">핵심 정리</h3><ul className="hi-takeaways">{data.takeaways.map((t, i) => <li key={i}>{t}</li>)}</ul></section>}
        {!!data.watchlist?.length && <section className="hi-panel" aria-labelledby="hi-watch-h"><h3 id="hi-watch-h">다음에 볼 일정</h3><ol className="hi-watch">{data.watchlist.map((w, i) => <li key={i}><time>{w.when}</time><b>{w.event}</b>{w.note && <span>{w.note}</span>}</li>)}</ol></section>}
        <section className="hi-panel hi-links"><h3>시장 바로 보기</h3><Link to="/kospi">코스피 지수 ↗</Link><Link to="/kosdaq">코스닥 지수 ↗</Link><Link to="/nasdaq">나스닥 지수 ↗</Link><Link to="/pulse-board">증시 전광판 ↗</Link></section>
      </aside>
    </div>
    <footer className="hi-foot">
      <p>이 페이지는 국내외 언론의 공개 보도를 바탕으로 AI가 요약·번역해 매일 07:00, 13:00, 22:00(한국 시간)에 새로 정리합니다. 해외 기사는 핵심 내용을 한국어로 옮겼으며, 정확한 수치와 전문은 각 출처에서 확인하세요. 투자 판단의 근거가 아닌 참고 정보입니다.</p>
      {data.generated_at && <p className="hi-foot-meta">작성 {data.generated_at.replace("T", " ").slice(0, 16)} KST{lang === "en" ? " · Korean edition" : ""}</p>}
    </footer>
  </main>;
}
