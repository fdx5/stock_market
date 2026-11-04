import type { MarketMapItem } from "./api/client";

/** Full replies own membership, but never overwrite a newer per-stock trade. */
export function mergeMapSnapshot(previous: MarketMapItem[], incoming: MarketMapItem[], full: boolean): MarketMapItem[] {
  const old = new Map(previous.map(item => [item.code, item]));
  const result = full ? new Map<string, MarketMapItem>() : new Map(old);
  for (const item of incoming) {
    const held = old.get(item.code);
    const heldTime = held?.quote_time ?? held?.quote_received_at ?? 0;
    const nextTime = item.quote_time ?? item.quote_received_at ?? 0;
    result.set(item.code, held && heldTime > nextTime ? held : item);
  }
  return [...result.values()];
}
