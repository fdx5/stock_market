import { useEffect, useState } from "react";
import { BoardComment, BoardDetail, BoardPost, GlobalDiscussionPost, api } from "../../api/client";
import { Link } from "../../router";
import { shortDateTime } from "../../stocks/market";
import { reportStocksEvent } from "../../useActivityTracking";
import { Skel } from "../parts";
import { useL } from "../lib";

/* 종목토론 on the broadsheet pages — the 독자투고란.
 *
 * The paging and reading logic is StockDiscussionTab's, carried over whole: Naver's
 * board paginates by page number (20 a page, shown 10 at a time), Toss and Naver's
 * 해외종목 board by an opaque cursor, and 이전글/다음글 walk across page boundaries by
 * turning the page and reopening at the near end. What is new is the reading view,
 * which now also carries the post's comments (Naver only — the other two boards do
 * not publish them), as the classic detail page's board did. It has its own markup
 * so the older stylesheets that style the tab cannot reach it. */

interface Post {
  id: string;
  title: string;
  preview: string;
  author: string;
  date: string;
  views: number;
  likes: number;
  dislikes: number;
}

const PAGE_SIZE = 10;
const NAVER_MORE_HINT = 15;

function fromNaver(p: BoardPost): Post {
  return { id: p.nid, title: p.title, preview: "", author: p.author, date: p.date, views: p.views, likes: p.likes, dislikes: p.dislikes };
}

function fromGlobal(p: GlobalDiscussionPost): Post {
  return {
    id: p.id,
    title: p.title?.trim() || p.text.slice(0, 60),
    preview: p.text,
    author: p.author,
    date: p.written_at,
    views: p.views,
    likes: p.likes,
    dislikes: p.dislikes,
  };
}

export default function Discussion({
  code,
  name,
  source,
  track,
  explorerHref,
}: {
  code: string;
  name: string;
  source: "naver" | "global" | "toss";
  /** When set, reads are reported to the 종목정보 action log under this market. */
  track?: string;
  explorerHref?: string;
}) {
  const L = useL();
  const inline = source !== "naver";
  const [posts, setPosts] = useState<Post[]>([]);
  const [page, setPage] = useState(1);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [detail, setDetail] = useState<BoardDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [comments, setComments] = useState<BoardComment[] | null>(null);
  const [pendingOpen, setPendingOpen] = useState<"first" | "last" | null>(null);

  useEffect(() => {
    setPage(1);
    setCursors([null]);
    setOpenIndex(null);
    setDetail(null);
    setComments(null);
    setPendingOpen(null);
  }, [code, source]);

  const openFrom = (list: Post[], index: number) => {
    const post = list[index];
    if (!post) return;
    if (track) reportStocksEvent({ action: "discussion_post", market: track, code, name, detail: post.title });
    setOpenIndex(index);
    setDetail(null);
    setComments(null);
    if (inline) return;
    setDetailLoading(true);
    api
      .boardDetail(code, post.id)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
    api
      .boardComments(code, post.id)
      .then((res) => setComments(res.items))
      .catch(() => setComments([]));
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const cursor = cursors[page - 1] ?? null;
    const request =
      source === "toss"
        ? api.tossDiscussion(code, PAGE_SIZE, cursor)
        : source === "global"
          ? api.globalDiscussion(code, PAGE_SIZE, cursor)
          : api.board(code, Math.floor((page - 1) / 2) + 1, page === 1);
    request
      .then((result) => {
        if (cancelled) return;
        let list: Post[];
        if ("next_offset" in result) {
          list = result.items.map(fromGlobal);
          setHasNext(Boolean(result.next_offset));
          if (result.next_offset) setCursors((old) => (old.length > page ? old : [...old, result.next_offset]));
        } else {
          const start = ((page - 1) % 2) * PAGE_SIZE;
          list = result.items.slice(start, start + PAGE_SIZE).map(fromNaver);
          setHasNext(result.items.length > start + PAGE_SIZE || result.items.length >= NAVER_MORE_HINT);
        }
        setPosts(list);
        if (pendingOpen && list.length) openFrom(list, pendingOpen === "first" ? 0 : list.length - 1);
        else {
          setOpenIndex(null);
          setDetail(null);
        }
        setPendingOpen(null);
      })
      .catch(() => {
        if (cancelled) return;
        setError(L("종목토론을 불러오지 못했습니다.", "Could not load the discussion board."));
        setPendingOpen(null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, source, page]);

  const step = (direction: -1 | 1) => {
    if (openIndex == null || loading) return;
    const next = openIndex + direction;
    if (next >= 0 && next < posts.length) return openFrom(posts, next);
    if (direction === 1 && hasNext) {
      setPendingOpen("first");
      setPage((p) => p + 1);
    } else if (direction === -1 && page > 1) {
      setPendingOpen("last");
      setPage((p) => p - 1);
    }
  };

  const current = openIndex == null ? null : posts[openIndex];

  if (current) {
    const body = detail?.blocks ?? [];
    const atFirst = openIndex === 0 && page === 1;
    const atLast = openIndex === posts.length - 1 && !hasNext;
    return (
      <div className="rd">
        <button type="button" className="rd-back" onClick={() => setOpenIndex(null)}>
          ← {L("목록으로", "Back to list")}
        </button>
        <article className="rd-article">
          <h4>{detail?.title || current.title}</h4>
          <p className="rd-byline">
            <b>{detail?.author || current.author}</b>
            <time>{shortDateTime(detail?.written_at || current.date)}</time>
            <span>
              {L("조회", "Views")} {current.views.toLocaleString()}
            </span>
            <span className="is-up">
              {L("공감", "Likes")} {current.likes.toLocaleString()}
            </span>
            {current.dislikes > 0 && (
              <span className="is-down">
                {L("비공감", "Dislikes")} {current.dislikes.toLocaleString()}
              </span>
            )}
          </p>
          <div className="rd-body">
            {detailLoading && (
              <>
                <Skel h={14} />
                <Skel h={14} w="85%" />
              </>
            )}
            {inline && <p>{current.preview}</p>}
            {body.map((block, i) =>
              block.type === "image" && block.src ? <img key={i} src={block.src} alt="" loading="lazy" /> : <p key={i}>{block.text}</p>
            )}
            {!detailLoading && !inline && body.length === 0 && <p className="rd-note">{L("본문을 불러오지 못했습니다.", "Could not load the post.")}</p>}
          </div>
          {!inline && comments && comments.length > 0 && (
            <section className="rd-comments" aria-label={L("댓글", "Comments")}>
              <h5>
                {L("댓글", "Comments")} <b>{comments.length}</b>
              </h5>
              <ol>
                {comments.map((c) => (
                  <li key={c.id}>
                    <p>{c.text}</p>
                    <span>
                      <b>{c.author}</b>
                      <time>{shortDateTime(c.written_at)}</time>
                      {c.likes > 0 && <em className="is-up">+{c.likes}</em>}
                      {c.dislikes > 0 && <em className="is-down">−{c.dislikes}</em>}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </article>
        <nav className="rd-steps" aria-label={L("게시글 이동", "Move between posts")}>
          <button type="button" disabled={atFirst || loading} onClick={() => step(-1)}>
            ← {L("이전 글", "Previous")}
          </button>
          <span>{loading ? L("불러오는 중", "Loading") : `${page}${L("쪽", "p")} · ${(openIndex ?? 0) + 1}/${posts.length}`}</span>
          <button type="button" disabled={atLast || loading} onClick={() => step(1)}>
            {L("다음 글", "Next")} →
          </button>
        </nav>
      </div>
    );
  }

  return (
    <div className="rd">
      {loading ? (
        <ol className="rd-list" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="is-skel">
              <Skel h={15} />
              <Skel h={11} w="45%" />
            </li>
          ))}
        </ol>
      ) : error ? (
        <p className="rd-note">{error}</p>
      ) : posts.length === 0 ? (
        <p className="rd-note">{L("등록된 토론 글이 없습니다.", "No posts yet.")}</p>
      ) : (
        <ol className="rd-list">
          {posts.map((p, i) => (
            <li key={`${p.id}-${i}`}>
              <button type="button" onClick={() => openFrom(posts, i)}>
                <i className="rd-no">{String((page - 1) * PAGE_SIZE + i + 1).padStart(2, "0")}</i>
                <span className="rd-copy">
                  <strong>{p.title}</strong>
                  <small>
                    {p.author}
                    <time>{shortDateTime(p.date)}</time>
                    <em>
                      {L("조회", "views")} {p.views.toLocaleString()}
                    </em>
                    <em className="is-up">
                      {L("공감", "likes")} {p.likes.toLocaleString()}
                    </em>
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <nav className="rd-pager" aria-label={L("토론 페이지", "Board pages")}>
        <button type="button" disabled={page === 1 || loading} onClick={() => setPage((p) => p - 1)}>
          ← {L("이전", "Prev")}
        </button>
        <span>
          <b>{page}</b> {L("쪽", "page")}
        </span>
        <button type="button" disabled={!hasNext || loading} onClick={() => setPage((p) => p + 1)}>
          {L("다음", "Next")} →
        </button>
        {explorerHref && (
          <Link className="rd-more" to={explorerHref}>
            {L("토론방 전체", "Full board")} →
          </Link>
        )}
      </nav>
    </div>
  );
}
