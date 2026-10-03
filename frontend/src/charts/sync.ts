export type DateRange = { from: string; to: string };
export interface SyncChart {
  timeScale(): {
    getVisibleRange(): DateRange | null;
    setVisibleRange(range: DateRange): void;
    subscribeVisibleTimeRangeChange(fn: (range: DateRange | null) => void): void;
    unsubscribeVisibleTimeRangeChange(fn: (range: DateRange | null) => void): void;
  };
}
export function createController(): SyncChart {
  let range: DateRange | null = null;
  const listeners = new Set<(range: DateRange | null) => void>();
  const scale = {
    getVisibleRange: () => range,
    setVisibleRange: (next: DateRange) => {
      if (range?.from === next.from && range?.to === next.to) return;
      range = next; listeners.forEach(fn => fn(next));
    },
    subscribeVisibleTimeRangeChange: (fn: (range: DateRange | null) => void) => { listeners.add(fn); },
    unsubscribeVisibleTimeRangeChange: (fn: (range: DateRange | null) => void) => { listeners.delete(fn); },
  };
  return { timeScale: () => scale };
}
