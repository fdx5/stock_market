import type { UnitsResponse, UnitType } from "./types";

/* What a complex's flats are, fetched when the walker enters a building: the server's /units
 * (the building register's 전유부 rows for that 동 and the trade records' 평형), or — until that is
 * deployed, or when it fails — the same 평형 list from the complex detail and 세대수 from the facts. */

const roomsFor = (a: number) => (a < 50 ? { rooms: 1, baths: 1 } : a < 78 ? { rooms: 2, baths: 2 } : a < 100 ? { rooms: 3, baths: 2 } : { rooms: 4, baths: 2 });
const typeLabel = (a: number) => `${a.toFixed(2)}㎡ (${Math.round(a / 3.3058 * 1.33)}평형)`;

export async function fetchUnits(complexId: string, dong: string, signal?: AbortSignal, pnu?: string | null): Promise<UnitsResponse> {
  const q = new URLSearchParams({ id: complexId });
  if (dong) q.set("dong", dong);
  if (pnu) q.set("pnu", pnu);
  try {
    const r = await fetch(`/api/realestate/units?${q}`, { signal });
    if (r.ok) {
      const body = await r.json() as UnitsResponse;
      if (body.types?.length) return body;
    }
  } catch (e) { if (signal?.aborted) throw e; }
  const [cx, facts] = await Promise.all([
    fetch(`/api/realestate/complex?${new URLSearchParams({ id: complexId, period: "1y" })}`, { signal }).then(r => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`/api/realestate/facts?${new URLSearchParams({ id: complexId })}`, { signal }).then(r => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const types: UnitType[] = [];
  for (const t of (cx?.types ?? []) as { key: number | string; area?: number; trades_total?: number; price_source?: string }[]) {
    const a = Number(t.area);
    if (!Number.isFinite(a) || a < 15 || a > 300) continue;
    types.push({ key: String(t.key), areaM2: a, trades: t.trades_total ?? 0, label: typeLabel(a), ...roomsFor(a), source: t.price_source === "sale" ? "국토교통부 실거래 전용면적" : "분양권 전매 신고 전용면적" });
  }
  types.sort((a, b) => a.areaM2 - b.areaM2);
  return {
    complexId, name: cx?.name ?? "", built: cx?.item?.built ?? null, households: facts?.households ?? null,
    types, dong: dong ? { name: dong, floors: null, areaRows: 0 } : null,
    sources: [types.length ? "국토교통부 아파트 매매 실거래가" : "", facts?.matched ? "공동주택관리정보(K-apt)" : ""].filter(Boolean),
  };
}

export { typeLabel, roomsFor };
