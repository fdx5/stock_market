import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, type HotIssueHeadlines } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { Link } from "../router";
import { reportHotIssue } from "../useActivityTracking";
import "./hotIssueTicker.css";
import "./hotIssueTickerLight.css";

const REFRESH_MS = 5 * 60 * 1000;
const MAX_STORIES = 6;
const SPEED_PX_S = 64;
const IMPACT: Record<string, string> = { 호재: "is-good", 악재: "is-bad", 중립: "is-neutral", 혼재: "is-mixed" };

// The shell outlives every page, but keep the last edition across remounts too.
let cached: HotIssueHeadlines | null = null;
let cachedAt = 0;

function useHeadlines() {
  const [data, setData] = useState<HotIssueHeadlines | null>(cached);
  useEffect(() => {
    let live = true;
    const load = () => api.hotIssueHeadlines()
      .then(value => { cached = value; cachedAt = Date.now(); if (live) setData(value); })
      .catch(() => { /* Keep the last edition; the entry tag still links to the page. */ });
    if (!cached || Date.now() - cachedAt > REFRESH_MS) load();
    const timer = window.setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, []);
  return data;
}

/** 오늘의 핫이슈 mini board: the edition headline and stories 01–06 run right to left; each jumps to its story. */
export default function HotIssueTicker({ path }: { path: string }) {
  const { lang } = useLanguage();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const data = useHeadlines();
  const stories = (data?.stories ?? []).slice(0, MAX_STORIES);
  const seqRef = useRef<HTMLSpanElement>(null);
  const [duration, setDuration] = useState(0);

  // Constant reading speed: the loop time follows the width of one pass.
  useLayoutEffect(() => {
    const seq = seqRef.current;
    if (!seq) return;
    const measure = () => setDuration(Math.max(12, seq.offsetWidth / SPEED_PX_S));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(seq);
    return () => observer.disconnect();
  }, [stories.length, data?.headline]);

  const here = path === "/hot-issues" || path === "/hot-issues/";
  const tag = <Link to="/hot-issues" className="ng-hot-ticker-tag" aria-current={here ? "page" : undefined} onClick={() => reportHotIssue("entry:header", "상단 전광판 라벨")}>
    <i aria-hidden="true" /><span>{L("오늘의 핫이슈", "Hot issues")}</span>{data?.slot_label && <small>{data.slot_label}{L("판", "")}</small>}
  </Link>;
  if (!stories.length) return <div className="ng-hot-ticker is-empty">{tag}</div>;

  const pass = (copy: boolean) => <span className="ng-hot-ticker-seq" ref={copy ? undefined : seqRef} aria-hidden={copy || undefined}>
    {data?.headline && <Link to="/hot-issues" className="ng-hot-ticker-headline" tabIndex={copy ? -1 : undefined} onClick={() => reportHotIssue("ticker:headline", data.headline)}>
      <em>{L("헤드라인", "Headline")}</em><strong>{data.headline}</strong>
    </Link>}
    {stories.map(story => <Link key={story.id} to={`/hot-issues#${encodeURIComponent(story.id)}`} className={`ng-hot-ticker-item ${IMPACT[story.impact] ?? "is-neutral"}`} tabIndex={copy ? -1 : undefined} onClick={() => reportHotIssue(`ticker:${story.id}`, story.title)}>
      <b>{String(story.rank).padStart(2, "0")}</b><strong>{story.title}</strong><em>{story.impact}</em>
    </Link>)}
  </span>;

  return <div className="ng-hot-ticker is-ready" role="region" aria-label={L("오늘의 핫이슈 전광판", "Today's hot issues ticker")}>
    {tag}
    <div className="ng-hot-ticker-window">
      <div className="ng-hot-ticker-track" style={duration ? { animationDuration: `${duration.toFixed(1)}s` } : undefined}>
        {pass(false)}{pass(true)}
      </div>
    </div>
  </div>;
}
