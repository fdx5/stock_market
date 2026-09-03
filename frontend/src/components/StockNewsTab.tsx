import { useEffect, useRef, useState } from "react";
import { NewsItem, TossNewsItem, api } from "../api/client";
import { shortDateTime } from "../stocks/market";
import { reportMarketOrbitEvent, reportStocksEvent } from "../useActivityTracking";

/* 뉴스 for one stock.
 *
 * Three sources behind one list, chosen by market: finance.naver's per-code news tab
 * for KRX names, Toss Securities' per-company feed for US names, and Naver news search
 * by company name as the older US path (still used by the 증시버블 NASDAQ tab). The
 * rows are normalised to `NewsRow`, so nothing below the fetch branches on which one
 * answered — except where the sources genuinely differ, which is the body:
 *
 *   Naver rows own a URL, and reading one means asking the server to fetch the
 *   outlet's page and reduce it with Readability. That is slow and fails outright on a
 *   paywall or a script-built page, which is why `paragraphs` can come back null.
 *
 *   Toss rows own an id instead. Toss serves the article body itself, already
 *   segmented into paragraphs and translated into Korean, plus a three-sentence digest
 *   and — only here, not in the list — the outlet's own URL. So the body is data, and
 *   the failure mode above mostly stops existing.
 *
 * Structurally a sibling of StockDiscussionTab on purpose: same list, same paging, same
 * in-panel reading view with 이전글/다음글. A reader switching tabs should find the
 * controls where they left them, and an article and a post are the same interaction —
 * pick one from a list, read it, move along the list without going back.
 *
 * Paging differs by source for an honest reason. Both Naver paths answer with one block
 * of the most relevant/recent headlines rather than an addressable page N, so asking
 * again would return the same block; slicing what is already in hand is both truthful
 * about that and instant. Toss's feed really is addressable, so the list grows: reaching
 * its last page pulls the next block and appends it. Either way the pager below is
 * slicing one array, and 이전글/다음글 walks it without meeting a boundary.
 */

const PAGE_SIZE = 6;
const POOL_SIZE = 24;
/** How many Toss articles one fetch asks for. Two panel pages' worth, so the next block
 *  is fetched while the reader is on the last loaded page rather than after they hit
 *  the end of it. */
const TOSS_FETCH_SIZE = 12;

/** One row of the list, whichever feed produced it. */
interface NewsRow {
  title: string;
  press: string;
  date: string;
  summary: string;
  /** The outlet's own URL. Empty for a Toss row until its article has been opened —
   *  Toss discloses the link on the detail response, not in the feed. */
  link: string;
  /** Set only on Toss rows, and the thing that decides how the body is read. */
  id: string | null;
}

function fromNaver(item: NewsItem): NewsRow {
  return {
    title: item.title,
    press: item.press,
    date: item.date,
    summary: item.summary ?? "",
    link: item.link,
    id: null,
  };
}

function fromToss(item: TossNewsItem): NewsRow {
  return {
    title: item.title,
    press: item.press,
    // Toss timestamps are ISO; Naver's are already short ("34분 전", "2026.09.03").
    // Normalised here so one <time> renders both without asking where it came from.
    date: shortDateTime(item.date),
    summary: item.summary,
    link: "",
    id: item.id,
  };
}

interface Props {
  code: string;
  name: string;
  market: string;
  source: "naver-finance" | "naver-search" | "toss";
  trackingContext?: "stocks" | "orbit";
}

export default function StockNewsTab({ code, name, market, source, trackingContext = "stocks" }: Props) {
  const [items, setItems] = useState<NewsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  // Toss-only: how deep into its feed we have read, and whether it says there is more.
  const [feedPage, setFeedPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [paragraphs, setParagraphs] = useState<string[] | null>(null);
  const [digest, setDigest] = useState<string[]>([]);
  /** Where 원문 보기 points. A Naver row knows this from the list; a Toss row learns it
   *  when the article is fetched, so this is state rather than a field off `current`. */
  const [articleLink, setArticleLink] = useState("");
  const [bodyLoading, setBodyLoading] = useState(false);
  // One article body at a time: opening the next one while the previous is still in
  // flight must not let the old response land in the new article's view.
  const bodyRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setPage(1);
    setOpenIndex(null);
    setParagraphs(null);
    setDigest([]);
    setItems([]);
    setFeedPage(1);
    setHasMore(false);

    const request: Promise<{ rows: NewsRow[]; more: boolean }> =
      source === "toss"
        ? api
            .tossNews(code, TOSS_FETCH_SIZE, 1)
            .then((result) => ({ rows: result.items.map(fromToss), more: result.has_next }))
        : (source === "naver-search" ? api.usNews(code, POOL_SIZE) : api.news(code)).then(
            (result) => ({ rows: result.items.map(fromNaver), more: false }),
          );

    request
      .then(({ rows, more }) => {
        if (cancelled) return;
        setItems(rows);
        setHasMore(more);
      })
      .catch(() => !cancelled && setError("뉴스를 불러오지 못했습니다."))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [code, source]);

  /** Grows the Toss list when the reader reaches the end of what is loaded.
   *
   * Prefetching on arrival at the last page — rather than on a click at the boundary —
   * is what keeps the rest of this component boundary-free: by the time 다음 or 다음글
   * is pressed, the array is already longer, so the pager and the article stepper are
   * still just walking one list. `items.length` growing is also what stops this from
   * re-running: another page now fits, so `page < totalPages` and it returns.
   */
  useEffect(() => {
    if (source !== "toss" || !hasMore || loadingMore || loading) return;
    if (page < Math.max(1, Math.ceil(items.length / PAGE_SIZE))) return;

    let cancelled = false;
    setLoadingMore(true);
    const next = feedPage + 1;
    api
      .tossNews(code, TOSS_FETCH_SIZE, next)
      .then((result) => {
        if (cancelled) return;
        setFeedPage(next);
        // An empty block is the end of the feed whatever has_next claims — without
        // this the effect would keep asking for pages that cannot grow the list.
        setHasMore(result.has_next && result.items.length > 0);
        setItems((old) => {
          // A feed that gains an article between two page requests shifts every later
          // one down, and the article at the seam would otherwise arrive twice.
          const seen = new Set(old.map((row) => row.id));
          return [...old, ...result.items.filter((item) => !seen.has(item.id)).map(fromToss)];
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
    if (trackingContext === "orbit")
      reportMarketOrbitEvent({ action: "news_article", market, code, name, detail: item.title });
    else reportStocksEvent({ action: "news_article", market, code, name, detail: item.title });
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
        .then((article) => {
          if (controller.signal.aborted) return;
          setDigest(article.summary_sentences);
          setArticleLink(article.link);
          setParagraphs(article.paragraphs);
        })
        .catch(() => !controller.signal.aborted && setParagraphs(null))
        .finally(done);
    } else {
      api
        .newsArticle(item.link, controller.signal)
        .then((result) => !controller.signal.aborted && setParagraphs(result.paragraphs))
        .catch(() => !controller.signal.aborted && setParagraphs(null))
        .finally(done);
    }
  };

  const step = (direction: -1 | 1) => {
    if (openIndex == null) return;
    const next = openIndex + direction;
    if (next >= 0 && next < items.length) {
      // Keep the list page in step with the article being read, so returning to the
      // list lands on the page the article is actually on.
      setPage(Math.floor(next / PAGE_SIZE) + 1);
      open(next);
    }
  };

  const current = openIndex == null ? null : items[openIndex];
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const visible = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (current) {
    return (
      <div className="su-thread">
        <button
          type="button"
          className="su-thread-back"
          onClick={() => { setOpenIndex(null); setParagraphs(null); setDigest([]); }}
        >
          ‹ 목록으로
        </button>
        <article className="su-thread-post">
          <h3>{current.title}</h3>
          <div className="su-thread-meta">
            <span className="su-thread-author">{current.press || "언론사 미상"}</span>
            <time>{current.date}</time>
            {articleLink ? (
              <a href={articleLink} target="_blank" rel="noopener noreferrer" className="su-thread-source">
                원문 보기 ↗
              </a>
            ) : null}
          </div>
          <div className="su-thread-body">
            {bodyLoading && <p className="su-inline-loading"><i />기사를 불러오는 중</p>}
            {/* Toss's own digest, above the body it summarises. Worth its own block
                because it is the one thing here that truncating the article cannot give. */}
            {!bodyLoading && digest.length > 0 && (
              <ul className="su-thread-digest">
                {digest.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            )}
            {!bodyLoading && paragraphs?.map((text, index) => <p key={index}>{text}</p>)}
            {!bodyLoading && !paragraphs && (
              <>
                {digest.length === 0 && current.summary ? <p>{current.summary}</p> : null}
                <p className="su-thread-empty">
                  {articleLink
                    ? "이 기사는 본문을 불러올 수 없습니다. 위의 원문 보기로 확인해 주세요."
                    : "이 기사는 본문을 불러올 수 없습니다."}
                </p>
              </>
            )}
          </div>
        </article>
        <nav className="su-thread-nav" aria-label="기사 이동">
          <button type="button" disabled={openIndex === 0} onClick={() => step(-1)}>
            <small>PREV</small>
            <span>‹ 이전글</span>
          </button>
          <button type="button" disabled={openIndex === items.length - 1} onClick={() => step(1)}>
            <small>NEXT</small>
            <span>다음글 ›</span>
          </button>
        </nav>
      </div>
    );
  }

  return (
    <div className="su-list">
      <div className="su-list-scroll" data-track="self">
        {loading && (
          <ul className="su-news-list su-news-list--skeleton">
            {Array.from({ length: 5 }, (_, i) => (
              <li key={i}>
                <span className="su-skeleton su-skeleton--text" />
                <span className="su-skeleton su-skeleton--sub" />
              </li>
            ))}
          </ul>
        )}
        {!loading && error && <p className="su-panel-message">{error}</p>}
        {!loading && !error && items.length === 0 && (
          <p className="su-panel-message">관련 뉴스가 없습니다.</p>
        )}
        {!loading && visible.length > 0 && (
          <ul className="su-news-list">
            {visible.map((item, index) => {
              const absolute = (page - 1) * PAGE_SIZE + index;
              return (
                <li key={item.id || item.link || absolute}>
                  <button type="button" onClick={() => open(absolute)}>
                    <span className="su-news-copy">
                      <strong>{item.title}</strong>
                      {item.summary ? <p>{item.summary}</p> : null}
                      <small>
                        <em>{item.press || "언론사 미상"}</em>
                        {item.date ? <i>{item.date}</i> : null}
                      </small>
                    </span>
                    <span className="su-post-caret" aria-hidden="true">›</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <nav className="su-list-pager" aria-label="뉴스 페이지">
        <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          ‹ 이전
        </button>
        <span>
          {/* A Toss feed has no known length — the list grows as it is read — so a
              "3 / 4" here would be a total that keeps moving. It gets the page it is on. */}
          {source === "toss" ? (
            <>
              <b>{page}</b> 페이지
            </>
          ) : (
            <>
              <b>{page}</b> / {totalPages} 페이지
            </>
          )}
        </span>
        <button
          type="button"
          disabled={page >= totalPages && !(hasMore || loadingMore)}
          onClick={() => setPage((p) => p + 1)}
        >
          다음 ›
        </button>
      </nav>
    </div>
  );
}
