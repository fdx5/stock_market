/* The PNU (parcel number) under a point, from VWorld's cadastral layer (연속지적도) as JSONP (it
 * sends no CORS headers): what the building register is asked by. */
let seq = 0;
export function pnuAt(lon: number, lat: number, key: string, domain: string): Promise<string | null> {
  return new Promise(resolve => {
    const name = `__wkPnu${seq++}`, w = window as unknown as Record<string, unknown>, s = document.createElement("script");
    const done = (v: string | null) => { window.clearTimeout(timer); delete w[name]; s.remove(); resolve(v); };
    const timer = window.setTimeout(() => done(null), 6000);
    w[name] = (body: { response?: { status?: string; result?: { featureCollection?: { features?: { properties?: { pnu?: string } }[] } } } }) => {
      const f = body?.response?.status === "OK" ? body.response.result?.featureCollection?.features?.[0] : null;
      const pnu = f?.properties?.pnu ?? null;
      done(pnu && /^\d{19}$/.test(pnu) ? pnu : null);
    };
    const q = new URLSearchParams({ service: "data", request: "GetFeature", data: "LP_PA_CBND_BUBUN", crs: "EPSG:4326", geomFilter: `POINT(${lon} ${lat})`, geometry: "false", attribute: "true", size: "1", key, domain, format: "json", callback: name });
    s.referrerPolicy = "no-referrer";
    s.onerror = () => done(null);
    s.src = `https://api.vworld.kr/req/data?${q}`;
    document.head.appendChild(s);
  });
}
