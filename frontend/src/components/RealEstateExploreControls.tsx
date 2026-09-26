import { EstateFilters, FILTER_DEFAULTS } from "./realEstateTools";

export default function RealEstateExploreControls({ filters, onChange, busy }: {
  filters: EstateFilters; onChange: (value: EstateFilters) => void; busy: boolean;
}) {
  const set = (key: keyof EstateFilters, value: string) => onChange({ ...filters, [key]: value });
  const count = Object.entries(filters).filter(([k, v]) => k !== "q" && k !== "sort" && !!v).length;
  return <section className="re-explore-controls" aria-label="단지 검색과 조건">
    <div className="re-search-row">
      <label className="re-search-field"><span>선택 지역의 단지·동 검색</span>
        <input type="search" value={filters.q} maxLength={80} placeholder="단지명 또는 동 이름을 입력하세요" onChange={e => set("q", e.target.value)} autoComplete="off" />
      </label>
      <label className="re-sort-field"><span>정렬</span><select value={filters.sort} onChange={e => set("sort", e.target.value)}>
        <option value="price_desc">가격 높은 순</option><option value="price_asc">가격 낮은 순</option>
        <option value="change_desc">상승률 높은 순</option><option value="trades_desc">거래 많은 순</option>
        <option value="date_desc">최근 거래순</option><option value="name">단지 이름순</option>
      </select></label>
    </div>
    <details className="re-filter-panel"><summary>가격·면적·거래 조건 {count > 0 && <b>{count}개 적용</b>}</summary>
      <div className="re-filter-grid">
        <fieldset><legend>실거래 기준가 · 억원</legend><div className="re-input-pair">
          <input aria-label="최소 가격 (억원)" type="number" inputMode="decimal" min="0" step="0.5" placeholder="최소" value={filters.price_min ? Number(filters.price_min) / 10000 : ""} onChange={e => set("price_min", e.target.value === "" ? "" : String(Number(e.target.value) * 10000))} /><span>~</span>
          <input aria-label="최대 가격 (억원)" type="number" inputMode="decimal" min="0" step="0.5" placeholder="최대" value={filters.price_max ? Number(filters.price_max) / 10000 : ""} onChange={e => set("price_max", e.target.value === "" ? "" : String(Number(e.target.value) * 10000))} />
        </div></fieldset>
        <fieldset><legend>전용면적 · ㎡</legend><div className="re-input-pair">
          <input aria-label="최소 전용면적" type="number" inputMode="decimal" min="0" placeholder="최소" value={filters.area_min} onChange={e => set("area_min", e.target.value)} /><span>~</span>
          <input aria-label="최대 전용면적" type="number" inputMode="decimal" min="0" placeholder="최대" value={filters.area_max} onChange={e => set("area_max", e.target.value)} />
        </div></fieldset>
        <label><span>준공연도</span><select value={filters.built_min} onChange={e => set("built_min", e.target.value)}><option value="">전체</option>{[2020, 2010, 2000, 1990].map(y => <option key={y} value={y}>{y}년 이후</option>)}</select></label>
        <label><span>기간 내 최소 거래</span><select value={filters.min_trades} onChange={e => set("min_trades", e.target.value)}><option value="">전체</option>{[1, 3, 5, 10].map(n => <option key={n} value={n}>{n}건 이상</option>)}</select></label>
        <label><span>마지막 기준 거래</span><select value={filters.recent_days} onChange={e => set("recent_days", e.target.value)}><option value="">전체</option><option value="90">90일 이내</option><option value="180">180일 이내</option><option value="365">1년 이내</option></select></label>
      </div>
      <p>수집된 지역 전체에 조건을 먼저 적용합니다. 면적 조건이 있으면 그 범위에서 거래가 가장 많은 평형을 비교합니다.</p>
    </details>
    {(count > 0 || filters.q) && <div className="re-filter-feedback"><span>{busy ? "조건에 맞는 단지를 찾고 있습니다…" : "검색·필터 적용 중"}</span><button type="button" onClick={() => onChange({ ...FILTER_DEFAULTS })}>조건 초기화</button></div>}
  </section>;
}
