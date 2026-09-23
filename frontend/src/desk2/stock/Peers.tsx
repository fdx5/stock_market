import { useEffect, useMemo, useState } from "react";
import { MarketMapItem, api } from "../../api/client";
import { useLanguage } from "../../i18n/LanguageContext";
import { navigate } from "../../router";
import { useMarketSnapshot } from "../../useMarketSnapshot";
import StockLogo from "../../components/StockLogo";
import { Skel } from "../parts";
import { krwPrice, pct, toneOf, usd, usdPrice, useL, won } from "../lib";

/* 동일 업종 비교 — the stock among the companies it is usually compared with.
 *
 * The classic page drew these as a treemap, which answers "how big is everyone" and
 * little else. A reader on a stock page is asking where *this* name stands: is it
 * leading its sector today or lagging it, is it cheap or dear on earnings against
 * its neighbours. So the peers are a table with the stock's own row marked, its rank
 * on size and on today's move spelled out above, and a strip of today's moves drawn
 * across the top in cap order. KR rows are filled out with PER, ROE and foreign
 * ownership from the market snapshot the site already holds. */

export interface PeerSummary {
  sector: string;
  avg: number;
  count: number;
  capRank: number;
  moveRank: number;
}

type SortKey = "cap" | "chg" | "per" | "roe" | "for";

export default function Peers({ code, market, onSummary }: { code: string; market: "KR" | "US"; onSummary?: (s: PeerSummary | null) => void }) {
  const { lang } = useLanguage();
  const L = useL();
  const snap = useMarketSnapshot();
  const [items, setItems] = useState<MarketMapItem[] | null>(null);
  const [sector, setSector] = useState<string | null>(null);
  const [avg, setAvg] = useState(0);
  const [sort, setSort] = useState<SortKey>("cap");

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    const req = market === "KR" ? api.sectorMap(code, 40) : api.usSectorMap(code, 40);
    req
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        setSector(r.sector);
        setAvg(r.avg_change_pct);
      })
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [code, market]);

  const enriched = useMemo(() => {
    if (!items) return null;
    if (market !== "KR") return items;
    const by = new Map([...snap.kospi, ...snap.kosdaq].map((i) => [i.code, i]));
    return items.map((i) => ({ ...by.get(i.code), ...i, per: by.get(i.code)?.per ?? i.per, roe: by.get(i.code)?.roe ?? i.roe, foreign_ratio: by.get(i.code)?.foreign_ratio ?? i.foreign_ratio }));
  }, [items, snap, market]);

  const capOf = (i: MarketMapItem) => (market === "US" ? i.market_cap ?? 0 : i.marcap);

  const summary = useMemo<PeerSummary | null>(() => {
    if (!enriched || !sector || enriched.length === 0) return null;
    const byCap = [...enriched].sort((a, b) => capOf(b) - capOf(a));
    const byMove = [...enriched].sort((a, b) => b.change_pct - a.change_pct);
    const capRank = byCap.findIndex((i) => i.code === code) + 1;
    const moveRank = byMove.findIndex((i) => i.code === code) + 1;
    if (!capRank) return null;
    return { sector, avg, count: enriched.length, capRank, moveRank };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enriched, sector, avg, code]);

  useEffect(() => onSummary?.(summary), [summary, onSummary]);

  if (items === null) return <Skel h={300} />;
  if (!enriched || enriched.length === 0 || !sector) return <p className="d2-empty">{L("비교할 동일 업종 종목이 없습니다.", "No sector peers to compare.")}</p>;

  const key = (i: MarketMapItem): number => {
    switch (sort) {
      case "chg":
        return i.change_pct;
      case "per":
        return i.per ?? -Infinity;
      case "roe":
        return i.roe ?? -Infinity;
      case "for":
        return i.foreign_ratio ?? -Infinity;
      default:
        return capOf(i);
    }
  };
  const rows = [...enriched].sort((a, b) => key(b) - key(a));
  // Ratio columns only when the snapshot actually carries them.
  const hasPer = market === "KR" && enriched.some((i) => i.per != null);
  const hasRoe = market === "KR" && enriched.some((i) => i.roe != null);
  const hasFor = market === "KR" && enriched.some((i) => i.foreign_ratio != null);
  const strip = [...enriched].sort((a, b) => capOf(b) - capOf(a)).slice(0, 24);
  const span = Math.max(0.5, ...strip.map((i) => Math.abs(i.change_pct)));
  const price = (v: number) => (market === "US" ? usdPrice(v) : krwPrice(v, lang));
  const size = (i: MarketMapItem) => (market === "US" ? usd(i.market_cap ?? 0) : won(i.marcap, lang));

  const head = (k: SortKey, label: string) => (
    <th aria-sort={sort === k ? "descending" : undefined}>
      <button type="button" className={sort === k ? "is-sorted" : ""} onClick={() => setSort(k)}>
        {label}
        <i aria-hidden="true">{sort === k ? "↓" : "↕"}</i>
      </button>
    </th>
  );

  return (
    <div className="sk-peers">
      <div className="sk-peers-head">
        <p>
          <b>{sector}</b> · {enriched.length}
          {L("개 종목", " names")} · {L("업종 평균", "sector avg")} <span className={`d2-num is-${toneOf(avg)}`}>{pct(avg)}</span>
        </p>
        {summary && (
          <p className="sk-peers-rank">
            {L("시가총액", "By size")} <b>{summary.capRank}</b>
            {L("위", "")} · {L("오늘 등락", "Today's move")} <b>{summary.moveRank}</b>
            {L("위", "")} / {summary.count}
          </p>
        )}
      </div>

      <div className="sk-peers-strip" role="img" aria-label={L("시가총액 순 동일 업종 오늘 등락률", "Today's move of sector peers, by size")}>
        {strip.map((i) => {
          const h = (Math.abs(i.change_pct) / span) * 100;
          return (
            <button key={i.code} type="button" className={`${i.code === code ? "is-me" : ""} is-${toneOf(i.change_pct)}`} onClick={() => navigate(`/stock/${i.code}`)} title={`${i.name} ${pct(i.change_pct)}`}>
              <span className="sk-peers-col">
                <i style={{ height: `${h / 2}%`, [i.change_pct >= 0 ? "bottom" : "top"]: "50%" }} />
              </span>
              <small>{i.name}</small>
            </button>
          );
        })}
      </div>

      <div className="d2-table-wrap">
        <table className="d2-table">
          <thead>
            <tr>
              <th className="is-name">{L("종목", "Name")}</th>
              <th>{L("현재가", "Price")}</th>
              {head("chg", L("등락률", "Change"))}
              {head("cap", L("시가총액", "Market cap"))}
              {hasPer && head("per", "PER")}
              {hasRoe && head("roe", "ROE")}
              {hasFor && head("for", L("외국인 비율", "Foreign %"))}
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.code} className={i.code === code ? "is-me" : ""}>
                <td className="is-name">
                  <button type="button" onClick={() => navigate(`/stock/${i.code}`)} disabled={i.code === code}>
                    <StockLogo code={i.code} name={i.name} className="d2-table-logo" />
                    {i.name}
                  </button>
                </td>
                <td className="d2-num">{price(i.close)}</td>
                <td className={`d2-num is-${toneOf(i.change_pct)}`}>{pct(i.change_pct)}</td>
                <td className="d2-num">{size(i)}</td>
                {hasPer && <td className="d2-num">{i.per != null ? i.per.toFixed(2) : "—"}</td>}
                {hasRoe && <td className="d2-num">{i.roe != null ? `${i.roe.toFixed(2)}%` : "—"}</td>}
                {hasFor && <td className="d2-num">{i.foreign_ratio != null ? `${i.foreign_ratio.toFixed(2)}%` : "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
