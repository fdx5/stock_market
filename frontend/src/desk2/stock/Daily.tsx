import { useCallback, useEffect, useRef, useState } from "react";
import { DailyPricePoint, api } from "../../api/client";
import { useLanguage } from "../../i18n/LanguageContext";
import { Skel } from "../parts";
import { pct, shares, toneOf, usd, useL, won } from "../lib";

/* 일별 시세 — the paper's stock table for one name, one session a row.
 *
 * The classic panel squeezed eight figures into four columns because it lived in a
 * side rail; here it has the page's width, so every figure gets its own column and a
 * session reads in one line. Twenty rows at a time with 더 보기, as before. 거래대금
 * is an estimate (volume × typical price) — no free feed publishes the exchange's
 * own per-session figure — and the table says so under itself. */

const PAGE = 20;

export default function Daily({ code, market }: { code: string; market: "KR" | "US" }) {
  const { lang } = useLanguage();
  const L = useL();
  const [rows, setRows] = useState<DailyPricePoint[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef(code);

  const fetchPage = useCallback((offset: number) => (market === "US" ? api.usDailyPrices(code, offset, PAGE) : api.dailyPrices(code, offset, PAGE)), [code, market]);

  useEffect(() => {
    codeRef.current = code;
    let cancelled = false;
    setRows([]);
    setLoading(true);
    setError(null);
    fetchPage(0)
      .then((r) => {
        if (cancelled) return;
        setRows(r.items);
        setHasMore(r.has_more);
      })
      .catch((e: Error) => !cancelled && setError(e.message || L("일별 시세를 불러오지 못했습니다.", "Could not load daily prices.")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPage, code]);

  const loadMore = () => {
    if (more || !hasMore) return;
    const asked = codeRef.current;
    setMore(true);
    fetchPage(rows.length)
      .then((r) => {
        if (codeRef.current !== asked) return;
        setRows((p) => [...p, ...r.items]);
        setHasMore(r.has_more);
      })
      .catch(() => {})
      .finally(() => setMore(false));
  };

  if (loading) return <Skel h={360} />;
  if (error) return <p className="d2-empty">{error}</p>;
  if (rows.length === 0) return <p className="d2-empty">{L("일별 시세가 없습니다.", "No daily prices.")}</p>;

  const p = (v: number) => (market === "US" ? v.toFixed(2) : Math.round(v).toLocaleString());
  const money = (v: number) => (market === "US" ? usd(v) : won(v, lang));

  return (
    <div className="sk-daily">
      <div className="d2-table-wrap">
        <table className="d2-table">
          <thead>
            <tr>
              <th className="is-name">{L("일자", "Date")}</th>
              <th>{L("종가", "Close")}</th>
              <th>{L("대비", "Change")}</th>
              <th>{L("등락률", "Change %")}</th>
              <th>{L("시가", "Open")}</th>
              <th>{L("고가", "High")}</th>
              <th>{L("저가", "Low")}</th>
              <th>{L("거래량", "Volume")}</th>
              <th>{L("거래대금", "Value")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date}>
                <td className="is-name d2-num" title={r.date}>
                  {r.date.slice(2).replace(/-/g, ".")}
                </td>
                <td className="d2-num sk-strong">{p(r.close)}</td>
                <td className={`d2-num is-${toneOf(r.change)}`}>
                  {r.change > 0 ? "▲" : r.change < 0 ? "▼" : ""}
                  {p(Math.abs(r.change))}
                </td>
                <td className={`d2-num is-${toneOf(r.change_pct)}`}>{pct(r.change_pct)}</td>
                <td className="d2-num">{p(r.open)}</td>
                <td className="d2-num is-up">{p(r.high)}</td>
                <td className="d2-num is-down">{p(r.low)}</td>
                <td className="d2-num">{shares(r.volume, lang)}</td>
                <td className="d2-num">{money(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sk-daily-foot">
        <p className="sk-note">{L("거래대금은 거래량 × 평균가로 추정한 값입니다.", "Value is estimated as volume × average price.")}</p>
        {hasMore && (
          <button type="button" className="sk-button" onClick={loadMore} disabled={more}>
            {more ? L("불러오는 중…", "Loading…") : L(`${PAGE}거래일 더 보기`, `${PAGE} more sessions`)}
          </button>
        )}
      </div>
    </div>
  );
}
