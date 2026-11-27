import { useState } from "react";
import { formatDiscussionTime } from "../../discussionTime";
import {
  AssetTarget,
  CachedDetailEntry,
  DiscussionPost,
  FontScale,
  decodeHtmlEntities,
  discussionHref,
} from "./types";

function cleanParagraph(raw: string): string {
  return decodeHtmlEntities(raw).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export default function ReaderPane({
  post,
  asset,
  entry,
  sourceUrl,
  currentIndex,
  totalCount,
  fontScale,
  onChangeFontScale,
  onPrev,
  onNext,
  onClose,
  mode,
}: {
  post: DiscussionPost | null;
  asset: AssetTarget;
  entry?: CachedDetailEntry;
  sourceUrl: string | null;
  currentIndex: number;
  totalCount: number;
  fontScale: FontScale;
  onChangeFontScale: (next: FontScale) => void;
  onPrev: () => void;
  onNext: () => void;
  onClose?: () => void;
  mode: "split" | "sheet" | "inline";
}) {
  const [copied, setCopied] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  if (!post) {
    return (
      <div className="dr-reader-empty">
        <span className="dr-reader-empty-icon" aria-hidden="true">▤</span>
        <strong>읽을 게시글을 선택하세요</strong>
        <p>왼쪽 목록에서 게시글을 클릭하거나 키보드 ↑ / ↓ (J / K)로 빠르게 넘겨볼 수 있습니다.</p>
      </div>
    );
  }

  const isKr = asset.market === "KR";
  const detail = entry?.detail;
  const comments = entry?.comments ?? [];
  const loading = isKr && (!entry || entry.status === "loading");
  const error = isKr && entry?.status === "error" ? entry.error : "";

  const handleCopyLink = () => {
    const shareUrl = `${window.location.origin}${discussionHref(asset, post.id)}`;
    navigator.clipboard?.writeText(shareUrl).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  };

  const hasDetailBlocks = Boolean(detail && detail.blocks && detail.blocks.length > 0);
  const writtenStamp = detail?.written_at ? formatDiscussionTime(detail.written_at, true) : post.dateLabel;

  return (
    <article className={`dr-reader dr-reader--${mode} dr-font-${fontScale}`} aria-label="게시글 상세 내용">
      {mode !== "inline" && (
        <header className="dr-reader-bar">
          <div className="dr-reader-nav">
            <button
              type="button"
              onClick={onPrev}
              disabled={currentIndex <= 0}
              aria-label="이전 게시글"
              title="이전 게시글 (↑ 또는 K)"
            >
              ‹ 이전
            </button>
            <span className="dr-reader-pos">
              {currentIndex >= 0 ? `${currentIndex + 1} / ${totalCount}` : `— / ${totalCount}`}
            </span>
            <button
              type="button"
              onClick={onNext}
              disabled={currentIndex < 0 || currentIndex >= totalCount - 1}
              aria-label="다음 게시글"
              title="다음 게시글 (↓ 또는 J)"
            >
              다음 ›
            </button>
          </div>

          <div className="dr-reader-tools">
            <div className="dr-font-switch" role="group" aria-label="글자 크기 조절">
              {(["sm", "md", "lg"] as const).map((scale, idx) => (
                <button
                  key={scale}
                  type="button"
                  className={fontScale === scale ? "is-active" : ""}
                  onClick={() => onChangeFontScale(scale)}
                  aria-pressed={fontScale === scale}
                  title={scale === "sm" ? "글자 작게" : scale === "md" ? "글자 보통" : "글자 크게"}
                >
                  {idx === 0 ? "가-" : idx === 1 ? "가" : "가+"}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="dr-tool-btn"
              onClick={handleCopyLink}
              title="이 게시글 링크 복사"
            >
              {copied ? "복사됨 ✓" : "링크"}
            </button>
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="dr-tool-btn"
                title="원문 게시판 열기"
              >
                원문 ↗
              </a>
            )}
            {onClose && (
              <button type="button" className="dr-tool-close" onClick={onClose} aria-label="닫기">
                ×
              </button>
            )}
          </div>
        </header>
      )}

      <div className="dr-reader-scroll">
        {mode !== "inline" && (
          <div className="dr-reader-head">
            <div className="dr-reader-badges">
              {post.holderVerified && <span className="dr-tag is-holder">주주인증</span>}
              {post.imageCount > 0 && <span className="dr-tag is-img">사진 {post.imageCount}</span>}
              {post.isReply && <span className="dr-tag is-reply">답글</span>}
              <time title="한국시간 (KST)">{writtenStamp} KST</time>
            </div>
            <h2>{detail?.title || post.title}</h2>
            <div className="dr-reader-meta">
              <strong>{detail?.author || post.author}</strong>
              <span>조회 {post.views.toLocaleString()}</span>
              <span className="is-like">공감 {post.likes.toLocaleString()}</span>
              {post.dislikes > 0 && <span className="is-dislike">비공감 {post.dislikes.toLocaleString()}</span>}
            </div>
          </div>
        )}

        <div className="dr-reader-body">
          {/* Show immediate text preview while full KR detail blocks load, or as main body for US posts */}
          {!hasDetailBlocks && post.preview && (
            <p className="dr-reader-paragraph">{cleanParagraph(post.preview)}</p>
          )}

          {loading && (
            <div className="dr-reader-loading">
              <i className="dr-spinner" aria-hidden="true" />
              <span>본문 상세 및 댓글을 불러오는 중…</span>
            </div>
          )}

          {error && (
            <div className="dr-reader-error" role="alert">
              {error}
            </div>
          )}

          {hasDetailBlocks &&
            detail!.blocks.map((block, index) => {
              if (block.type === "image" && block.src) {
                return (
                  <figure key={`${post.id}-img-${index}`} className="dr-reader-figure">
                    <img
                      src={block.src}
                      alt="게시글 첨부 이미지"
                      loading="lazy"
                      decoding="async"
                      onClick={() => setLightboxSrc(block.src!)}
                    />
                  </figure>
                );
              }
              const cleaned = cleanParagraph(block.text || "");
              if (!cleaned) return null;
              return (
                <p key={`${post.id}-txt-${index}`} className="dr-reader-paragraph">
                  {cleaned}
                </p>
              );
            })}

          {!loading && !hasDetailBlocks && !post.preview && !error && (
            <p className="dr-reader-muted">표시할 본문 텍스트가 없습니다.</p>
          )}
        </div>

        {isKr && !loading && (
          <section className="dr-comments" aria-label="댓글 목록">
            <div className="dr-comments-head">
              <h3>
                댓글 <b>{comments.length}</b>
              </h3>
            </div>
            {comments.length === 0 ? (
              <p className="dr-comments-empty">아직 작성된 댓글이 없습니다.</p>
            ) : (
              <div className="dr-comments-list">
                {comments.map((comment) => (
                  <div key={comment.id} className="dr-comment-item">
                    <div className="dr-comment-meta">
                      <strong>{comment.author || "익명"}</strong>
                      <time title="한국시간 (KST)">{formatDiscussionTime(comment.written_at, true)}</time>
                    </div>
                    <p>{comment.text}</p>
                    <div className="dr-comment-votes">
                      <span>공감 {comment.likes}</span>
                      {comment.dislikes > 0 && <span>비공감 {comment.dislikes}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {lightboxSrc && (
        <div className="dr-lightbox" role="dialog" aria-modal="true" aria-label="첨부 이미지 크게 보기" onClick={() => setLightboxSrc(null)}>
          <button type="button" className="dr-lightbox-close" onClick={() => setLightboxSrc(null)} aria-label="닫기">
            ×
          </button>
          <img src={lightboxSrc} alt="첨부 이미지 원본" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </article>
  );
}
