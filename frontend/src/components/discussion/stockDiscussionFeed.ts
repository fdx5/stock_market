import { api } from "../../api/client";
import { dedupePosts, normalizeDomesticStream, normalizeGlobalDiscussion } from "./types";
import type { AssetKind, DiscussionPost, MarketKind, UsSourceMode } from "./types";

export interface DiscussionBatch {
  items: DiscussionPost[];
  nextOffset: string | null;
  sourceLabel: string;
  sourceUrl: string | null;
}

export async function fetchStockDiscussionBatch(
  code: string,
  market: MarketKind,
  kind: AssetKind,
  { limit, offset = null, fresh = false, source = "toss", signal }: {
    limit: number;
    offset?: string | null;
    fresh?: boolean;
    source?: UsSourceMode;
    signal?: AbortSignal;
  },
): Promise<DiscussionBatch> {
  if (market === "KR") {
    const res = await api.boardStream(code, limit, offset, fresh, signal);
    return {
      items: dedupePosts(res.items.map(normalizeDomesticStream)),
      nextOffset: res.next_offset,
      sourceLabel: res.source_label || "네이버페이 증권",
      sourceUrl: res.source_url || `https://m.stock.naver.com/domestic/stock/${code}/discussion`,
    };
  }

  if (source === "naver") {
    const type = kind === "ETF" ? "foreignEtf" : "foreignStock";
    const res = await api.globalDiscussion(code, limit, offset, type);
    return {
      items: dedupePosts(res.items.map(normalizeGlobalDiscussion)),
      nextOffset: res.next_offset,
      sourceLabel: res.source_label || "네이버페이 증권",
      sourceUrl: res.source_url || null,
    };
  }

  const load = kind === "ETF" ? api.tossEtfDiscussion : api.tossDiscussion;
  let items: DiscussionPost[] = [];
  let nextOffset = offset;
  let sourceLabel = "토스증권";
  let sourceUrl: string | null = null;
  for (let round = 0; round < 2 && items.length < limit; round++) {
    const res = await load(code, Math.min(30, limit - items.length), nextOffset);
    sourceLabel = res.source_label || sourceLabel;
    sourceUrl = res.source_url || sourceUrl;
    items = dedupePosts([...items, ...res.items.map(normalizeGlobalDiscussion)]);
    nextOffset = res.next_offset;
    if (!nextOffset || res.items.length === 0) break;
  }
  return { items, nextOffset, sourceLabel, sourceUrl };
}
