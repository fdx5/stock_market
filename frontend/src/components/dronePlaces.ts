export type DronePlaceKind = '아파트' | '학교' | '장소' | '지역' | '도로명주소' | '지번주소' | '도로';
export interface DronePlace {
  id: string; title: string; address: string; parcel: string; kind: DronePlaceKind;
  lat: number; lon: number;
}
export interface PlaceSource { type: string; category?: string; kind: DronePlaceKind }

export function validDronePoint(lat: number, lon: number) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= 33 && lat <= 39 && lon >= 124 && lon <= 132;
}
export const dronePlaceId = (p: Pick<DronePlace, 'lat' | 'lon'>) => `drone-point:${p.lat.toFixed(6)}:${p.lon.toFixed(6)}`;

/** Display locality without changing the registered building name/coordinates. */
export function placeDisplayTitle(p:DronePlace) {
  if(p.kind==='지역'||p.kind==='도로'||p.title===p.address||p.title===p.parcel)return p.title;
  const locality=(p.parcel+' '+p.address).match(/(?:^|[\s(,])([가-힣0-9·]+(?:동|읍|면))(?=[\s),]|$)/)?.[1];
  if(!locality)return p.title;
  const title=p.title.startsWith(locality)?p.title.slice(locality.length).trim():p.title;
  return title?locality+' '+title:p.title;
}

export function placeSources(query: string): PlaceSource[] {
  const district = /(?:특별시|광역시|특별자치시|특별자치도|도)$/.test(query) ? ['L1']
    : /(?:동|읍|면|리)$/.test(query) ? ['L4'] : /(?:시|군|구)$/.test(query) ? ['L2', 'L3'] : ['L1', 'L2', 'L3', 'L4'];
  const addresses: PlaceSource[] = [
    {type:'ADDRESS', category:'ROAD', kind:'도로명주소'}, {type:'ADDRESS', category:'PARCEL', kind:'지번주소'},
  ];
  return [
    ...( /\d/.test(query) ? addresses : []),
    {type:'PLACE', kind:'장소'}, ...district.map(category => ({type:'DISTRICT', category, kind:'지역' as const})),
    ...(!/\d/.test(query) ? addresses : []),
    ...(/(?:로|길)(?:\s|$)/.test(query) ? [{type:'ROAD', kind:'도로' as const}] : []),
  ];
}

export function normalizePlace(item: any, source: PlaceSource): DronePlace | null {
  const lat = Number(item?.point?.y), lon = Number(item?.point?.x);
  if (!validDronePoint(lat, lon)) return null;
  const a = item.address ?? {}, parcel = String(a.parcel ?? '').trim();
  const address = String(a.road || parcel || '').trim();
  const title = String(item.title || a.bldnm || address).trim();
  if (!title) return null;
  const category = String(item.category ?? '');
  const kind = source.type === 'PLACE' ? !/버스|정류장|입구/.test(title) && /학교|초교|중교|고교|초등|중등|고등|대학교/.test(title + category) ? '학교'
    : /아파트|공동주택|주거단지/.test(title + category) ? '아파트' : '장소' : source.kind;
  return {id:`${source.type}:${source.category ?? ''}:${item.id ?? dronePlaceId({lat,lon})}`, title, address, parcel, kind, lat, lon};
}

export function mergePlaces(items: DronePlace[], query: string): DronePlace[] {
  const compact = (v: string) => v.replace(/\s/g, '').toLocaleLowerCase();
  const q = compact(query), seen = new Set<string>();
  const score = (p: DronePlace) => p.kind==='지역'&&compact(p.title).endsWith(q) ? -1 : compact(p.title) === q ? 0 : compact(p.title).startsWith(q) ? 1
    : compact(p.title).includes(q) ? 2 : compact(p.address).includes(q) ? 3 : 4;
  const ancillary=(p:DronePlace)=>/입구|출입구|관리사무소|경로당|버스정류장|충전소|대피소|상가동|공인중개|중개사무|도서관/.test(p.title)?1:0;
  return [...items].sort((a,b)=>score(a)-score(b)||ancillary(a)-ancillary(b)).filter(p => {
    const address=compact(p.address.replace(/\s*\([^)]*\)/g,''));
    const key = compact(p.title) + ':' + (address || p.lat.toFixed(5)+':'+p.lon.toFixed(5));
    if (seen.has(key)) return false; seen.add(key); return true;
  }).slice(0,24);
}

export function readDronePlace(q: URLSearchParams): DronePlace | undefined {
  if (!q.has('lat') || !q.has('lon')) return undefined;
  const lat = Number(q.get('lat')), lon = Number(q.get('lon'));
  if (!validDronePoint(lat,lon)) return undefined;
  const title = (q.get('place') || '선택한 지역').slice(0,100), address = (q.get('address') || '').slice(0,200);
  return {id:dronePlaceId({lat,lon}), title, address, parcel:(q.get('parcel')||'').slice(0,200), kind:q.get('kind')==='아파트'?'아파트':'장소', lat, lon};
}
