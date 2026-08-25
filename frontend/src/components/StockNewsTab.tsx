import { useEffect, useRef, useState } from "react";
import { NewsItem, api } from "../api/client";
import { reportStocksEvent } from "../useActivityTracking";

/* 뉴스 for one stock, from Naver.
 *
 * Two sources behind one list, chosen by market: finance.naver's per-code news tab for
 * KRX names, and Naver news search by company name for the S&P 500, which has no such
 * tab. The rows are the same shape either way (see naver_news_search_fetcher's note on
 * matching news_fetcher's keys), so nothing below branches on which one answered.
 *
 * Structurally a sibling of StockDiscussionTab on purpose: same list, same paging, same
 * in-panel reading view with 이전글/다음글. A reader switching tabs should find the
 * controls where they left them, and an article and a post are the same interaction —
 * pick one from a list, read it, move along the list without going back.
 *
 * The list is paged client-side. Both sources answer with one block of the most
 * relevant/recent headlines rather than an addressable page N, so asking again would
 * return the same block; slicing what is already in hand is both honest about that and
 * instant.
 */

const PAGE_SIZE = 6;
const POOL_SIZE = 24;

interface Props {
  code: string;
  name: string;
  market: string;
  source: "naver-finance" | "naver-search";
}

export default function StockNewsTab({ code, name, market, source }: Props) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [paragraphs, setParagraphs] = useState<string[] | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);
  // One article body at a time: opening the next one while the previous is still
  // extracting (Readability over a slow outlet takes seconds) must not let the old
  // response land in the new article's view.
  const bodyRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setPage(1);
    setOpenIndex(null);
    setParagraphs(null);

    const request =
      source === "naver-search"
        ? api.usNews(code, POOL_SIZE)
        : api.news(code);

    request
      .then((result) => !cancelled && setItems(result.items))
      .catch(() => !cancelled && setError("뉴스를 불러오지 못했습니다."))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [code, source]);

  useEffect(() => () => bodyRequest.current?.abort(), []);

  const open = (index: number) => {
    const item = items[index];
    if (!item) return;
    reportStocksEvent({ action: "news_article", market, code, name, detail: item.title });
    bodyRequest.current?.abort();
    const controller = new AbortController();
    bodyRequest.current = controller;

    setOpenIndex(index);
    setParagraphs(null);
    setBodyLoading(true);
    api
      .newsArticle(item.link, controller.signal)
      .then((result) => !controller.signal.aborted && setParagraphs(result.paragraphs))
      .catch(() => !controller.signal.aborted && setParagraphs(null))
      .finally(() => !controller.signal.aborted && setBodyLoading(false));
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
        <button type="button" className="su-thread-back" onClick={() => { setOpenIndex(null); setParagraphs(null); }}>
          ‹ 목록으로
        </button>
        <article className="su-thread-post">
          <h3>{current.title}</h3>
          <div className="su-thread-meta">
            <span className="su-thread-author">{current.press || "언론사 미상"}</span>
            <time>{current.date}</time>
            <a href={current.link} target="_blank" rel="noopener noreferrer" className="su-thread-source">
              원문 보기 ↗
            </a>
          </div>
          <div className="su-thread-body">
            {bodyLoading && <p className="su-inline-loading"><i />기사를 불러오는 중</p>}
            {!bodyLoading && paragraphs?.map((text, index) => <p key={index}>{text}</p>)}
            {!bodyLoading && !paragraphs && (
              <>
                {current.summary ? <p>{current.summary}</p> : null}
                <p className="su-thread-empty">
                  이 기사는 본문을 불러올 수 없습니다. 위의 원문 보기로 확인해 주세요.
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
                <li key={item.link}>
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
          <b>{page}</b> / {totalPages} 페이지
        </span>
        <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
          다음 ›
        </button>
      </nav>
    </div>
  );
}
