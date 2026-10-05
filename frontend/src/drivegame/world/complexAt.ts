/* The apartment complex a delivery goes to, as the site knows it (its id: details, real prices),
 * from where it stands: the 연속지적도 parcel under it (VWorld, JSONP — it sends no CORS headers),
 * matched to a complex by the server on its 지번 (/api/realestate/nearby, the 3D view's own
 * 주변 단지 lookup). null when the parcel is no registered complex's. */

export interface ComplexLink { id: string; name: string; built: number | null; towers: number; floors: number | null }

let seq = 0;
function parcelAt(lon: number, lat: number, key: string, domain: string): Promise<{ pnu: string; addr: string } | null> {
  return new Promise(resolve => {
    const name = `__dgLot${seq++}`, w = window as unknown as Record<string, unknown>, s = document.createElement("script");
    const done = (v: { pnu: string; addr: string } | null) => { window.clearTimeout(timer); w[name] = () => {}; window.setTimeout(() => { delete w[name]; }, 60000); s.remove(); resolve(v); };
    const timer = window.setTimeout(() => done(null), 8000);
    w[name] = (body: { response?: { status?: string; result?: { featureCollection?: { features?: { properties?: Record<string, string> }[] } } } }) => {
      const p = body?.response?.status === "OK" ? body.response.result?.featureCollection?.features?.[0]?.properties : null;
      done(p?.pnu && p.addr ? { pnu: p.pnu, addr: p.addr } : null);
    };
    const q = new URLSearchParams({ service: "data", request: "GetFeature", data: "LP_PA_CBND_BUBUN", geomFilter: `POINT(${lon.toFixed(7)} ${lat.toFixed(7)})`, geometry: "false", attribute: "true", size: "1", crs: "EPSG:4326", key, domain, format: "json", callback: name });
    // (a Referer other than the key's domain is refused by some VWorld nodes)
    s.referrerPolicy = "no-referrer";
    s.onerror = () => done(null);
    s.src = `https://api.vworld.kr/req/data?${q}`;
    document.head.appendChild(s);
  });
}

export async function complexAt(lon: number, lat: number, name: string, floors: number, o: { key: string; domain: string; apiBase: string }): Promise<ComplexLink | null> {
  try {
    const lot = await parcelAt(lon, lat, o.key, o.domain);
    if (!lot) return null;
    const res = await fetch(`${o.apiBase}/realestate/nearby`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: `pt:${lat.toFixed(6)},${lon.toFixed(6)}`, parcels: [{ ...lot, buildings: [{ x: 0, y: 0, name, dong: "", floors }] }] }),
    });
    if (!res.ok) return null;
    const items = ((await res.json()) as { items?: ComplexLink[] }).items ?? [];
    return items[0] ?? null;
  } catch { return null; }
}

/** The site's page of a complex (the map on its 시군구 and 동, the complex's card open). */
export function complexHref(id: string): string {
  const [sgg, dong] = id.split(":");
  const q = new URLSearchParams({ sido: sgg.slice(0, 2), sgg });
  if (dong && dong !== "rights") q.set("dong", dong);
  q.set("complex", id);
  return `/realestate-map?${q}`;
}
