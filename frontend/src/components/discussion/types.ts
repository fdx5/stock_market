import { BoardComment, BoardDetail, BoardStreamPost, GlobalDiscussionPost } from "../../api/client";
import { formatDiscussionTime } from "../../discussionTime";

export type AssetKind = "STOCK" | "ETF";
export type MarketKind = "KR" | "US";
export type ViewMode = "split" | "stream" | "compact";
export type SortMode = "latest" | "views" | "likes";
export type FilterMode = "all" | "hot" | "holder" | "images" | "unread";
export type UsSourceMode = "toss" | "naver";
export type FontScale = "sm" | "md" | "lg";

export interface AssetTarget {
  code: string;
  name: string;
  market: MarketKind;
  kind: AssetKind;
}

export interface DiscussionPost {
  id: string;
  title: string;
  preview: string;
  author: string;
  rawDate: string;
  dateLabel: string;
  relativeLabel: string;
  views: number;
  likes: number;
  dislikes: number;
  imageCount: number;
  thumbnail: string | null;
  holderVerified: boolean;
  isReply: boolean;
  hasFullBodyInline: boolean;
}

export interface AssetQuoteSnapshot {
  close: number;
  change: number;
  change_pct: number;
  marcap?: number | null;
  volume?: number | null;
  turnover?: number | null;
  session?: "pre" | "regular" | "post";
  benchmark?: string | null;
  category?: string | null;
  week52_high?: number | null;
  week52_low?: number | null;
  returns_d20?: number | null;
  returns_ytd?: number | null;
  sparkline?: number[];
}

export interface CachedDetailEntry {
  status: "loading" | "ready" | "error";
  detail?: BoardDetail | null;
  comments?: BoardComment[];
  error?: string;
}

export const QUICK_ASSET_PRESETS: Array<AssetTarget & { group: "KR_STOCK" | "KR_ETF" | "US_STOCK" | "US_ETF" }> = [
  { code: "005930", name: "삼성전자", market: "KR", kind: "STOCK", group: "KR_STOCK" },
  { code: "000660", name: "SK하이닉스", market: "KR", kind: "STOCK", group: "KR_STOCK" },
  { code: "005380", name: "현대차", market: "KR", kind: "STOCK", group: "KR_STOCK" },
  { code: "035420", name: "NAVER", market: "KR", kind: "STOCK", group: "KR_STOCK" },
  { code: "069500", name: "KODEX 200", market: "KR", kind: "ETF", group: "KR_ETF" },
  { code: "360750", name: "TIGER 미국S&P500", market: "KR", kind: "ETF", group: "KR_ETF" },
  { code: "122630", name: "KODEX 레버리지", market: "KR", kind: "ETF", group: "KR_ETF" },
  { code: "NVDA", name: "NVIDIA", market: "US", kind: "STOCK", group: "US_STOCK" },
  { code: "TSLA", name: "Tesla", market: "US", kind: "STOCK", group: "US_STOCK" },
  { code: "AAPL", name: "Apple", market: "US", kind: "STOCK", group: "US_STOCK" },
  { code: "PLTR", name: "Palantir", market: "US", kind: "STOCK", group: "US_STOCK" },
  { code: "QQQ", name: "QQQ", market: "US", kind: "ETF", group: "US_ETF" },
  { code: "SOXL", name: "SOXL", market: "US", kind: "ETF", group: "US_ETF" },
  { code: "SCHD", name: "SCHD", market: "US", kind: "ETF", group: "US_ETF" },
];

export function parseDiscussionDate(raw: string): Date | null {
  if (!raw) return null;
  const value = raw.trim();
  const match = value.match(
    /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?(Z|[+-]\d{2}:?\d{2})?$/i,
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction, offset] = match;
  const stamp = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${(hour || "00").padStart(2, "0")}:${(minute || "00").padStart(2, "0")}:${(second || "00").padStart(2, "0")}.${(fraction || "0").slice(0, 3).padEnd(3, "0")}${offset || "+09:00"}`;
  const parsed = new Date(stamp);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function formatRelativeTime(raw: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (/^(방금|\d+\s*(분|시간|일)\s*전)$/.test(trimmed)) return trimmed;
  const date = parseDiscussionDate(trimmed);
  if (!date) return formatDiscussionTime(raw, false);
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 0) return formatDiscussionTime(raw, false);
  if (diffSec < 60) return "방금 전";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`;
  if (diffSec < 86400 * 5) return `${Math.floor(diffSec / 86400)}일 전`;
  return formatDiscussionTime(raw, false);
}

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  middot: "·",
  ndash: "–",
  mdash: "—",
};

export function decodeHtmlEntities(input: string): string {
  if (!input || !input.includes("&")) return input;
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith("#")) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return HTML_ENTITY_MAP[lower] ?? match;
  });
}

export function normalizeDomesticStream(post: BoardStreamPost): DiscussionPost {
  const cleanPreview = decodeHtmlEntities(post.preview || "").replace(/\s+/g, " ").trim();
  const cleanTitle = decodeHtmlEntities(post.title || "").trim();
  return {
    id: post.nid,
    title: cleanTitle || cleanPreview.slice(0, 72) || "(제목 없음)",
    preview: cleanPreview,
    author: post.author || "익명",
    rawDate: post.date,
    dateLabel: formatDiscussionTime(post.date, true),
    relativeLabel: formatRelativeTime(post.date),
    views: post.views || 0,
    likes: post.likes || 0,
    dislikes: post.dislikes || 0,
    imageCount: post.image_count || 0,
    thumbnail: post.thumbnail || null,
    holderVerified: Boolean(post.holder_verified),
    isReply: Boolean(post.is_reply),
    hasFullBodyInline: false,
  };
}

export function normalizeGlobalDiscussion(post: GlobalDiscussionPost): DiscussionPost {
  const rawText = decodeHtmlEntities(post.text || "").trim();
  const singleLine = rawText.replace(/\s+/g, " ").trim();
  const decodedTitle = decodeHtmlEntities(post.title || "").trim();
  const title = decodedTitle || (singleLine.length > 76 ? `${singleLine.slice(0, 76)}…` : singleLine) || "(내용 없음)";
  return {
    id: post.id,
    title,
    preview: rawText,
    author: post.author || "익명",
    rawDate: post.written_at,
    dateLabel: formatDiscussionTime(post.written_at, true),
    relativeLabel: formatRelativeTime(post.written_at),
    views: post.views || 0,
    likes: post.likes || 0,
    dislikes: post.dislikes || 0,
    imageCount: 0,
    thumbnail: null,
    holderVerified: false,
    isReply: Boolean(post.is_reply),
    hasFullBodyInline: true,
  };
}

export function dedupePosts(items: DiscussionPost[]): DiscussionPost[] {
  const map = new Map<string, DiscussionPost>();
  for (const item of items) {
    if (!item.id) continue;
    if (!map.has(item.id)) map.set(item.id, item);
  }
  return Array.from(map.values());
}

export function assetBadgeLabel(market: MarketKind, kind: AssetKind): string {
  if (market === "KR" && kind === "ETF") return "국내 ETF";
  if (market === "US" && kind === "ETF") return "해외 ETF";
  if (market === "US") return "해외 주식";
  return "국내 주식";
}

export function discussionHref(asset: AssetTarget, nid?: string | null): string {
  const qs = new URLSearchParams({
    code: asset.code,
    name: asset.name,
    market: asset.market,
    asset: asset.kind,
  });
  if (nid) qs.set("nid", nid);
  return `/discussion-explorer?${qs.toString()}`;
}

export function isHotPost(post: DiscussionPost): boolean {
  return post.views >= 35 || post.likes >= 3;
}

const KEYWORD_STOPWORDS = new Set([
  "진짜", "정말", "그냥", "오늘", "내일", "지금", "이제", "너무", "근데", "그래서", "그런데",
  "이거", "저거", "여기", "거기", "사람", "생각", "주식", "종목", "주가", "시장", "계속",
  "다시", "정도", "때문", "같음", "같은", "하는", "하고", "해서", "하면", "있는", "없는",
  "되는", "안되", "이번", "다음", "올해", "내년", "우리", "한국", "미국", "시간", "가격",
  "다들", "모두", "하나", "조금", "많이", "빨리", "얼마", "어제", "주말", "장중", "장마감",
  "그리고", "하지만", "그래도", "혹시", "일단", "원래", "완전", "도대체", "무슨", "어떻게",
  "없다", "있다", "가지고", "같다", "한다", "된다", "했다", "보면", "와서", "가서", "보고",
  "있어", "없어", "아니", "맞다", "좋다", "역시", "어차피", "무조건", "그렇게", "이렇게",
  "저렇게", "때문에", "그래", "말고", "까지", "부터", "에서", "으로", "이나", "보다", "처럼",
  "https", "http", "www", "com", "naver", "stock", "the", "and", "for", "that", "this",
  "with", "from", "have", "will", "just", "like", "what", "when", "your", "they", "been",
]);

export interface KeywordTag {
  word: string;
  count: number;
}

/** Extracts top recurring meaningful discussion keywords from loaded posts so readers
 *  can spot live board themes at a glance and filter by topic with one click. */
export function extractHotKeywords(posts: DiscussionPost[], assetName: string, assetCode: string, limit = 8): KeywordTag[] {
  const counts = new Map<string, number>();
  const skipName = assetName.toLowerCase().trim();
  const skipCode = assetCode.toLowerCase().trim();

  for (const post of posts) {
    const text = `${post.title} ${post.preview.slice(0, 180)}`;
    const tokens = text.match(/[가-힣]{2,8}|[A-Za-z][A-Za-z0-9]{1,8}/g);
    if (!tokens) continue;
    const seenInPost = new Set<string>();
    for (const raw of tokens) {
      const normalized = /^[A-Za-z]/.test(raw) ? raw.toUpperCase() : raw;
      const lower = normalized.toLowerCase();
      if (lower.length < 2) continue;
      if (lower === skipName || lower === skipCode) continue;
      if (KEYWORD_STOPWORDS.has(lower)) continue;
      if (seenInPost.has(normalized)) continue;
      seenInPost.add(normalized);
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}
