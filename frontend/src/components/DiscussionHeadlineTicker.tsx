import { useEffect, useState } from "react";
import { api } from "../api/client";
import { navigate } from "../router";

type HeadlinePost = { id: string; title: string };

export default function DiscussionHeadlineTicker({ code, market = "KR", limit = 10, asset = "STOCK" }: { code: string; market?: "KR" | "US"; limit?: number; asset?: "STOCK" | "ETF" }) {
  const [posts, setPosts] = useState<HeadlinePost[]>([]);

  useEffect(() => {
    let cancelled = false;
    const request = market === "US"
      ? api.globalDiscussion(code, limit).then((result) => result.items.slice(0, limit).map((post) => ({ id: post.id, title: post.title || post.text })))
      : Promise.all([api.board(code, 1, true), ...(limit > 20 ? [api.board(code, 2, true)] : [])])
          .then((pages) => pages.flatMap((result) => result.items).slice(0, limit).map((post) => ({ id: post.nid, title: post.title })));
    request
      .then((items) => {
        if (!cancelled) setPosts(items);
      })
      .catch(() => {
        if (!cancelled) setPosts([]);
      });
    return () => { cancelled = true; };
  }, [code, market, limit]);

  if (posts.length === 0) return null;

  const renderSet = (copy: number) => posts.map((post, index) => (
    <button type="button" className="discussion-headline-item" key={`${copy}-${post.id}`} onClick={() => navigate(`/discussion-explorer?code=${encodeURIComponent(code)}&market=${market}&asset=${asset}`)}>
      <i>{String(index + 1).padStart(2, "0")}</i>
      {post.title}
    </button>
  ));

  return (
    <div className="discussion-headline-ticker" aria-label={`최근 종목토론 제목 ${limit}건`}>
      <span className="discussion-headline-label"><i /> LIVE TALK</span>
      <div className="discussion-headline-window">
        <div className="discussion-headline-track">
          <span className="discussion-headline-set">{renderSet(0)}</span>
          <span className="discussion-headline-set" aria-hidden="true">{renderSet(1)}</span>
        </div>
      </div>
    </div>
  );
}
