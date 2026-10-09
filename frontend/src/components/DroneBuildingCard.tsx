import { useEffect, useState } from "react";
import { api, type RealEstateBuildingCard, type RealEstateBuildingRegisterRow, type RealEstateComplexResponse } from "../api/client";
import type { Sign } from "./droneSigns";
import { vworldParcelAt } from "./vworldBuildings";
import { droneComplexMatch, droneMarketQuote, dronePrice } from "./droneMarket";

/* 드론 mode: the card of a building whose sign was tapped — a layer over the flight, scrolling
 * inside itself. What the sign already knows (the register's 사용승인일, floors, height, area from
 * VWorld) shows at once; the rest comes from /api/realestate/building-info as it answers:
 * photographs of it, its history in the 건축물대장 (허가 → 착공 → 사용승인) and each 동's
 * figures, a Wikipedia article placed at it, and links to its map, road view and searches. */

const KIND: Record<Sign["kind"], [string, string]> = {
  gov: ["🏛", "공공기관"], major: ["🏢", "주요 건물"], apt: ["🏘", "아파트 단지"], hospital: ["✚", "병원"], school: ["🎓", "학교"],
};

const ymd = (s?: string | null) => {
  if (!s) return null;
  const d = s.replace(/\D/g, "");
  return d.length >= 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}` : d.length >= 6 ? `${d.slice(0, 4)}.${d.slice(4, 6)}` : d.slice(0, 4) || null;
};
const yearOf = (s?: string | null) => (s && /^(18|19|20)\d{2}/.test(s) ? +s.slice(0, 4) : null);
const n0 = (v?: number | null, unit = "") => (v == null ? null : `${Math.round(v).toLocaleString("ko-KR")}${unit}`);
const area = (v?: number | null) => (v == null ? null : `${Math.round(v).toLocaleString("ko-KR")}㎡ (${Math.round(v / 3.3058).toLocaleString("ko-KR")}평)`);

/** The 법정동 of a 지번 address ("서울특별시 성북구 길음동 1288" → 길음동), for the photo search. */
const dongOf = (addr?: string | null) => {
  const m = (addr ?? "").replace(/^\S+[시도]\s+\S+[시군구]\s+/, "").match(/\S+[동읍면리가](?=\s|\d|$)/);
  return m && !/\d/.test(m[0]) ? m[0] : undefined;
};

export default function DroneBuildingCard({ sign, at, distance, vkey, domain, onClose }: {
  sign: Sign; at: { lat: number; lon: number }; distance: number | null; vkey: string; domain: string; onClose: () => void;
}) {
  const [parcel, setParcel] = useState<{ pnu: string; address: string | null } | null>(null);
  const [card, setCard] = useState<RealEstateBuildingCard | null>(null);
  const [state, setState] = useState<"loading" | "done" | "failed">("loading");
  const [pick, setPick] = useState(0);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const [market, setMarket] = useState<RealEstateComplexResponse | null>(null);
  const [marketState, setMarketState] = useState<'loading' | 'done' | 'failed'>('loading');
  const [marketType, setMarketType] = useState<number | null>(null);
  useEffect(() => {
    const stop = new AbortController();
    setCard(null); setState("loading"); setPick(0);
    setParcel(null);
    setMarket(null); setMarketState('loading'); setMarketType(null);
    let marketStarted = false;
    const loadMarket = async (pc: { pnu: string; address: string | null } | null, address?: string | null) => {
      if (marketStarted || stop.signal.aborted || !pc?.pnu || !address) return;
      marketStarted = true;
      try {
        const nearby = await api.realEstateNearby(`pt:${at.lat.toFixed(6)},${at.lon.toFixed(6)}`, [{
          pnu: pc.pnu, addr: address, buildings: [{ x: 0, y: 0, name: sign.name, dong: sign.info?.dong ?? '', floors: sign.info?.floors ?? 0 }],
        }], stop.signal);
        if (stop.signal.aborted) return;
        const match = droneComplexMatch(sign.name, nearby.items);
        const result = match ? await api.realEstateComplex(match.id, '1y', stop.signal) : null;
        if (!stop.signal.aborted) { setMarket(result); setMarketState('done'); }
      } catch { if (!stop.signal.aborted) setMarketState('failed'); }
    };
    // (the parcel under the building first — its PNU is the register's key — from VWorld in the
    // browser: VWorld answers Korean networks only, and the server is abroad)
    const parcelJob = vworldParcelAt(at.lat, at.lon, vkey, domain).catch(() => null).then(pc =>
      sign.info?.pnu && pc?.pnu !== sign.info.pnu ? { pnu: sign.info.pnu, address: null } : pc);
    parcelJob
      .then(pc => {
        if (stop.signal.aborted) throw new Error("closed");
        setParcel(pc);
        void loadMarket(pc, pc?.address);
        return api.realEstateBuildingInfo({ name: sign.name, lat: at.lat, lon: at.lon, pnu: pc?.pnu, area: dongOf(pc?.address) }, stop.signal);
      })
      .then(async c => {
        if (stop.signal.aborted) return;
        setCard(c); setState("done");
        const pc = await parcelJob;
        const address = pc?.address ?? c.register?.find(row => row.address)?.address;
        if (address && pc) void loadMarket(pc, address);
        else if (!marketStarted) setMarketState('done');
      })
      .catch(() => { if (!stop.signal.aborted) { setState("failed"); if (!marketStarted) setMarketState('failed'); } });
    return () => stop.abort();
  }, [sign.key, sign.name, sign.info?.pnu, at.lat, at.lon, vkey, domain]);

  const [icon, kindName] = KIND[sign.kind];
  const rows = card?.register ?? [];
  const head: Partial<RealEstateBuildingRegisterRow> = rows.find(r => r.kind === "총괄표제부") ?? rows[0] ?? {};
  const info = sign.info ?? {};
  const pricedTypes = market?.types.filter(type => droneMarketQuote(type)) ?? [];
  const selectedType = pricedTypes.find(type => type.key === marketType) ?? pricedTypes[0];
  const quote = selectedType ? droneMarketQuote(selectedType) : null;
  const moveLabel = quote?.tone === 'up' ? '▲ 상승 추세' : quote?.tone === 'down' ? '▼ 하락 추세'
    : quote?.tone === 'flat' ? '보합' : '추세 자료 부족';
  // (history: the earliest dates over the 동 rows; the sign's own 사용승인일 until the register answers)
  const earliest = (k: "permitted" | "started" | "approved") => rows.map(r => r[k]).filter(Boolean).sort()[0] ?? null;
  const approved = earliest("approved") ?? (info.approved ? ymd(info.approved) : null);
  const built = yearOf(approved?.replace(/\D/g, ""));
  const age = built ? new Date().getFullYear() - built : null;
  const steps = [["허가", earliest("permitted")], ["착공", earliest("started")], ["사용승인", approved]] as const;
  const floors = rows.length ? Math.max(...rows.map(r => r.floors ?? 0)) || null : info.floors ?? null;
  const basements = rows.length ? Math.max(...rows.map(r => r.basements ?? 0)) || null : info.basements ?? null;
  const height = rows.length ? Math.max(...rows.map(r => r.height ?? 0)) || null : info.height ?? null;
  const totalArea = head.kind === "총괄표제부" ? head.totalArea : rows.length ? rows.reduce((a, r) => a + (r.totalArea ?? 0), 0) || null : info.area ?? null;
  const households = head.kind === "총괄표제부" ? head.households : rows.length ? rows.reduce((a, r) => a + (r.households ?? 0), 0) || null : null;
  const lifts = rows.length ? rows.reduce((a, r) => a + (r.lifts ?? 0), 0) || null : null;
  const dongs = rows.filter(r => r.kind !== "총괄표제부");
  const facts = ([
    ["주용도", head.use ? `${head.use}${head.useDetail && head.useDetail !== head.use ? ` · ${head.useDetail}` : ""}` : null],
    ["구조", head.structure],
    ["층수", floors ? `지상 ${floors}층${basements ? ` · 지하 ${basements}층` : ""}` : null],
    ["높이", height ? `${height.toFixed(1)}m` : null],
    ["연면적", area(totalArea)],
    ["건축면적", area(head.buildingArea)],
    ["대지면적", area(head.siteArea)],
    ["세대수", n0(households, "세대")],
    ["승강기", n0(lifts, "대")],
    ["동 수", dongs.length > 1 ? `${dongs.length}개 동` : null],
    ["내진설계", head.seismic ? "적용" : null],
  ] as [string, string | null | undefined][]).filter(([, v]) => v);
  const photos = (card?.photos ?? []).filter(p => !broken.has(p.thumb));
  const hero = photos[Math.min(pick, photos.length - 1)];
  const address = head.address ?? card?.place?.address ?? parcel?.address ?? null;
  const q = encodeURIComponent(`${card?.area ?? ""} ${sign.name}`.trim());
  const links: [string, string][] = [
    ["카카오맵", `https://map.kakao.com/link/map/${encodeURIComponent(sign.name)},${at.lat.toFixed(6)},${at.lon.toFixed(6)}`],
    ["로드뷰", `https://map.kakao.com/link/roadview/${at.lat.toFixed(6)},${at.lon.toFixed(6)}`],
    ["네이버 지도", `https://map.naver.com/p/search/${q}`],
    ["이미지 더보기", `https://search.daum.net/search?w=img&q=${q}`],
  ];
  if (card?.place?.url) links.unshift(["장소 상세", card.place.url]);

  return (
    <div className="re-drone-card" role="dialog" aria-label={`${sign.name} 건물 정보`}
      onPointerDown={e => e.stopPropagation()} onPointerMove={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()} onContextMenu={e => e.stopPropagation()}>
      <header className="re-drone-card-head">
        <span className={`re-drone-card-kind is-${sign.kind}`}>{icon} {kindName}</span>
        <h3>{sign.name}</h3>
        <p>{[address, distance != null ? `드론에서 ${distance >= 1000 ? `${(distance / 1000).toFixed(1)}km` : `${Math.round(distance)}m`}` : null].filter(Boolean).join(" · ") || " "}</p>
        <button type="button" className="re-drone-card-x" onClick={onClose} aria-label="닫기" title="닫기 (Esc)">✕</button>
      </header>
      <div className="re-drone-card-body">
        {quote && selectedType ? (
          <section className={`re-drone-card-market is-${quote.tone}`} aria-label="평균 시세">
            <div className="re-drone-card-market-title">
              <h4>평균 시세</h4>
              {pricedTypes.length > 1 ? <select aria-label="시세 평형" value={selectedType.key} onChange={e => setMarketType(Number(e.target.value))}>
                {pricedTypes.map(type => <option key={type.key} value={type.key}>{type.area.toFixed(1)}㎡ · {Math.round(type.pyeong)}평</option>)}
              </select> : <span>전용 {selectedType.area.toFixed(1)}㎡</span>}
            </div>
            <strong className="re-drone-card-price">{dronePrice(quote.average)}</strong>
            <span className="re-drone-card-price-trend">{moveLabel}{quote.change != null ? ` · ${quote.change > 0 ? '+' : ''}${quote.change.toFixed(1)}%` : ''}</span>
            <p>최근 1년 {selectedType.price_source === 'rights' ? '분양·입주권' : '매매'} 실거래 평균 · {quote.samples}건{quote.direct ? ' · 직거래 기준' : ''}</p>
            <p>{quote.from} ~ {quote.to} · 천만원 미만 생략</p>
            <small>출처: 국토교통부 실거래가 · 1년 변동률 기준</small>
          </section>
        ) : sign.kind === 'apt' && (
          <section className="re-drone-card-market is-empty" aria-label="평균 시세">
            <h4>평균 시세</h4>
            <p>{marketState === 'loading' ? '실거래 시세 조회 중…' : marketState === 'failed' ? '시세를 불러오지 못했습니다.' : '매칭된 최근 1년 실거래 자료가 없습니다.'}</p>
          </section>
        )}
        {state === "loading" && !photos.length && <div className="re-drone-card-shimmer" aria-label="사진 불러오는 중" />}
        {hero && (
          <figure className="re-drone-card-hero">
            <a href={hero.link ?? hero.image ?? hero.thumb} target="_blank" rel="noopener noreferrer">
              <img src={hero.image ?? hero.thumb} alt={`${sign.name} 사진`} referrerPolicy="no-referrer" decoding="async"
                onError={e => { const img = e.currentTarget; if (hero.image && img.src !== hero.thumb) img.src = hero.thumb; else setBroken(b => new Set(b).add(hero.thumb)); }} />
            </a>
            {hero.site && <figcaption>출처 {hero.site}</figcaption>}
          </figure>
        )}
        {photos.length > 1 && (
          <div className="re-drone-card-strip" role="list">
            {photos.map((p, i) => (
              <button key={p.thumb} type="button" role="listitem" className={i === pick ? "is-on" : ""} onClick={() => setPick(i)} aria-label={`사진 ${i + 1}`}>
                <img src={p.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(b => new Set(b).add(p.thumb))} />
              </button>
            ))}
          </div>
        )}

        <section>
          <h4>건물 이력</h4>
          <ol className="re-drone-card-time">
            {steps.map(([k, v]) => <li key={k} className={v ? "" : "is-none"}><b>{k}</b><span>{ymd(v) ?? (state === "loading" ? "조회 중…" : "자료 없음")}</span></li>)}
          </ol>
          {age != null && <p className="re-drone-card-age">준공 후 <b>{age}년</b>{age >= 30 && sign.kind === "apt" ? " · 재건축 연한(30년) 경과" : ""}</p>}
        </section>

        {facts.length > 0 && (
          <section>
            <h4>건물 개요</h4>
            <dl className="re-drone-card-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </section>
        )}

        {dongs.length > 1 && (
          <section>
            <h4>동별 현황 <small>{dongs.length}개 동</small></h4>
            <div className="re-drone-card-table">
              <table>
                <thead><tr><th>동</th><th>층</th><th>세대</th><th>사용승인</th></tr></thead>
                <tbody>{dongs.slice(0, 80).map((r, i) => (
                  <tr key={i}><td>{r.dong ?? r.name ?? "-"}</td><td>{r.floors ?? "-"}</td><td>{r.households ?? "-"}</td><td>{ymd(r.approved) ?? "-"}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        )}

        {card?.wiki?.extract && (
          <section>
            <h4>소개 <small>위키백과</small></h4>
            <p className="re-drone-card-wiki">{card.wiki.extract}</p>
            {card.wiki.url && <a className="re-drone-card-more" href={card.wiki.url} target="_blank" rel="noopener noreferrer">위키백과에서 더 보기 ›</a>}
          </section>
        )}

        {card?.place && (
          <section>
            <h4>장소 정보</h4>
            <dl className="re-drone-card-facts">
              {card.place.category && <div><dt>분류</dt><dd>{card.place.category}</dd></div>}
              {card.place.phone && <div><dt>전화</dt><dd><a href={`tel:${card.place.phone}`}>{card.place.phone}</a></dd></div>}
            </dl>
          </section>
        )}

        <nav className="re-drone-card-links" aria-label="외부에서 보기">
          {links.map(([k, href]) => <a key={k} href={href} target="_blank" rel="noopener noreferrer">{k} ↗</a>)}
        </nav>
        <p className="re-drone-card-src">
          {state === "failed" ? "정보를 불러오지 못했습니다. 잠시 후 다시 눌러 주세요." :
            `출처: ${["국토교통부 GIS건물통합정보(VWorld)", ...(card?.sources ?? [])].join(", ")}`}
        </p>
      </div>
    </div>
  );
}
