import { useMemo } from "react";
import type { MarketMapItem } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { pct, toneOf } from "../desk2/lib";

const names: Record<string, string> = { "Information Technology": "정보기술", "Health Care": "헬스케어", Financials: "금융", "Consumer Discretionary": "경기소비재", "Communication Services": "커뮤니케이션", Industrials: "산업재", "Consumer Staples": "필수소비재", Energy: "에너지", Utilities: "유틸리티", "Real Estate": "부동산", Materials: "소재" };

export default function NeoSectorDigest({ items }: { items: MarketMapItem[] }) {
  const { lang } = useLanguage();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const sectors = useMemo(() => {
    const seen = new Set<string>(), groups = new Map<string, { weight: number; weightedChange: number }>();
    // US-map marcap is the supplied index weight (%), never dollar capitalization.
    for (const item of items) {
      if (seen.has(item.code) || !item.sector || item.sector === "Other" || !Number.isFinite(item.marcap) || item.marcap <= 0 || !Number.isFinite(item.close) || item.close <= 0 || !Number.isFinite(item.change_pct)) continue;
      seen.add(item.code);
      const group = groups.get(item.sector) ?? { weight: 0, weightedChange: 0 };
      group.weight += item.marcap;
      group.weightedChange += item.marcap * item.change_pct;
      groups.set(item.sector, group);
    }
    return [...groups].map(([sector, group]) => ({ sector, weight: group.weight, change: group.weightedChange / group.weight })).sort((a, b) => b.weight - a.weight).slice(0, 4);
  }, [items]);
  return <section className="ng-sector-digest" aria-labelledby="ng-sector-digest-h"><div><span className="ng-kicker">S&P 500 / SECTORS</span><h2 id="ng-sector-digest-h">{L("대형 섹터의 방향", "Major sector moves")}</h2><small>{L("제공 지수 비중 가중 등락", "Returns weighted by supplied index weights")}</small></div><div>{sectors.map(sector => <article key={sector.sector}><span>{lang === "ko" ? names[sector.sector] ?? sector.sector : sector.sector}</span><b className={`is-${toneOf(sector.change)}`}>{pct(sector.change)}</b><small>{L("제공 지수 비중", "Supplied index weight")} {sector.weight.toFixed(1)}%</small></article>)}{!sectors.length && <article><span>{L("섹터 데이터 확인 중", "Waiting for sector data")}</span><b>—</b></article>}</div></section>;
}
