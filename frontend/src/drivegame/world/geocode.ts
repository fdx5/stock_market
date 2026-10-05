/* A parcel address (지번) to latitude and longitude, from VWorld's geocoder as JSONP (it sends no
 * CORS headers) — for a start the server has no coordinates for yet. */
let seq = 0;
export function geocodeParcel(parcel: string, key: string, domain: string): Promise<{ lat: number; lon: number } | null> {
  return new Promise(resolve => {
    const name = `__dgGeo${seq++}`, w = window as unknown as Record<string, unknown>, s = document.createElement("script");
    const done = (v: { lat: number; lon: number } | null) => { window.clearTimeout(timer); delete w[name]; s.remove(); resolve(v); };
    const timer = window.setTimeout(() => done(null), 8000);
    w[name] = (body: { response?: { status?: string; result?: { point?: { x: string; y: string } } } }) => {
      const p = body?.response?.status === "OK" ? body.response.result?.point : null;
      done(p ? { lat: +p.y, lon: +p.x } : null);
    };
    const q = new URLSearchParams({ service: "address", request: "getcoord", version: "2.0", crs: "epsg:4326", address: parcel, refine: "true", simple: "false", type: "parcel", key, domain, format: "json", callback: name });
    s.referrerPolicy = "no-referrer";
    s.onerror = () => done(null);
    s.src = `https://api.vworld.kr/req/address?${q}`;
    document.head.appendChild(s);
  });
}
