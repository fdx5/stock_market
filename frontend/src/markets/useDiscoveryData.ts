import { useEffect, useState } from "react";
import { api, StockBoard } from "../api/client";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { DiscoveryMarket, MARKETS } from "./discoveryModel";

type Snapshot = { boards: Partial<Record<DiscoveryMarket, StockBoard>>; errors: Partial<Record<DiscoveryMarket, string>>; loading: boolean };
let snapshot: Snapshot = { boards: {}, errors: {}, loading: true };
let pending: Promise<void> | null = null;
let lastLoaded = 0;
let stop: (() => void) | null = null;
const listeners = new Set<(next: Snapshot) => void>();
const publish = (next: Snapshot) => { snapshot = next; listeners.forEach(listener => listener(next)); };

function refresh(): Promise<void> {
  if (pending) return pending;
  publish({ ...snapshot, loading: true });
  pending = Promise.allSettled(MARKETS.map(async market => {
    try {
      const board = await api.stockBoard(market);
      if (board.market !== market || !Array.isArray(board.items) || !board.items.length) throw new Error("empty snapshot");
      const errors = { ...snapshot.errors }; delete errors[market];
      publish({ ...snapshot, boards: { ...snapshot.boards, [market]: board }, errors });
    } catch {
      publish({ ...snapshot, errors: { ...snapshot.errors, [market]: "집계를 불러오지 못했습니다." } });
    }
  })).then(() => {
    lastLoaded = Date.now();
    publish({ ...snapshot, loading: false });
  }).finally(() => { pending = null; });
  return pending;
}

export function useDiscoveryData() {
  const [value, setValue] = useState(snapshot);
  useEffect(() => {
    listeners.add(setValue); setValue(snapshot);
    if (listeners.size === 1) {
      if (Date.now() - lastLoaded >= 30_000) void refresh();
      stop = startVisibilityAwareInterval(() => void refresh(), 60_000);
    }
    return () => { listeners.delete(setValue); if (!listeners.size) { stop?.(); stop = null; } };
  }, []);
  return { ...value, refresh };
}
