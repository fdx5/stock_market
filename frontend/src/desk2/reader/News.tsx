import { useEffect, useRef, useState } from "react";
import { NewsItem, TossNewsItem, api } from "../../api/client";
import { shortDateTime } from "../../stocks/market";
import { reportStocksEvent } from "../../useActivityTracking";
import { Skel } from "../parts";
import { useL } from "../lib";

/* 관련 기사 on the broadsheet pages.
 *
 * StockNewsTab's logic, carried over: finance.naver's per-code tab for KRX names,
 * Toss's per-company feed for US names (addressable, so it grows as it is read),
 * Naver news search as the older US path. Articles are read in place — a Naver link
 * is reduced server-side (and may fail on a paywall), a Toss article arrives as data
 * with its own three-line digest. Its own markup, so older stylesheets cannot reach it. */

const PAGE_SIZE = 6;
const POOL_SIZE = 24;
const TOSS_FETCH_SIZE = 12;

interface Row {
  title: string;
  press: string;
  date: string;
  summary: string;
  link: string;
  id: string | null;
  image?: string | null;
}

const fromNaver = (n: NewsItem): Row => ({ title: n.title, press: n.press, date: n.date, summary: n.summary ?? "", link: n.link, id: null });
const fromToss = (n: TossNewsItem): Row => ({ title: n.title, press: n.press, date: shortDateTime(n.date), summary: n.summary, link: "", id: n.id, image: n.image_url });

export default function News({
  code,
  name,
  source,
  track,
  lead = false,
}: {
  code: string;
  name: string;
  source: "naver-finance" | "naver-search" | "toss";
  track?: string;
  /** Sets the first item of the first page as a lead story, with its summary. */
  lead?: boolean;
}) {
  const L = useL();
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [feedPage, setFeedPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [paragraphs, setParagraphs] = useState<string[] | null>(null);
  const [digest, setDigest] = useState<string[]>([]);
  const [articleLink, setArticleLink] = useState("");
  const [bodyLoading, setBodyLoading] = useState(false);
  const bodyRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setPage(1);
    setOpenIndex(null);
    setItems([]);
    setFeedPage(1);
    setHasMore(false);
    const request: Promise<{ rows: Row[]; more: boolean }> =
      source === "toss"
        ? api.tossNews(code, TOSS_FETCH_SIZE, 1).then((r) => ({ rows: r.items.map(fromToss), more: r.has_next }))
        : (source === "naver-search" ? api.usNews(code, POOL_SIZE) : api.news(code)).then((r) => ({ rows: r.items.map(fromNaver), more: false }));
    request
      .then(({ rows, more }) => {
        if (cancelled) return;
        setItems(rows);
        setHasMore(more);
      })
      .catch(() => !cancelled && setError(L("뉴스를 불러오지 못했습니다.", "Could not load news.")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, source]);

  useEffect(() => {
    if (source !== "toss" || !hasMore || loadingMore || loading) return;
    if (page < Math.max(1, Math.ceil(items.length / PAGE_SIZE))) return;
    let cancelled = false;
    setLoadingMore(true);
    const next = feedPage + 1;
    api
      .tossNews(code, TOSS_FETCH_SIZE, next)
      .then((r) => {
        if (cancelled) return;
        setFeedPage(next);
        setHasMore(r.has_next && r.items.length > 0);
        setItems((old) => {
          const seen = new Set(old.map((row) => row.id));
          return [...old, ...r.items.filter((i) => !seen.has(i.id)).map(fromToss)];
        });
      })
      .catch(() => !cancelled && setHasMore(false))
      .finally(() => !cancelled && setLoadingMore(false));
    return () => {
      cancelled = true;
    };
  }, [source, code, page, hasMore, loadingMore, loading, items.length, feedPage]);

  useEffect(() => () => bodyRequest.current?.abort(), []);

  const open = (index: number) => {
    const item = items[index];
    if (!item) return;
    if (track) reportStocksEvent({ action: "news_article", market: track, code, name, detail: item.title });
    bodyRequest.current?.abort();
    const controller = new AbortController();
    bodyRequest.current = controller;
    setOpenIndex(index);
    setParagraphs(null);
    setDigest([]);
    setArticleLink(item.link);
    setBodyLoading(true);
    const done = () => !controller.signal.aborted && setBodyLoading(false);
    if (item.id) {
      api
        .tossNewsArticle(item.id, controller.signal)
        .then((a) => {
          if (controller.signal.aborted) return;
          setDigest(a.summary_sentences);
          setArticleLink(a.link);
          setParagraphs(a.paragraphs);
        })
        .catch(() => !controller.signal.aborted && setParagraphs(null))
        .finally(done);
    } else {
      api
        .newsArticle(item.link, controller.signal)
        .then((r) => !controller.signal.aborted && setParagraphs(r.paragraphs))
        .catch(() => !controller.signal.aborted && setParagraphs(null))
        .finally(done);
    }
  };

  const step = (d: -1 | 1) => {
    if (openIndex == null) return;
    const next = openIndex + d;
    if (next >= 0 && next < items.length) {
      setPage(Math.floor(next / PAGE_SIZE) + 1);
      open(next);
    }
  };

  const current = openIndex == null ? null : items[openIndex];
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const visible = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (current) {
    return (
      <div className="rd">
        <button type="button" className="rd-back" onClick={() => setOpenIndex(null)}>
          ← {L("목록으로", "Back to list")}
        </button>
        <article className="rd-article">
          <h4>{current.title}</h4>
          <p className="rd-byline">
            <b>{current.press || L("언론사 미상", "Unknown outlet")}</b>
            <time>{current.date}</time>
            {articleLink && (
              <a href={articleLink} target="_blank" rel="noopener noreferrer">
                {L("원문 보기", "Original")} ↗
              </a>
            )}
          </p>
          <div className="rd-body">
            {bodyLoading && (
              <>
                <Skel h={14} />
                <Skel h={14} w="92%" />
                <Skel h={14} w="80%" />
              </>
            )}
            {!bodyLoading && digest.length > 0 && (
              <ul className="rd-digest">
                {digest.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
            {!bodyLoading && paragraphs?.map((t, i) => <p key={i}>{t}</p>)}
            {!bodyLoading && !paragraphs && (
              <>
                {digest.length === 0 && current.summary && <p>{current.summary}</p>}
                <p className="rd-note">
                  {articleLink
                    ? L("이 기사는 본문을 불러올 수 없습니다. 원문 보기로 확인해 주세요.", "The body could not be loaded — use the original link.")
                    : L("이 기사는 본문을 불러올 수 없습니다.", "The body could not be loaded.")}
                </p>
              </>
            )}
          </div>
        </article>
        <nav className="rd-steps" aria-label={L("기사 이동", "Move between articles")}>
          <button type="button" disabled={openIndex === 0} onClick={() => step(-1)}>
            ← {L("이전 기사", "Previous")}
          </button>
          <span>
            {(openIndex ?? 0) + 1}/{items.length}
          </span>
          <button type="button" disabled={openIndex === items.length - 1} onClick={() => step(1)}>
            {L("다음 기사", "Next")} →
          </button>
        </nav>
      </div>
    );
  }

  return (
    <div className="rd">
      {loading ? (
        <ol className="rd-list" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="is-skel">
              <Skel h={16} />
              <Skel h={11} w="40%" />
            </li>
          ))}
        </ol>
      ) : error ? (
        <p className="rd-note">{error}</p>
      ) : items.length === 0 ? (
        <p className="rd-note">{L("관련 뉴스가 없습니다.", "No related news.")}</p>
      ) : (
        <ol className="rd-list rd-list--news">
          {visible.map((item, i) => {
            const absolute = (page - 1) * PAGE_SIZE + i;
            const isLead = lead && absolute === 0;
            return (
              <li key={item.id || item.link || absolute} className={isLead ? "is-lead" : ""}>
                <button type="button" onClick={() => open(absolute)}>
                  {isLead && item.image && <img src={item.image} alt="" loading="lazy" />}
                  <span className="rd-copy">
                    <strong>{item.title}</strong>
                    {item.summary && (isLead || source === "toss") && <p>{item.summary}</p>}
                    <small>
                      <b>{item.press || L("언론사 미상", "Unknown outlet")}</b>
                      {item.date && <time>{item.date}</time>}
                    </small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <nav className="rd-pager" aria-label={L("뉴스 페이지", "News pages")}>
        <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          ← {L("이전", "Prev")}
        </button>
        <span>
          <b>{page}</b>
          {source === "toss" ? ` ${L("쪽", "page")}` : ` / ${totalPages} ${L("쪽", "pages")}`}
        </span>
        <button type="button" disabled={page >= totalPages && !(hasMore || loadingMore)} onClick={() => setPage((p) => p + 1)}>
          {L("다음", "Next")} →
        </button>
      </nav>
    </div>
  );
}
