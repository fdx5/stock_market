import {
  FilterMode,
  KeywordTag,
  MarketKind,
  SortMode,
  UsSourceMode,
  ViewMode,
} from "./types";

export default function DiscussionPulseBar({
  market,
  totalLoaded,
  visibleCount,
  unreadCount,
  holderCount,
  imageCount,
  likeRatio,
  newArrivals,
  keywords,
  activeKeyword,
  onToggleKeyword,
  viewMode,
  onChangeViewMode,
  filterMode,
  onChangeFilterMode,
  sortMode,
  onChangeSortMode,
  query,
  onChangeQuery,
  usSource,
  onChangeUsSource,
  isDesktop,
  onClearNewArrivals,
}: {
  market: MarketKind;
  totalLoaded: number;
  visibleCount: number;
  unreadCount: number;
  holderCount: number;
  imageCount: number;
  likeRatio: number | null;
  newArrivals: number;
  keywords: KeywordTag[];
  activeKeyword: string;
  onToggleKeyword: (word: string) => void;
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  filterMode: FilterMode;
  onChangeFilterMode: (mode: FilterMode) => void;
  sortMode: SortMode;
  onChangeSortMode: (mode: SortMode) => void;
  query: string;
  onChangeQuery: (value: string) => void;
  usSource: UsSourceMode;
  onChangeUsSource: (src: UsSourceMode) => void;
  isDesktop: boolean;
  onClearNewArrivals: () => void;
}) {
  return (
    <section className="dr-controls-shell" aria-label="토론 필터 및 보기 설정">
      {/* Pulse & Hot Keywords Row */}
      <div className="dr-pulse-row">
        <div className="dr-pulse-stats">
          <span className="dr-pulse-pill is-live">
            <i aria-hidden="true" />
            <strong>{visibleCount}</strong>
            <em>/ {totalLoaded}건</em>
          </span>
          {newArrivals > 0 && (
            <button type="button" className="dr-pulse-pill is-new" onClick={onClearNewArrivals}>
              +{newArrivals} 새 글 도착
            </button>
          )}
          {likeRatio !== null && (
            <span className="dr-pulse-sentiment" title="현재 로드된 게시글의 공감 대 비공감 비율">
              <span>공감 우세</span>
              <span className="dr-sentiment-track" aria-hidden="true">
                <i style={{ width: `${likeRatio}%` }} />
              </span>
              <b>{likeRatio}%</b>
            </span>
          )}
        </div>

        {keywords.length > 0 && (
          <div className="dr-keywords" aria-label="실시간 토론 핫 키워드">
            <span className="dr-keywords-label">핫 키워드</span>
            <div className="dr-keywords-list">
              {keywords.map((tag) => {
                const isOn = activeKeyword === tag.word;
                return (
                  <button
                    key={tag.word}
                    type="button"
                    className={`dr-keyword-chip ${isOn ? "is-active" : ""}`}
                    onClick={() => onToggleKeyword(tag.word)}
                    aria-pressed={isOn}
                  >
                    #{tag.word}
                    <small>{tag.count}</small>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Main Toolbar: View Modes + Filters + In-board Search + Sort */}
      <div className="dr-toolbar">
        <div className="dr-view-switcher" role="group" aria-label="읽기 레이아웃 선택">
          {isDesktop && (
            <button
              type="button"
              className={viewMode === "split" ? "is-active" : ""}
              onClick={() => onChangeViewMode("split")}
              aria-pressed={viewMode === "split"}
              title="목록과 본문을 한 화면에 나란히 표시"
            >
              분할 리딩
            </button>
          )}
          <button
            type="button"
            className={viewMode === "stream" ? "is-active" : ""}
            onClick={() => onChangeViewMode("stream")}
            aria-pressed={viewMode === "stream"}
            title="여러 게시글의 본문을 펼쳐서 한 번에 연속으로 읽기"
          >
            연속 펼쳐보기
          </button>
          <button
            type="button"
            className={viewMode === "compact" ? "is-active" : ""}
            onClick={() => onChangeViewMode("compact")}
            aria-pressed={viewMode === "compact"}
            title="최대한 많은 제목을 한 화면에 밀도 높게 스캔"
          >
            초고밀도 목록
          </button>
        </div>

        <div className="dr-filter-group" role="group" aria-label="게시글 필터">
          <button
            type="button"
            className={filterMode === "all" ? "is-active" : ""}
            onClick={() => onChangeFilterMode("all")}
          >
            전체
          </button>
          <button
            type="button"
            className={filterMode === "hot" ? "is-active" : ""}
            onClick={() => onChangeFilterMode("hot")}
          >
            인기글
          </button>
          {market === "KR" && holderCount > 0 && (
            <button
              type="button"
              className={filterMode === "holder" ? "is-active" : ""}
              onClick={() => onChangeFilterMode("holder")}
            >
              주주인증 <em>{holderCount}</em>
            </button>
          )}
          {market === "KR" && imageCount > 0 && (
            <button
              type="button"
              className={filterMode === "images" ? "is-active" : ""}
              onClick={() => onChangeFilterMode("images")}
            >
              이미지 <em>{imageCount}</em>
            </button>
          )}
          {unreadCount < totalLoaded && (
            <button
              type="button"
              className={filterMode === "unread" ? "is-active" : ""}
              onClick={() => onChangeFilterMode("unread")}
            >
              안 읽은 글 <em>{unreadCount}</em>
            </button>
          )}
        </div>

        <div className="dr-toolbar-right">
          {market === "US" && (
            <div className="dr-source-switch" role="group" aria-label="해외 토론 출처 선택">
              <button
                type="button"
                className={usSource === "toss" ? "is-active" : ""}
                onClick={() => onChangeUsSource("toss")}
              >
                토스
              </button>
              <button
                type="button"
                className={usSource === "naver" ? "is-active" : ""}
                onClick={() => onChangeUsSource("naver")}
              >
                네이버
              </button>
            </div>
          )}

          <label className="dr-inline-filter">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={query}
              onChange={(e) => onChangeQuery(e.target.value)}
              placeholder="현재 글 내 검색"
              aria-label="로드된 게시글 내 키워드 필터"
            />
            {query && (
              <button type="button" onClick={() => onChangeQuery("")} aria-label="필터 초기화">
                ×
              </button>
            )}
          </label>

          <div className="dr-sort-group" role="group" aria-label="정렬 기준">
            {([
              ["latest", "최신순"],
              ["views", "조회순"],
              ["likes", "공감순"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={sortMode === key ? "is-active" : ""}
                onClick={() => onChangeSortMode(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
