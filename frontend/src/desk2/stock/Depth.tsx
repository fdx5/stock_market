import { useEffect, useState } from "react";
import { BalanceHistory, BalanceSeriesKey, BalanceUnit, OrderBook, api } from "../../api/client";
import { useLanguage } from "../../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../../pollVisibility";
import { Marker, Skel } from "../parts";
import { useL } from "../lib";

/* 호가 and 공매도·대차 — the two panels about positioning rather than price.
 *
 * The order book is the same ten-level ladder the classic page drew, re-set as a
 * printed quote board with the balance between the two sides spelled out on top
 * (매수 잔량 비중), because that ratio is the one thing a reader takes from a ladder.
 *
 * The 공매도 panel keeps the classic panel's rules exactly: which series exist is
 * the backend's answer (KRX for 공매도, SEIBro for 대차 — either can be missing on its
 * own), each series carries its own unit, and the derived columns — total volume,
 * average short price, uptick-exempt share, loan turnover — are computed from the
 * same row, never estimated across rows. */

const BOOK_POLL_MS = 15_000;

export function OrderBookLadder({ code }: { code: string }) {
  const L = useL();
  const [book, setBook] = useState<OrderBook | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBook(null);
    setError(null);
    const load = () =>
      api
        .orderbook(code)
        .then((b) => {
          if (cancelled) return;
          setBook(b);
          setError(null);
        })
        .catch((e: Error) => !cancelled && setError(e.message || L("호가를 불러오지 못했습니다.", "Could not load the order book.")));
    load();
    const stop = startVisibilityAwareInterval(load, BOOK_POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (error) return <p className="d2-empty">{error}</p>;
  if (!book) return <Skel h={320} />;
  if (!book.available) return <p className="d2-empty">{L("휴장 중에는 호가가 제공되지 않습니다.", "No order book while the market is closed.")}</p>;

  const max = Math.max(1, ...book.asks.map((l) => l.qty), ...book.bids.map((l) => l.qty));
  const total = book.total_ask_qty + book.total_bid_qty || 1;
  const bidShare = (book.total_bid_qty / total) * 100;

  return (
    <div className="sk-book">
      <div className="sk-book-balance">
        <span className="is-down">
          {L("매도", "Asks")} {(100 - bidShare).toFixed(0)}%
        </span>
        <div className="sk-book-balance-bar" aria-hidden="true">
          <i style={{ width: `${100 - bidShare}%` }} />
        </div>
        <span className="is-up">
          {L("매수", "Bids")} {bidShare.toFixed(0)}%
        </span>
      </div>
      <table className="sk-book-table">
        <thead>
          <tr>
            <th>{L("매도 잔량", "Ask size")}</th>
            <th>{L("호가", "Price")}</th>
            <th>{L("매수 잔량", "Bid size")}</th>
          </tr>
        </thead>
        <tbody>
          {book.asks.map((l) => (
            <tr key={`a${l.price}`} className="is-ask">
              <td className="sk-book-q">
                <i style={{ width: `${(l.qty / max) * 100}%` }} />
                <span>{l.qty.toLocaleString()}</span>
              </td>
              <td className="sk-book-p">{l.price.toLocaleString()}</td>
              <td />
            </tr>
          ))}
          {book.bids.map((l) => (
            <tr key={`b${l.price}`} className="is-bid">
              <td />
              <td className="sk-book-p">{l.price.toLocaleString()}</td>
              <td className="sk-book-q">
                <i style={{ width: `${(l.qty / max) * 100}%` }} />
                <span>{l.qty.toLocaleString()}</span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>{book.total_ask_qty.toLocaleString()}</td>
            <td>{L("잔량 합계", "Totals")}</td>
            <td>{book.total_bid_qty.toLocaleString()}</td>
          </tr>
        </tfoot>
      </table>
      <p className="sk-note">{L(`${book.delayed_minutes || 20}분 지연 시세 · 15초마다 갱신`, `Delayed ${book.delayed_minutes || 20} min · refreshed every 15s`)}</p>
    </div>
  );
}

/* ── 공매도 · 대차 ─────────────────────────────────────────────────────────── */

const LABEL: Record<BalanceSeriesKey, [string, string]> = {
  short_volume: ["공매도 거래량", "Short volume"],
  short_weight: ["공매도 비중", "Short share"],
  short_value: ["공매도 거래대금", "Short value"],
  loan: ["대차잔고", "Loan balance"],
  uptick_applied: ["업틱룰 적용", "Uptick-rule shorts"],
  uptick_exempt: ["업틱룰 예외", "Uptick-exempt shorts"],
  short_balance: ["공매도잔고", "Short balance"],
  credit: ["신용융자잔고", "Margin balance"],
};

const NOTE: Record<BalanceSeriesKey, [string, string]> = {
  short_volume: ["그날 공매도로 체결된 수량(주). 쌓인 잔고가 아니라 하루치 거래입니다.", "Shares sold short that day — a day's trading, not a standing balance."],
  short_weight: ["그날 전체 거래량에서 공매도가 차지한 비율(%).", "Short selling as a share of the day's volume."],
  short_value: ["그날 공매도로 체결된 금액(원).", "Value sold short that day (KRW)."],
  loan: ["기관이 빌려간 주식 잔고(주). 공매도의 선행지표로 읽습니다.", "Shares on loan to institutions — read as a lead on short selling."],
  uptick_applied: ["직전가 이하 호가를 금지하는 업틱룰이 적용된 공매도 수량(주).", "Short volume under the uptick rule."],
  uptick_exempt: ["차익거래·헤지 등으로 업틱룰이 면제된 공매도 수량(주).", "Short volume exempt from the uptick rule (arbitrage, hedging)."],
  short_balance: ["공매도 미상환 잔고(주).", "Outstanding short position."],
  credit: ["개인이 증권사에서 빌려 산 잔고(주).", "Shares bought on margin."],
};

type Row = BalanceHistory["items"][number];

function compactKrw(v: number, en: boolean): string {
  if (en) {
    if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    return Math.round(v).toLocaleString();
  }
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}조`;
  if (v >= 1e8) return `${Math.round(v / 1e8).toLocaleString()}억`;
  if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}만`;
  return Math.round(v).toLocaleString();
}

const qty = (v: number | null, unit: BalanceUnit | undefined, en: boolean) =>
  v === null ? "—" : unit === "%" ? `${v.toFixed(2)}%` : unit === "원" ? compactKrw(v, en) : v.toLocaleString();

function delta(v: number | null, unit: BalanceUnit | undefined, en: boolean): string {
  if (v === null) return "—";
  const suffix = unit === "%" ? "%p" : "";
  if (v === 0) return `0${suffix}`;
  const size = unit === "%" ? Math.abs(v).toFixed(2) : unit === "원" ? compactKrw(Math.abs(v), en) : Math.abs(v).toLocaleString();
  return `${v > 0 ? "+" : "−"}${size}${suffix}`;
}

const raw = (r: Row, k: BalanceSeriesKey) => r[k]?.value ?? null;

function extras(active: BalanceSeriesKey | null, en: boolean): { label: string; value: (r: Row) => string }[] {
  const count = (v: number | null) => (v == null ? "—" : Math.round(v).toLocaleString());
  const ratio = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)}%`);
  const won = (v: number | null) => (v == null ? "—" : en ? `₩${Math.round(v).toLocaleString()}` : `${Math.round(v).toLocaleString()}원`);
  const total = (r: Row) => {
    const v = raw(r, "short_volume");
    const w = raw(r, "short_weight");
    return v != null && w ? v / (w / 100) : null;
  };
  const avg = (r: Row) => {
    const val = raw(r, "short_value");
    const v = raw(r, "short_volume");
    return val != null && v ? val / v : null;
  };
  const exempt = (r: Row) => {
    const e = raw(r, "uptick_exempt");
    const v = raw(r, "short_volume");
    return e != null && v ? (e / v) * 100 : null;
  };
  const turnover = (r: Row) => {
    const v = raw(r, "short_volume");
    const l = raw(r, "loan");
    return v != null && l ? (v / l) * 100 : null;
  };
  const t = (ko: string, e: string) => (en ? e : ko);
  if (active === "short_volume" || active === "short_weight" || active === "short_value")
    return [
      { label: t("전체 거래량", "Total volume"), value: (r) => count(total(r)) },
      { label: t("공매도 평균가", "Avg short price"), value: (r) => won(avg(r)) },
      { label: t("업틱 예외 비중", "Exempt share"), value: (r) => ratio(exempt(r)) },
    ];
  if (active === "uptick_applied" || active === "uptick_exempt")
    return [
      { label: t("공매도 거래량", "Short volume"), value: (r) => count(raw(r, "short_volume")) },
      { label: t("예외 비중", "Exempt share"), value: (r) => ratio(exempt(r)) },
      { label: t("공매도 거래대금", "Short value"), value: (r) => qty(raw(r, "short_value"), "원", en) },
    ];
  if (active === "loan")
    return [
      { label: t("당일 공매도", "Day's shorts"), value: (r) => count(raw(r, "short_volume")) },
      { label: t("잔고 대비 공매도", "Shorts / loans"), value: (r) => ratio(turnover(r)) },
      { label: t("공매도 비중", "Short share"), value: (r) => ratio(raw(r, "short_weight")) },
    ];
  return [];
}

export function ShortInterest({ code }: { code: string }) {
  const { lang } = useLanguage();
  const en = lang === "en";
  const L = useL();
  const [history, setHistory] = useState<BalanceHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<BalanceSeriesKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setError(null);
    setActive(null);
    api
      .balanceHistory(code)
      .then((h) => {
        if (cancelled) return;
        setHistory(h);
        setActive(h.series[0] ?? null);
      })
      .catch((e: Error) => !cancelled && setError(e.message || L("공매도 데이터를 불러오지 못했습니다.", "Could not load short-selling data.")));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (error) return <p className="d2-empty">{error}</p>;
  if (!history) return <Skel h={280} />;
  if (history.items.length === 0) return <p className="d2-empty">{L("공시된 공매도 데이터가 없습니다.", "No published short-selling data.")}</p>;

  const cols = extras(active, en);
  const unit = active ? history.units[active] : undefined;
  const values = active ? history.items.map((r) => r[active]?.value ?? 0) : [];
  const vmax = Math.max(1, ...values);

  return (
    <div className="sk-short">
      {history.series.length > 1 && active && (
        <Marker
          options={history.series.map((k) => ({ id: k, label: L(LABEL[k][0], LABEL[k][1]) }))}
          value={active}
          onChange={setActive}
          label={L("공매도 계열", "Series")}
        />
      )}
      {active && <p className="sk-note">{L(NOTE[active][0], NOTE[active][1])}</p>}
      <div className="d2-table-wrap">
        <table className="d2-table">
          <thead>
            <tr>
              <th className="is-name">{L("일자", "Date")}</th>
              <th>{active ? L(LABEL[active][0], LABEL[active][1]) : L("수량", "Value")}</th>
              <th aria-hidden="true" />
              <th>{L("전일 대비", "Change")}</th>
              <th>{L("증감률", "Change %")}</th>
              {cols.map((c) => (
                <th key={c.label}>{c.label}</th>
              ))}
            </tr>
          </thead>
          {active && (
            <tbody>
              {history.items.map((r) => {
                const f = r[active];
                const ch = f?.change ?? null;
                const tone = ch == null || ch === 0 ? "flat" : ch > 0 ? "up" : "down";
                return (
                  <tr key={r.date}>
                    <td className="is-name d2-num">{r.date.replace(/-/g, ".").slice(2)}</td>
                    <td className="d2-num">{qty(f?.value ?? null, unit, en)}</td>
                    <td className="sk-hbar" aria-hidden="true">
                      <i style={{ width: `${((f?.value ?? 0) / vmax) * 100}%` }} />
                    </td>
                    <td className={`d2-num is-${tone}`}>{delta(ch, unit, en)}</td>
                    <td className={`d2-num is-${tone}`}>
                      {f?.change_pct == null ? "—" : `${f.change_pct > 0 ? "+" : f.change_pct < 0 ? "−" : ""}${Math.abs(f.change_pct).toFixed(2)}%`}
                    </td>
                    {cols.map((c) => (
                      <td key={c.label} className="d2-num sk-muted">
                        {c.value(r)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          )}
        </table>
      </div>
    </div>
  );
}
