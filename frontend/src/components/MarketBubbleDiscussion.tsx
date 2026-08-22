import { useEffect, useState } from "react";
import { BoardDetail, BoardPost, GlobalDiscussionPost, StockBoardItem, api } from "../api/client";

type Market = "kospi" | "kosdaq" | "nasdaq";
type DiscussionItem = {
  id: string; title: string; preview: string; author: string; date: string;
  views: number; likes: number; global?: GlobalDiscussionPost;
};

function domesticPost(post: BoardPost): DiscussionItem {
  return { id: post.nid, title: post.title, preview: "", author: post.author, date: post.date, views: post.views, likes: post.likes };
}

function globalPost(post: GlobalDiscussionPost): DiscussionItem {
  return { id: post.id, title: post.title || post.text.slice(0, 55), preview: post.text, author: post.author, date: post.written_at.slice(0, 16).replace("T", " "), views: post.views, likes: post.likes, global: post };
}

export default function MarketBubbleDiscussion({ item, market, colors, onClose }: {
  item: StockBoardItem; market: Market; colors: [string, string]; onClose: () => void;
}) {
  const [posts, setPosts] = useState<DiscussionItem[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<BoardDetail | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [offsets, setOffsets] = useState<(string | null)[]>([null]);
  const [nextOffset, setNextOffset] = useState<string | null>(null);

  useEffect(() => {
    setPage(1); setSelected(null); setDetail(null); setOffsets([null]);
  }, [item.code, market]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); setSelected(null); setDetail(null);
    const domesticPage = Math.floor((page - 1) / 2) + 1;
    const domesticStart = ((page - 1) % 2) * 10;
    const request = market === "nasdaq"
      ? api.globalDiscussion(item.code, 10, offsets[page - 1] ?? null)
      : api.board(item.code, domesticPage, page === 1);
    request.then((result) => {
      if (cancelled) return;
      if ("next_offset" in result) {
        setPosts(result.items.map(globalPost));
        setNextOffset(result.next_offset);
        if (result.next_offset) setOffsets((old) => old.length > page ? old : [...old, result.next_offset]);
      } else {
        setPosts(result.items.slice(domesticStart, domesticStart + 10).map(domesticPost));
        setNextOffset(result.items.length > domesticStart + 10 || result.items.length >= 20 ? String(page + 1) : null);
      }
    }).catch(() => !cancelled && setError("토론 게시글을 불러오지 못했습니다."))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [item.code, market, page]);

  const openPost = (index: number) => {
    setSelected(index); setDetail(null);
    const post = posts[index];
    if (!post || market === "nasdaq") return;
    setDetailLoading(true);
    api.boardDetail(item.code, post.id).then(setDetail).catch(() => setError("게시글 상세 내용을 불러오지 못했습니다."))
      .finally(() => setDetailLoading(false));
  };

  const selectedPost = selected == null ? null : posts[selected];
  const movePost = (direction: -1 | 1) => {
    if (selected == null) return;
    const next = selected + direction;
    if (next >= 0 && next < posts.length) openPost(next);
  };

  return (
    <aside className="bubble-discussion" style={{ "--panel-light": colors[0], "--panel-dark": colors[1] } as React.CSSProperties} aria-label={`${item.name} 종목토론`}>
      <div className="bubble-discussion-edge" />
      <header className="bubble-discussion-head">
        <div><span>MARKET CONVERSATION</span><h2>{item.name}</h2><p>종목토론 · 10건씩 보기</p></div>
        <button type="button" onClick={onClose} aria-label="종목토론 닫기">×</button>
      </header>

      {selectedPost ? (
        <section className="bubble-discussion-detail">
          <button className="bubble-detail-back" type="button" onClick={() => { setSelected(null); setDetail(null); }}>‹ 목록으로</button>
          <div className="bubble-detail-meta"><span>{detail?.author || selectedPost.author}</span><time>{detail?.written_at?.slice(0, 16).replace("T", " ") || selectedPost.date}</time></div>
          <h3>{detail?.title || selectedPost.title}</h3>
          <div className="bubble-detail-body">
            {detailLoading && <div className="bubble-panel-loading"><i />상세 내용을 불러오는 중</div>}
            {market === "nasdaq" && <p>{selectedPost.preview}</p>}
            {detail?.blocks.map((block, index) => block.type === "image" && block.src
              ? <img key={index} src={block.src} alt="게시글 첨부 이미지" />
              : <p key={index}>{block.text}</p>)}
          </div>
          <nav className="bubble-detail-nav" aria-label="게시글 이동">
            <button type="button" disabled={selected === posts.length - 1} onClick={() => movePost(1)}><small>PREVIOUS</small><span>‹ 이전글 보기</span></button>
            <button type="button" disabled={selected === 0} onClick={() => movePost(-1)}><small>NEXT</small><span>다음글 보기 ›</span></button>
          </nav>
        </section>
      ) : (
        <section className="bubble-discussion-list">
          {loading && <div className="bubble-panel-loading"><i />토론 신호를 불러오는 중</div>}
          {error && <div className="bubble-panel-error">{error}</div>}
          {!loading && posts.map((post, index) => (
            <button type="button" key={post.id} onClick={() => openPost(index)}>
              <span className="bubble-post-number">{String((page - 1) * 10 + index + 1).padStart(2, "0")}</span>
              <span className="bubble-post-copy"><strong>{post.title}</strong><small>{post.author} · {post.date}</small></span>
              <span className="bubble-post-stats">조회 {post.views.toLocaleString()}<br />공감 {post.likes.toLocaleString()}</span>
              <i>›</i>
            </button>
          ))}
          {!loading && posts.length === 0 && <div className="bubble-panel-empty">등록된 토론 게시글이 없습니다.</div>}
          <nav className="bubble-list-pagination" aria-label="게시글 페이지">
            <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>‹ 이전</button>
            <span><b>{page}</b> PAGE</span>
            <button type="button" disabled={!nextOffset} onClick={() => setPage((p) => p + 1)}>다음 ›</button>
          </nav>
        </section>
      )}
    </aside>
  );
}
