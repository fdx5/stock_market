/* The complex a building belongs to, for a building of another complex walked or driven to: its
 * parcel's PNU gives the 시군구 (and the 본번), the register's name the rest — the collected
 * complexes of that 시군구 asked by name, the one on the same 본번 first. */
export interface VisitedComplex { id: string; name: string; built?: number }

const norm = (s: string) => s.replace(/\(.*?\)|\s|아파트|APT/gi, "");

export async function complexOf(name: string, pnu: string | null, signal?: AbortSignal): Promise<VisitedComplex | null> {
  if (!pnu || !/^\d{19}$/.test(pnu)) return null;
  const want = norm(name), main = String(Number(pnu.slice(11, 15)));
  if (!want) return null;
  // (the name's first characters too: the register's "OO아파트" is the trades' "OO1차" or "OO맨션")
  for (const q of [want, want.slice(0, Math.max(2, Math.min(4, want.length - 1)))]) {
    const p = new URLSearchParams({ sido: pnu.slice(0, 2), sgg: pnu.slice(0, 5), q, period: "1y", limit: "50", sort: "name" });
    try {
      const r = await fetch(`/api/realestate/explore?${p}`, { signal });
      if (!r.ok) continue;
      const items = ((await r.json()).items ?? []) as { id: string; name: string; built?: number }[];
      const jibun = (id: string) => (id.split(":")[2] ?? "").split("-")[0];
      const pick = items.find(i => jibun(i.id) === main) ?? items.find(i => norm(i.name) === want) ?? (q === want ? items[0] : undefined);
      if (pick) return { id: pick.id, name: pick.name, built: pick.built };
    } catch (e) { if (signal?.aborted) throw e; }
  }
  return null;
}
