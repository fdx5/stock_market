/* The complex a building belongs to, for a building of another complex walked or driven to: its
 * parcel's PNU gives the 시군구 (and the 본번), the register's name the rest — the collected
 * complexes of that 시군구 asked by name, the one on the same 본번 first. */
export interface VisitedComplex { id: string; name: string; built?: number }
import {apartmentName} from './apartmentIdentity';

/** A location label is not a trade/register complex ID, even when its name matches exactly. */
export async function walkComplex(start: { id: string; name: string; built: number | null }, name: string, pnu: string | null, signal?: AbortSignal,town=''): Promise<VisitedComplex | null> {
  const collected = /^\d{5}:[^:]+:[^:]+:.+/.test(start.id) && !start.id.includes(":?:");
  const own = collected && (!name||norm(name)===norm(start.name))&&(!town||start.id.split(':')[1]===town)&&(!pnu||Number(start.id.split(':')[2]?.split('-')[0])===Number(pnu.slice(11,15)));
  return own ? { id: start.id, name: apartmentName(start.id.split(':').slice(3).join(':')||start.name,town), built: start.built ?? undefined } : complexOf(apartmentName(name,town), pnu, signal,town);
}

const norm = (s: string) => apartmentName(s).toUpperCase().replace(/\s|[()]/g, "");

export async function complexOf(name: string, pnu: string | null, signal?: AbortSignal,town=''): Promise<VisitedComplex | null> {
  if (!pnu || !/^\d{19}$/.test(pnu)) return null;
  const want = norm(name), main = String(Number(pnu.slice(11, 15)));
  // (the name's first characters too: the register's "OO아파트" is the trades' "OO1차" or "OO맨션")
  for (const q of [...new Set([want, want.slice(0, Math.max(2, Math.min(4, want.length - 1)))])]) {
    const p = new URLSearchParams({ sido: pnu.slice(0, 2), sgg: pnu.slice(0, 5), q, period: "1y", limit: "50", sort: "name" });
    if(town)p.set('dong',town);
    try {
      const r = await fetch(`/api/realestate/explore?${p}`, { signal });
      if (!r.ok) continue;
      const items = ((await r.json()).items ?? []) as { id: string; name: string; built?: number }[];
      const jibun = (id: string) => (id.split(":")[2] ?? "").split("-")[0];
      const local=items.filter(i=>!town||i.id.split(':')[1]===town);
      const exact=local.filter(i=>want&&norm(i.name)===want),parcel=local.filter(i=>jibun(i.id)===main&&(!want||norm(i.name).includes(want)||want.includes(norm(i.name))));
      const pick=exact.find(i=>jibun(i.id)===main)??(exact.length===1?exact[0]:undefined)??(parcel.length===1?parcel[0]:undefined);
      if (pick) return { id: pick.id, name: apartmentName(pick.name,town), built: pick.built };
    } catch (e) { if (signal?.aborted) throw e; }
  }
  return null;
}
