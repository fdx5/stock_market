import { useEffect, useState } from "react";
import { BalanceHistory, BalanceSeriesKey, BalanceUnit } from "../api/client";
import { Lang, useLanguage, useT } from "../i18n/LanguageContext";
import { useBodyScrollLock } from "../useBodyScrollLock";

/* ─────────────────────────── 공매도 수급 (일자별) ───────────────────────────
   Opened from the button beside the 호가 잔량 bar in the stock header. One row per
   published session, newest first, each carrying the figure, its move against the
   previous session, and that move as a rate.

   Which series appear is the backend's call, not this component's: it sends a
   `series` list naming what this stock actually has and a `units` map saying what
   each one counts (see client.ts). So the tab row below is built from the response
   rather than from a hardcoded set, and a figure that gains a source later shows up
   here without a change to this file. */

/* Labels say exactly which figure a column is. 공매도 거래량 and 공매도 잔고 are
   different numbers that move for different reasons — one is a day's selling, the
   other a standing position — and calling either just "공매도" would let a reader
   take one for the other. */
const SERIES_LABEL: Record<BalanceSeriesKey, string> = {
  short_volume: "공매도 거래량",
  short_weight: "공매도 비중",
  short_value: "공매도 거래대금",
  uptick_applied: "업틱룰 적용",
  uptick_exempt: "업틱룰 예외",
  loan: "대차잔고",
  short_balance: "공매도잔고",
  credit: "신용융자잔고",
};

/** What the number counts, spelled out under the tab — including the unit, which the
 * figures alone don't say. */
const SERIES_NOTE: Record<BalanceSeriesKey, string> = {
  short_volume: "그날 공매도로 체결된 수량(주). 쌓여 있는 잔고가 아니라 하루치 거래입니다.",
  short_weight: "그날 전체 거래량에서 공매도가 차지한 비율(%).",
  short_value: "그날 공매도로 체결된 금액(원).",
  uptick_applied: "직전가 이하 호가를 금지하는 업틱룰이 적용된 공매도 수량(주).",
  uptick_exempt: "차익거래·헤지 등으로 업틱룰이 면제된 공매도 수량(주).",
  loan: "기관이 빌려간 주식 잔고(주). 공매도의 선행지표로 읽습니다.",
  short_balance: "공매도 미상환 잔고(주).",
  credit: "개인이 증권사에서 빌려 산 잔고(주).",
};

/** 거래대금 on a 대형주 runs to twelve digits, which would push this four-column table
 * into a horizontal scroll on every phone. Compacted on the same 조/억/만 (and T/B/M)
 * scale `DailyPricePanel` uses, so a won figure reads the same wherever it appears.
 * The rate column stays exact regardless — the backend computes it from the full
 * figures, not from what is displayed. */
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
  // A dash, not 0 — a session that published no figure is not a session that
  // published zero, and on these figures those read very differently.
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
  // "2026-07-29" -> "07.29" plus the weekday-free year only when it changes would be
  // cleverer than useful in a 60-row list; the full date stays scannable.
  return date.replace(/-/g, ".").slice(2);
}

/** `history` is passed in rather than fetched here: the button that opens this had to
 * load it already to know whether it should render at all (a stock with no published
 * 공매도 gets no button), so fetching again would be a second request for bytes the
 * opener is holding. It also means the table is populated on the first frame. */
export default function BalanceHistoryModal({
  history,
  name,
  onClose,
}: {
  history: BalanceHistory;
  name: string;
  onClose: () => void;
}) {
  const t = useT();
  const { lang } = useLanguage();
  const [active, setActive] = useState<BalanceSeriesKey | null>(history.series[0] ?? null);
  useBodyScrollLock(true);

  // Escape closes, matching every other modal in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const series = history.series;
  const rows = history.items;
  const units = history.units;
  // One heading for the panel, with the per-series names carried by the tabs below.
  // Listing all of them here instead — which is what this did while there were only
  // going to be two or three — now spells out five labels in a title bar.
  const heading = t("공매도 수급");

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal balance-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${name} ${heading}`}
      >
        <header className="balance-modal-head">
          <div>
            <h2 className="balance-modal-title">{heading}</h2>
            <p className="balance-modal-sub">{name}</p>
          </div>
          <button type="button" className="balance-modal-close" onClick={onClose} aria-label={t("닫기")}>
            ×
          </button>
        </header>

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
                {/* Named for the active series, so the column never says "수량" over
                    a run of 거래대금 or 비중 figures. */}
                <th scope="col">{active ? t(SERIES_LABEL[active]) : t("수량")}</th>
                <th scope="col">{t("전일 대비")}</th>
                <th scope="col">{t("증감률")}</th>
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
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>

          {rows.length === 0 && <div className="balance-empty">{t("공시된 공매도 데이터가 없습니다.")}</div>}
        </div>
      </div>
    </div>
  );
}
