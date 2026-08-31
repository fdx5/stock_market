import { useEffect, useState } from "react";
import { BalanceHistory, BalanceSeriesKey, BalanceUnit, api } from "../api/client";
import { Lang, useLanguage, useT } from "../i18n/LanguageContext";

/* ─────────────────────────── 공매도 수급 (일자별) ───────────────────────────
   The side panel's last tab, to the right of 호가. One row per published session,
   newest first, each carrying the figure, its move against the previous session, and
   that move as a rate.

   Which series appear is the backend's call, not this component's: it sends a `series`
   list naming what this stock actually has and a `units` map saying what each one
   counts (see client.ts). So the series tabs below are built from the response rather
   than from a hardcoded set — 공매도 comes from KRX and 대차잔고 from SEIBro, so one
   upstream going quiet drops its own tab and leaves the rest. */

/* Labels say exactly which figure a column is. 공매도 거래량 and 공매도 잔고 are
   different numbers that move for different reasons — one is a day's selling, the
   other a standing position — and calling either just "공매도" would let a reader take
   one for the other. */
const SERIES_LABEL: Record<BalanceSeriesKey, string> = {
  short_volume: "공매도 거래량",
  short_weight: "공매도 비중",
  short_value: "공매도 거래대금",
  loan: "대차잔고",
  uptick_applied: "업틱룰 적용",
  uptick_exempt: "업틱룰 예외",
  short_balance: "공매도잔고",
  credit: "신용융자잔고",
};

/** What the number counts, spelled out under the tabs — including the unit, which the
 * figures alone don't say. */
const SERIES_NOTE: Record<BalanceSeriesKey, string> = {
  short_volume: "그날 공매도로 체결된 수량(주). 쌓여 있는 잔고가 아니라 하루치 거래입니다.",
  short_weight: "그날 전체 거래량에서 공매도가 차지한 비율(%).",
  short_value: "그날 공매도로 체결된 금액(원).",
  loan: "기관이 빌려간 주식 잔고(주). 공매도의 선행지표로 읽습니다.",
  uptick_applied: "직전가 이하 호가를 금지하는 업틱룰이 적용된 공매도 수량(주).",
  uptick_exempt: "차익거래·헤지 등으로 업틱룰이 면제된 공매도 수량(주).",
  short_balance: "공매도 미상환 잔고(주).",
  credit: "개인이 증권사에서 빌려 산 잔고(주).",
};

/** 거래대금 on a 대형주 runs to twelve digits, which would push this four-column table
 * into a horizontal scroll inside a side rail. Compacted on the same 조/억/만 (and
 * T/B/M) scale `DailyPricePanel` uses, so a won figure reads the same wherever it
 * appears. The rate column stays exact regardless — the backend computes it from the
 * full figures, not from what is displayed. */
function compactKrw(value: number, lang: Lang): string {
  if (lang === "en") {
    if (value >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    return Math.round(value).toLocaleString();
  }
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}조`;
  if (value >= 1e8) return `${Math.round(value / 1e8).toLocaleString()}억`;
  if (value >= 1e4) return `${Math.round(value / 1e4).toLocaleString()}만`;
  return Math.round(value).toLocaleString();
}

/** Grouped integers for share counts, a compacted amount for won, two decimals for a
 * ratio — the same figure formatted as a count would read 1 where the source said 1.21. */
function formatQty(value: number | null, unit: BalanceUnit | undefined, lang: Lang): string {
  // A dash, not 0 — a session that published no figure is not a session that published
  // zero, and on these figures those read very differently.
  if (value === null) return "—";
  if (unit === "%") return `${value.toFixed(2)}%`;
  if (unit === "원") return compactKrw(value, lang);
  return value.toLocaleString();
}

function formatChange(value: number | null, unit: BalanceUnit | undefined, lang: Lang): string {
  if (value === null) return "—";
  // "%p", not "%": the move on a ratio is percentage points, and writing it as a
  // percentage would claim a relative change the number isn't.
  const suffix = unit === "%" ? "%p" : "";
  if (value === 0) return `0${suffix}`;
  const size =
    unit === "%"
      ? Math.abs(value).toFixed(2)
      : unit === "원"
        ? compactKrw(Math.abs(value), lang)
        : Math.abs(value).toLocaleString();
  return `${value > 0 ? "+" : "−"}${size}${suffix}`;
}

function formatPct(value: number | null): string {
  if (value === null) return "—";
  if (value === 0) return "0.00%";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}%`;
}

/** Up/down/flat, on the same vocabulary the rest of the app colours moves with.
 * Deliberately NOT inverted for these series: this table states what the figure did,
 * and reading "more short selling is bearish" is the reader's to make. */
function dirClass(value: number | null): string {
  if (value === null || value === 0) return "change-flat";
  return value > 0 ? "change-up" : "change-down";
}

function formatDate(date: string): string {
  // "2026-07-29" -> "26.07.29" — the full date stays scannable in a 60-row list, where
  // showing the year only when it changes would be cleverer than useful.
  return date.replace(/-/g, ".").slice(2);
}

type ExtraColumn = { label: string; value: (row: BalanceHistory["items"][number]) => string };

function raw(row: BalanceHistory["items"][number], key: BalanceSeriesKey): number | null {
  return row[key]?.value ?? null;
}

function extraColumns(active: BalanceSeriesKey | null, lang: Lang): ExtraColumn[] {
  const totalVolume = (row: BalanceHistory["items"][number]) => {
    const volume = raw(row, "short_volume");
    const weight = raw(row, "short_weight");
    return volume != null && weight ? volume / (weight / 100) : null;
  };
  const avgShortPrice = (row: BalanceHistory["items"][number]) => {
    const value = raw(row, "short_value");
    const volume = raw(row, "short_volume");
    return value != null && volume ? value / volume : null;
  };
  const exceptionShare = (row: BalanceHistory["items"][number]) => {
    const exempt = raw(row, "uptick_exempt");
    const volume = raw(row, "short_volume");
    return exempt != null && volume ? (exempt / volume) * 100 : null;
  };
  const loanTurnover = (row: BalanceHistory["items"][number]) => {
    const volume = raw(row, "short_volume");
    const loan = raw(row, "loan");
    return volume != null && loan ? (volume / loan) * 100 : null;
  };
  const count = (value: number | null) => value == null ? "—" : Math.round(value).toLocaleString();
  const won = (value: number | null) => value == null ? "—" : `${Math.round(value).toLocaleString()}원`;
  const ratio = (value: number | null) => value == null ? "—" : `${value.toFixed(2)}%`;

  if (active === "short_volume" || active === "short_weight" || active === "short_value") return [
    { label: "전체 거래량", value: row => count(totalVolume(row)) },
    { label: "공매도 평균가", value: row => won(avgShortPrice(row)) },
    { label: "업틱 예외 비중", value: row => ratio(exceptionShare(row)) },
  ];
  if (active === "uptick_applied" || active === "uptick_exempt") return [
    { label: "공매도 거래량", value: row => count(raw(row, "short_volume")) },
    { label: "예외 비중", value: row => ratio(exceptionShare(row)) },
    { label: "공매도 거래대금", value: row => formatQty(raw(row, "short_value"), "원", lang) },
  ];
  if (active === "loan") return [
    { label: "당일 공매도", value: row => count(raw(row, "short_volume")) },
    { label: "잔고 대비 공매도", value: row => ratio(loanTurnover(row)) },
    { label: "공매도 비중", value: row => ratio(raw(row, "short_weight")) },
  ];
  return [];
}

export default function ShortSellPanel({ code }: { code: string }) {
  const t = useT();
  const { lang } = useLanguage();
  const [history, setHistory] = useState<BalanceHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Null until the response names its series, rather than a guessed default: which
  // series exist is the backend's answer, so there is nothing to preselect before it.
  const [active, setActive] = useState<BalanceSeriesKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setError(null);
    setActive(null);

    api
      .balanceHistory(code)
      .then((res) => {
        if (cancelled) return;
        setHistory(res);
        setActive(res.series[0] ?? null);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || "공매도 데이터를 가져오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) return <div className="orderbook-status error-state">{t(error)}</div>;
  if (!history) return <div className="orderbook-status">{t("불러오는 중...")}</div>;

  const { series, items: rows, units } = history;
  const extras = extraColumns(active, lang);
  if (rows.length === 0) {
    return <div className="balance-empty">{t("공시된 공매도 데이터가 없습니다.")}</div>;
  }

  return (
    <div className="shortsell-panel">
      {/* One tab per series the backend actually has for this stock. A single series
          renders as a caption instead of a lone tab, which would look like a control
          that does nothing. */}
      {series.length > 1 && (
        <div className="balance-tabs" role="tablist">
          {series.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={key === active}
              className={`balance-tab${key === active ? " is-active" : ""}`}
              onClick={() => setActive(key)}
            >
              {t(SERIES_LABEL[key])}
            </button>
          ))}
        </div>
      )}
      {active && <p className="balance-note">{t(SERIES_NOTE[active])}</p>}

      <div className="balance-scroll">
        <table className="balance-table">
          <thead>
            <tr>
              <th scope="col">{t("일자")}</th>
              {/* Named for the active series, so the column never says "수량" over a
                  run of 거래대금 or 비중 figures. */}
              <th scope="col">{active ? t(SERIES_LABEL[active]) : t("수량")}</th>
              <th scope="col">{t("전일 대비")}</th>
              <th scope="col">{t("증감률")}</th>
              {extras.map((column) => <th scope="col" key={column.label}>{column.label}</th>)}
            </tr>
          </thead>
          {active && (
            <tbody>
              {rows.map((row) => {
                const figure = row[active];
                const unit = units[active];
                return (
                  <tr key={row.date} className="balance-row">
                    <td className="balance-date">{formatDate(row.date)}</td>
                    <td className="balance-value">{formatQty(figure?.value ?? null, unit, lang)}</td>
                    <td className={`balance-change ${dirClass(figure?.change ?? null)}`}>
                      {formatChange(figure?.change ?? null, unit, lang)}
                    </td>
                    <td className={`balance-change ${dirClass(figure?.change ?? null)}`}>
                      {formatPct(figure?.change_pct ?? null)}
                    </td>
                    {extras.map((column) => <td className="balance-context" key={column.label}>{column.value(row)}</td>)}
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
