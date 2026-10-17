import { useEffect, useMemo, useState } from 'react';
import { bedsText, FACILITY, LIVE_STATUS_TEXT, liveApi, liveState, placeTrain, trainsComing, type Arrival, type LiveRef, type StationInfo, type SubwayStation, type Timetable } from './publicLive';

/* The panels of the drone's live public layers (a tap on a sign): a subway station's live
 * arrivals both ways, today's timetable, the trains coming and the lines there; a train; an
 * emergency room's free beds and equipment; a 따릉이 dock; a public car park. */

const colourOf = (line: string) => liveState.subway?.lines[line]?.colour ?? '#86e5f2';
const LineChip = ({ line }: { line: string }) => <span className="re-live-line" style={{ background: colourOf(line) }}>{line}</span>;
const nowHM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
// (the trains' day runs past midnight: 00:30 sorts after 23:50)
const dayKey = (hm: string) => (hm < '04:00' ? '1' : '0') + hm;
const mmss = (s: number) => s >= 60 ? `${Math.floor(s / 60)}분${s % 60 ? ` ${s % 60}초` : ''}` : `${s}초`;
const dirName = (line: string, d: string) => line === '2호선' ? (d === '0' || d === '내선' ? '내선순환' : '외선순환') : d === '0' || d === '상행' ? '상행' : d === '1' || d === '하행' ? '하행' : d;

function useTick(ms: number) { const [, set] = useState(0); useEffect(() => { const t = window.setInterval(() => set(n => n + 1), ms); return () => window.clearInterval(t); }, [ms]); }
function useTrains() { const [, set] = useState(0); useEffect(() => { const f = () => set(n => n + 1); liveState.listeners.add(f); return () => { liveState.listeners.delete(f); }; }, []); return liveState.trains; }

function Arrivals({ items, received }: { items: Arrival[]; received: number }) {
  useTick(1000);
  const groups = new Map<string, Arrival[]>();
  for (const a of items) { const k = a.line + '|' + dirName(a.line, a.direction); groups.set(k, [...(groups.get(k) ?? []), a]); }
  if (!items.length) return <p className="re-live-empty">지금 도착 예정 열차 정보가 없습니다.</p>;
  const gone = Math.floor((Date.now() - received) / 1000);
  return <div className="re-live-arrivals">{[...groups].map(([k, list]) => {
    const [line, dir] = k.split('|');
    return <section key={k}><h4><LineChip line={line} /> {dir}</h4><ul>
      {list.sort((a, b) => a.order.localeCompare(b.order)).slice(0, 3).map((a, i) => {
        const left = a.seconds > 0 ? Math.max(0, a.seconds - gone) : 0;
        return <li key={a.train + i}>
          <b>{a.heading || `${a.toward}행`}</b>
          <span className="re-live-when">{left > 0 ? mmss(left) : a.message || a.code}</span>
          <small>{[a.message && left > 0 ? a.message : '', a.at && !a.message.includes(a.at) ? `현재 ${a.at}` : '', a.kind && a.kind !== '일반' ? a.kind : '', a.last ? '막차' : '', a.train ? `${a.train}열차` : ''].filter(Boolean).join(' · ')}</small>
        </li>;
      })}</ul></section>;
  })}</div>;
}

function TimetableView({ t }: { t: Timetable }) {
  const [all, setAll] = useState(false);
  const now = dayKey(nowHM()), items = t.items;
  const next = items.findIndex(i => dayKey(i.time) >= now);
  const shown = all ? items : items.slice(Math.max(0, next < 0 ? items.length : next), (next < 0 ? items.length : next) + 8);
  return <section className="re-live-tt">
    <h4><LineChip line={t.line} /> {t.direction}<small>첫차 {items[0]?.time ?? '-'} · 막차 {items[items.length - 1]?.time ?? '-'} · {items.length}회</small></h4>
    {t.status !== 'ok' ? <p className="re-live-empty">{LIVE_STATUS_TEXT[t.status] ?? '시간표를 불러오지 못했습니다'}</p>
      : !items.length ? <p className="re-live-empty">이 노선의 역 시간표는 제공되지 않습니다.</p>
      : <>{next < 0 && !all && <p className="re-live-empty">오늘 운행이 끝났습니다.</p>}
        <ol>{shown.map((i, k) => <li key={i.train + i.time + k} className={!all && k === 0 && next >= 0 ? 'is-next' : dayKey(i.time) < now ? 'is-past' : ''}>
          <b>{i.time}</b><span>{i.to}행</span>{i.express && <em>급행</em>}</li>)}</ol>
        <button type="button" className="re-live-more" onClick={() => setAll(v => !v)}>{all ? '다음 열차만 보기' : `오늘 전체 시간표 (${items.length}회)`}</button></>}
  </section>;
}

function StationPanel({ station, exit }: { station: SubwayStation; exit?: import('./publicLive').Facility }) {
  const [week, setWeek] = useState<string | undefined>();
  const [info, setInfo] = useState<StationInfo | null>(null);
  const [received, setReceived] = useState(Date.now());
  const [error, setError] = useState(false);
  const trains = useTrains();
  useEffect(() => {
    const stop = new AbortController();
    const load = () => liveApi.station(station.name, station.lines, week, stop.signal)
      .then(v => { setInfo(v); setReceived(Date.now()); setError(false); }).catch(() => { if (!stop.signal.aborted) setError(true); });
    void load(); const t = window.setInterval(load, 20000);
    return () => { stop.abort(); window.clearInterval(t); };
  }, [station, week]);
  const d = liveState.subway;
  const coming = useMemo(() => d ? station.lines.map(l => ({ line: l, list: trainsComing(d, trains, station, l) })) : [], [d, trains, station]);
  const tts = info?.timetables ?? [];
  return <>
    <header><div><small>지하철역 · 실시간{exit ? ' · 출입구에서 연 정보' : ''}</small><h3>{station.name}역{exit ? <span className="re-live-exit">{exit.ref ? `${exit.ref}번 출구` : '출입구'}</span> : null}</h3><p className="re-live-lines">{station.lines.map(l => <LineChip key={l} line={l} />)}</p></div></header>
    <div className="re-live-body">
      <h5>실시간 도착 <small>{info ? `${info.updated} 기준 · 20초마다 갱신` : '불러오는 중…'}</small></h5>
      {error && !info && <p className="re-live-empty">{LIVE_STATUS_TEXT.unavailable}</p>}
      {info && (info.arrivalStatus === 'ok' ? <Arrivals items={info.arrivals} received={received} /> : <p className="re-live-empty">{LIVE_STATUS_TEXT[info.arrivalStatus ?? 'unavailable']}</p>)}
      {coming.some(c => c.list.length) && <>
        <h5>이 역으로 오는 열차 <small>열차 위치 기준</small></h5>
        <div className="re-live-coming">{coming.filter(c => c.list.length).map(c => {
          const byDir = new Map<string, typeof c.list>();
          for (const x of c.list) byDir.set(x.direction, [...(byDir.get(x.direction) ?? []), x]);
          return [...byDir].map(([dir, list]) => <p key={c.line + dir}><LineChip line={c.line} /> {dirName(c.line, dir)}: {list.slice(0, 3).map(x =>
            <span key={x.train.train}>{x.away <= 0 ? `${x.train.station} ${x.train.status}` : `${Math.ceil(x.away)}정거장 전 (${x.train.station} ${x.train.status})`}{x.train.express ? ' 급행' : ''}{x.train.last ? ' 막차' : ''}</span>)}</p>);
        })}</div></>}
      <h5>오늘 시간표 <small>{info?.weekName ?? ''}</small></h5>
      <div className="re-live-week" role="group" aria-label="시간표 요일">
        {([['1', '평일'], ['2', '토요일'], ['3', '휴일']] as const).map(([w, name]) => <button key={w} type="button" aria-pressed={(week ?? info?.week) === w} onClick={() => setWeek(w)}>{name}</button>)}
      </div>
      {info && info.timetableStatus !== 'ok' && <p className="re-live-empty">{LIVE_STATUS_TEXT[info.timetableStatus ?? 'unavailable']}</p>}
      {tts.map(t => <TimetableView key={t.code + t.inout + info?.week} t={t} />)}
      {info && info.timetableStatus === 'ok' && !tts.length && <p className="re-live-empty">이 역의 시간표가 제공되지 않습니다.</p>}
      <h5>역 정보</h5>
      <dl className="re-live-facts">
        <dt>노선</dt><dd>{station.lines.join(' · ')}{station.lines.length > 1 ? ` (환승 ${station.lines.length}개 노선)` : ''}</dd>
        {tts.some(t => t.fr) && <><dt>역 번호</dt><dd>{[...new Set(tts.map(t => t.fr && `${t.line} ${t.fr}`).filter(Boolean))].join(' · ')}</dd></>}
        <dt>위치</dt><dd>N{station.lat.toFixed(5)} E{station.lon.toFixed(5)}</dd>
        {exit && <><dt>이 출입구</dt><dd>{exit.ref ? `${exit.ref}번 출구` : '번호 미등록'}{exit.wheelchair === 'yes' ? ' · 휠체어 이용 가능' : exit.wheelchair === 'no' ? ' · 계단만' : ''} · N{exit.lat.toFixed(5)} E{exit.lon.toFixed(5)}</dd></>}
      </dl>
      <p className="re-live-source">{info?.source ?? '서울 열린데이터광장'} · 역 위치 © OpenStreetMap contributors</p>
    </div>
  </>;
}

function TrainPanel({ train, colour }: { train: import('./publicLive').Train; colour: string }) {
  const trains = useTrains();
  const t = trains.find(x => x.train === train.train && x.line === train.line) ?? train;
  const d = liveState.subway, p = d ? placeTrain(d, t, { lat: 37.55, lon: 127 }) : null;
  return <>
    <header><div><small>운행 중인 열차 · 실시간 위치</small><h3><span className="re-live-line" style={{ background: colour }}>{t.line}</span> {t.terminal}행</h3></div></header>
    <div className="re-live-body">
      <dl className="re-live-facts">
        <dt>현재</dt><dd><b>{t.station}</b> {t.status}</dd>
        <dt>방향</dt><dd>{dirName(t.line, t.direction)}{t.express ? ' · 급행' : ''}{t.last ? ' · 막차' : ''}</dd>
        <dt>열차 번호</dt><dd>{t.train}</dd>
        <dt>수신</dt><dd>{t.at.slice(11) || '-'}</dd>
      </dl>
      {!!p?.next.length && <><h5>다음 역</h5><ol className="re-live-next">{p.next.map(s => <li key={s.key}>{s.name}</li>)}</ol></>}
      <p className="re-live-source">서울 열린데이터광장 실시간 열차 위치 · 역 사이 위치는 역 순서로 추정</p>
    </div>
  </>;
}

const n = (v: number | null) => v === null ? '-' : String(v);
function RoomPanel({ room: r }: { room: import('./publicLive').EmergencyRoom }) {
  const when = /^\d{14}$/.test(r.updated) ? `${r.updated.slice(4, 6)}/${r.updated.slice(6, 8)} ${r.updated.slice(8, 10)}:${r.updated.slice(10, 12)}` : r.updated;
  return <>
    <header><div><small>응급실 · 실시간 가용병상</small><h3>{r.name}</h3><p>{r.kind}</p></div></header>
    <div className="re-live-body">
      <div className={`re-live-big ${r.er === null ? '' : r.er <= 0 ? 'is-jam' : r.er <= 2 ? 'is-slow' : 'is-go'}`}><b>{r.er !== null && r.er < 0 ? '포화' : n(r.er)}</b><span>{r.er !== null && r.er < 0 ? `응급실 기준 병상보다 환자 ${-r.er}명 많음` : '응급실 가용 병상'}{r.erTotal ? ` / 기준 ${r.erTotal}` : ''}</span></div>
      <dl className="re-live-facts">
        <dt>수술실</dt><dd>{n(r.surgery)}</dd><dt>일반 중환자실</dt><dd>{n(r.icu)}</dd><dt>입원실</dt><dd>{n(r.ward)}</dd>
        {r.neuroIcu !== null && <><dt>신경 중환자실</dt><dd>{n(r.neuroIcu)}</dd></>}{r.neonatal !== null && <><dt>신생아 중환자실</dt><dd>{n(r.neonatal)}</dd></>}
        <dt>장비</dt><dd>{[r.ct && 'CT', r.mri && 'MRI', r.angio && '혈관촬영기', r.ventilator && '인공호흡기', r.ambulance && '구급차'].filter(Boolean).join(' · ') || '-'}</dd>
        <dt>응급실 전화</dt><dd>{r.tel ? <a href={`tel:${r.tel}`}>{r.tel}</a> : '-'}</dd>
        <dt>주소</dt><dd>{r.address}</dd><dt>거리</dt><dd>{(r.distance / 1000).toFixed(1)}km</dd><dt>갱신</dt><dd>{when}</dd>
      </dl>
      <p className="re-live-warn">병상 수는 병원이 입력한 실시간 값이며 실제 수용 가능 여부와 다를 수 있습니다. 응급 상황에서는 먼저 119에 연락하세요.</p>
      <p className="re-live-source">국립중앙의료원 중앙응급의료센터 (E-Gen)</p>
    </div>
  </>;
}

function BikePanel({ dock: b }: { dock: import('./publicLive').BikeDock }) {
  return <>
    <header><div><small>따릉이 대여소 · 실시간</small><h3>{b.name}</h3></div></header>
    <div className="re-live-body">
      <div className={`re-live-big ${b.bikes <= 0 ? 'is-jam' : b.bikes <= 2 ? 'is-slow' : 'is-go'}`}><b>{b.bikes}</b><span>대여 가능 자전거</span></div>
      <dl className="re-live-facts"><dt>거치대</dt><dd>{b.racks}개</dd><dt>거치율</dt><dd>{b.shared}%</dd><dt>거리</dt><dd>{b.distance}m</dd><dt>대여소 번호</dt><dd>{b.id}</dd></dl>
      <p className="re-live-source">서울특별시 공공자전거 실시간 대여정보</p>
    </div>
  </>;
}

const won = (v: number | null) => v === null || v === undefined ? '-' : `${Math.round(v).toLocaleString()}원`;
const hours = (h: string) => /^\d{4}-\d{4}$/.test(h) ? `${h.slice(0, 2)}:${h.slice(2, 4)}~${h.slice(5, 7)}:${h.slice(7, 9)}` : h;
function ParkingPanel({ lot: l }: { lot: import('./publicLive').ParkingLot }) {
  const free = l.total !== null && l.parked !== null ? Math.max(0, l.total - l.parked) : null;
  return <>
    <header><div><small>공영주차장 · 실시간</small><h3>{l.name}</h3><p>{l.type}</p></div></header>
    <div className="re-live-body">
      <div className={`re-live-big ${free === null || !l.total ? '' : free / l.total < .05 ? 'is-jam' : free / l.total < .2 ? 'is-slow' : 'is-go'}`}><b>{free ?? '-'}</b><span>잔여 면 {l.total !== null ? `/ 전체 ${l.total}면` : ''}</span></div>
      <dl className="re-live-facts">
        <dt>현재 주차</dt><dd>{l.parked ?? '-'}대{l.live ? '' : ' (실시간 연계 아님)'}</dd>
        <dt>요금</dt><dd>{l.paid}{l.basic.won ? ` · 기본 ${l.basic.minutes}분 ${won(l.basic.won)}` : ''}{l.extra.won ? ` · 추가 ${l.extra.minutes}분 ${won(l.extra.won)}` : ''}{l.dayMax ? ` · 일 최대 ${won(l.dayMax)}` : ''}</dd>
        <dt>운영</dt><dd>평일 {hours(l.hours.weekday)} · 주말 {hours(l.hours.weekend)} · 공휴일 {hours(l.hours.holiday)}</dd>
        <dt>전화</dt><dd>{l.tel ? <a href={`tel:${l.tel}`}>{l.tel}</a> : '-'}</dd>
        <dt>주소</dt><dd>{l.address}</dd><dt>거리</dt><dd>{(l.distance / 1000).toFixed(1)}km</dd><dt>갱신</dt><dd>{l.updated || '-'}</dd>
      </dl>
      <p className="re-live-source">서울시 공영주차장 실시간 주차대수 (서울 열린데이터광장) · 위치는 주소 기준</p>
    </div>
  </>;
}

function FacilityPanel({ place: f }: { place: import('./publicLive').Facility }) {
  const k = FACILITY[f.kind];
  return <>
    <header><div><small>공공시설 · 위치 정보</small><h3>{k.icon} {f.name}</h3><p>{k.label}</p></div></header>
    <div className="re-live-body">
      <dl className="re-live-facts">
        <dt>종류</dt><dd>{k.label}</dd>
        {f.address && <><dt>주소</dt><dd>{f.address}</dd></>}
        {f.phone && <><dt>전화</dt><dd><a href={`tel:${f.phone}`}>{f.phone}</a></dd></>}
        {f.hours && <><dt>운영</dt><dd>{f.hours}</dd></>}
        {f.description && <><dt>설치 위치</dt><dd>{f.description}</dd></>}
        {f.kind === 'aed' && !(f as { model?: string }).model && <><dt>실내/실외</dt><dd>{f.indoor ? '실내' : '확인 필요'}{f.access ? ` · ${f.access}` : ''}</dd></>}
        {(f as { model?: string }).model && <><dt>모델</dt><dd>{(f as { model?: string }).model}</dd></>}
        <dt>거리</dt><dd>{f.distance >= 1000 ? `${(f.distance / 1000).toFixed(1)}km` : `${f.distance}m`}</dd>
        <dt>좌표</dt><dd>N{f.lat.toFixed(5)} E{f.lon.toFixed(5)}</dd>
      </dl>
      <p className="re-live-links"><a href={`https://map.kakao.com/link/map/${encodeURIComponent(f.name)},${f.lat},${f.lon}`} target="_blank" rel="noreferrer">카카오맵에서 보기</a>
        <a href={`https://map.kakao.com/link/to/${encodeURIComponent(f.name)},${f.lat},${f.lon}`} target="_blank" rel="noreferrer">길찾기</a></p>
      {(f.kind === 'fire' || f.kind === 'aed') && <p className="re-live-warn">응급 상황에서는 먼저 119에 신고하세요.</p>}
      <p className="re-live-source">{(f as { model?: string }).model !== undefined ? '국립중앙의료원 자동심장충격기(AED) 정보' : '© OpenStreetMap contributors · 지도 데이터는 실제와 다를 수 있습니다'}</p>
    </div>
  </>;
}

type Tab = 'er' | 'parking' | 'bike' | 'facility';
function ListPanel() {
  useTick(5000);
  const tabs: [Tab, string, number][] = [['er', '🚑 응급실', liveState.rooms.length], ['parking', '🅿️ 주차장', liveState.lots.length], ['bike', '🚲 따릉이', liveState.docks.length], ['facility', '🚒 공공시설', liveState.places.filter(f => f.kind !== 'exit').length]];
  const [tab, setTab] = useState<Tab>(() => tabs.find(t => t[2])?.[0] ?? 'er');
  const [filter, setFilter] = useState<string>('all');
  const km = (d: number) => d >= 1000 ? `${(d / 1000).toFixed(1)}km` : `${d}m`;
  const rows: { key: string; open: LiveRef; title: string; sub: string; value: string; tone: string }[] =
    tab === 'er' ? liveState.rooms.map(r => ({ key: r.id, open: { type: 'er', room: r } as LiveRef, title: r.name, sub: `${r.kind} · ${km(r.distance)}`, value: bedsText(r.er), tone: r.er === null ? '' : r.er <= 0 ? 'is-jam' : r.er <= 2 ? 'is-slow' : 'is-go' }))
    : tab === 'parking' ? liveState.lots.map(l => { const free = l.total !== null && l.parked !== null ? Math.max(0, l.total - l.parked) : null;
      return { key: l.id, open: { type: 'parking', lot: l } as LiveRef, title: l.name, sub: `${l.paid} · ${km(l.distance)}`, value: free === null ? '-' : `잔여 ${free}/${l.total}`, tone: free === null || !l.total ? '' : free / l.total < .05 ? 'is-jam' : free / l.total < .2 ? 'is-slow' : 'is-go' }; })
    : tab === 'bike' ? liveState.docks.map(b => ({ key: b.id, open: { type: 'bike', dock: b } as LiveRef, title: b.name, sub: `거치대 ${b.racks} · ${km(b.distance)}`, value: `${b.bikes}대`, tone: b.bikes <= 0 ? 'is-jam' : b.bikes <= 2 ? 'is-slow' : 'is-go' }))
    : liveState.places.filter(f => f.kind !== 'exit' && (filter === 'all' || f.kind === filter)).map(f => ({ key: f.id, open: { type: 'facility', place: f } as LiveRef, title: `${FACILITY[f.kind].icon} ${f.name}`, sub: FACILITY[f.kind].label, value: km(f.distance), tone: '' }));
  return <>
    <header><div><small>드론 주변 · 실시간 공공정보</small><h3>주변 종합 정보</h3><p>가까운 순서 · 행을 누르면 상세 정보</p></div></header>
    <div className="re-live-body">
      <div className="re-live-week" role="tablist">{tabs.map(([t, name, count]) => <button key={t} type="button" role="tab" aria-pressed={tab === t} onClick={() => setTab(t)}>{name} {count}</button>)}</div>
      {tab === 'facility' && <div className="re-live-week re-live-filter">{['all', ...Object.keys(FACILITY).filter(k => k !== 'exit')].map(k => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{k === 'all' ? '전체' : FACILITY[k as keyof typeof FACILITY].icon + ' ' + FACILITY[k as keyof typeof FACILITY].label.split('·')[0]}</button>)}</div>}
      {!rows.length ? <p className="re-live-empty">{tab === 'facility' ? '주변 3km에 등록된 시설이 없습니다.' : '이 레이어를 켜면 주변 목록이 표시됩니다 (서울 외 지역은 일부 제공되지 않음).'}</p>
        : <ul className="re-live-list">{rows.map(r => <li key={r.key}><button type="button" onClick={() => window.dispatchEvent(new CustomEvent('live-open', { detail: r.open }))}>
          <span><b>{r.title}</b><small>{r.sub}</small></span><em className={r.tone}>{r.value}</em></button></li>)}</ul>}
      <p className="re-live-source">응급실: 국립중앙의료원 E-Gen · 주차장·따릉이: 서울 열린데이터광장 · 공공시설: © OpenStreetMap contributors</p>
    </div>
  </>;
}

export default function LivePanel({ item, onClose }: { item: LiveRef; onClose: () => void }) {
  // (Esc: the drone's own key handler closes it, as it closes a building's card)
  return <div className="re-drone-card re-live-panel" role="dialog" aria-label="실시간 상세 정보" onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
    <button type="button" className="re-live-close" onClick={onClose} aria-label="닫기">×</button>
    {item.type === 'station' ? <StationPanel station={item.station} exit={item.exit} />
      : item.type === 'train' ? <TrainPanel train={item.train} colour={item.colour} />
      : item.type === 'er' ? <RoomPanel room={item.room} />
      : item.type === 'bike' ? <BikePanel dock={item.dock} />
      : item.type === 'parking' ? <ParkingPanel lot={item.lot} />
      : item.type === 'facility' ? <FacilityPanel place={item.place} />
      : <ListPanel />}
  </div>;
}
