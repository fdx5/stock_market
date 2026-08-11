import {
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  LineSeries,
  LineStyle,
  MouseEventParams,
  Time,
  createChart,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { DramHistoryResponse, api } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import { Link } from "../router";
import { getThemeColors, useThemeMode } from "../theme";
import { useDocumentTitle } from "../useDocumentTitle";
import Footer from "./Footer";
import LanguageToggle from "./LanguageToggle";
import ThemeToggle from "./ThemeToggle";

/** How the seven series are put on one axis.
 *
 * They are all USD prices of DRAM chips, so a single shared axis is the honest
 * encoding — but the recorded items span roughly $4 to $87, and on a linear axis that
 * flattens the cheap ones into a line along the floor where their movement cannot be
 * read at all. "지수" rebases every series to 100 at the first date in view, which is
 * the standard answer for same-unit series of different magnitude: still one axis,
 * still one scale, but the quantity being compared becomes relative change.
 *
 * Two charts side by side would be the alternative. It is worse here: the question the
 * page exists to answer — which items are moving, and together or apart — is a
 * comparison, and a comparison split across two plots is not one. */
type Mode = "price" | "index";

const RANGES = [30, 90, 365, 0] as const;
type Range = (typeof RANGES)[number];

const RANGE_LABEL: Record<Range, string> = {
  30: "1개월",
  90: "3개월",
  365: "1년",
  0: "전체",
};

/** `2026-08-11` → a lightweight-charts business day. The series are daily prints with
 * no intraday component, so the whole-day form is what the time scale should snap to;
 * feeding it a timestamp instead puts ticks at midnight UTC, which renders as the
 * previous day for a reader in Seoul. */
function toBusinessDay(isoDate: string): Time {
  const [year, month, day] = isoDate.split("-").map(Number);
  return { year, month, day } as Time;
}

function formatUsd(value: number): string {
  // Three decimals because the cheapest item trades near $4.2 and moves in thousandths
  // — rounding to cents would render several days as an unchanged number.
  return `$${value.toFixed(3)}`;
}

function formatSignedPct(value: number | null): string {
  if (value == null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function DramPriceHistoryPage() {
  const t = useT();
  useDocumentTitle("K-Stock Hub");
  // Read so a theme switch re-runs the chart effect below — the colors come from
  // getThemeColors(), which is not reactive on its own.
  const themeMode = useThemeMode();

  const [data, setData] = useState<DramHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("price");
  const [range, setRange] = useState<Range>(0);
  // Item name → shown. Absent means shown; only explicit hides are recorded, so an
  // item TrendForce adds later appears without anyone having to opt it in.
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [hovered, setHovered] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .dramPriceHistory()
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || "데이터를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Colour is bound to the item's position in the source order, which is TrendForce's
   * own table order (DDR5 → DDR4 → DDR3) — never to its position among the *visible*
   * series. Hiding a line must not repaint the ones that remain, or the reader's
   * memory of "the orange one" is invalidated by their own filter click. */
  const colorOf = useMemo(() => {
    const colors = getThemeColors();
    const byName = new Map<string, string>();
    data?.items.forEach((item, i) => {
      byName.set(item.item_name, colors.series[i % colors.series.length]);
    });
    return byName;
    // themeMode is the real dependency — getThemeColors() reads the current mode.
  }, [data, themeMode]);

  /** The series actually plotted: range-clipped, hidden items dropped, and rebased
   * when the mode asks for it. Rebasing happens after clipping so "지수" always means
   * "relative to the start of what is on screen" rather than to a date scrolled out
   * of view. */
  const plotted = useMemo(() => {
    if (!data) return [];
    const cutoff =
      range === 0 ? null : data.dates.length > range ? data.dates[data.dates.length - range] : null;
    return data.items
      .filter((item) => !hidden[item.item_name])
      .map((item) => {
        const points = cutoff ? item.points.filter((p) => p.price_date >= cutoff) : item.points;
        const base = points[0]?.price;
        return {
          item_name: item.item_name,
          points,
          values: points.map((p) => ({
            date: p.price_date,
            value: mode === "index" && base ? (p.price / base) * 100 : p.price,
            price: p.price,
            change_pct: p.change_pct,
          })),
        };
      })
      .filter((s) => s.values.length > 0);
  }, [data, hidden, mode, range]);

  useEffect(() => {
    if (!containerRef.current || plotted.length === 0) return;
    const colors = getThemeColors();

    const chart = createChart(containerRef.current, {
      height: 420,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: colors.textSecondary,
        attributionLogo: false,
      },
      // Recessive chrome: the gridlines exist to let a value be read off the axis, not
      // to be looked at.
      grid: {
        vertLines: { color: colors.gridline },
        horzLines: { color: colors.gridline },
      },
      rightPriceScale: { borderColor: colors.baseline },
      timeScale: { borderColor: colors.baseline, fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: colors.textMuted, width: 1, style: LineStyle.Dashed, labelVisible: true },
        horzLine: { color: colors.textMuted, width: 1, style: LineStyle.Dashed },
      },
      localization: {
        priceFormatter: (v: number) => (mode === "index" ? v.toFixed(1) : formatUsd(v)),
      },
    });
    chartRef.current = chart;

    const handles: ISeriesApi<"Line">[] = [];
    for (const s of plotted) {
      const series = chart.addSeries(LineSeries, {
        color: colorOf.get(s.item_name) ?? colors.blue,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        // Points, not just the line: seven prints is a short series, and without
        // markers a reader cannot tell an actual daily print from interpolation.
        pointMarkersVisible: s.values.length <= 40,
        pointMarkersRadius: 3,
      });
      series.setData(s.values.map((v) => ({ time: toBusinessDay(v.date), value: v.value })));
      handles.push(series);
    }

    // The index mode's reference line. Drawn as a series option on the first line so it
    // lands behind the data rather than over it.
    if (mode === "index" && handles[0]) {
      handles[0].createPriceLine({
        price: 100,
        color: colors.baseline,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: false,
        title: "",
      });
    }

    chart.timeScale().fitContent();

    // The hover layer. With seven lines on one axis, "what was each of these on the
    // 6th" is the question the chart exists to answer, and the crosshair alone answers
    // it for one line at a time. Every visible series is listed at the hovered date,
    // ordered by value so the reader's eye lands where the lines are.
    const onCrosshairMove = (param: MouseEventParams) => {
      const tip = tooltipRef.current;
      const container = containerRef.current;
      if (!tip || !container) return;

      if (!param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
        tip.style.display = "none";
        return;
      }

      const time = param.time as { year: number; month: number; day: number };
      const dateLabel = `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;

      const rows = plotted
        .map((s, i) => {
          const point = param.seriesData.get(handles[i]) as { value?: number } | undefined;
          if (point?.value == null) return null;
          // Looked up by date, not by matching the plotted value back to a point: a
          // series that printed the same number twice would otherwise show the first
          // occurrence's underlying price against the second occurrence's date.
          const actual = s.values.find((v) => v.date === dateLabel);
          return {
            name: s.item_name,
            value: point.value,
            price: actual?.price ?? null,
            color: colorOf.get(s.item_name) ?? colors.blue,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => b.value - a.value);

      if (rows.length === 0) {
        tip.style.display = "none";
        return;
      }

      // Built as DOM nodes rather than an HTML string: the item names come from a
      // scraped upstream table, and innerHTML would make that table a script vector.
      tip.replaceChildren();
      const head = document.createElement("div");
      head.className = "dram-hist-tip-date";
      head.textContent = dateLabel;
      tip.appendChild(head);
      for (const row of rows) {
        const line = document.createElement("div");
        line.className = "dram-hist-tip-row";
        const swatch = document.createElement("span");
        swatch.className = "dram-hist-tip-swatch";
        swatch.style.background = row.color;
        const name = document.createElement("span");
        name.className = "dram-hist-tip-name";
        name.textContent = row.name;
        const value = document.createElement("span");
        value.className = "dram-hist-tip-value";
        value.textContent =
          mode === "index"
            ? `${row.value.toFixed(1)}${row.price != null ? ` (${formatUsd(row.price)})` : ""}`
            : formatUsd(row.value);
        line.append(swatch, name, value);
        tip.appendChild(line);
      }

      tip.style.display = "block";
      // Flip to the other side of the cursor near the right edge so the tooltip is
      // never clipped by the card.
      const width = tip.offsetWidth;
      const left = param.point.x + 16 + width > container.clientWidth
        ? Math.max(8, param.point.x - width - 16)
        : param.point.x + 16;
      tip.style.left = `${left}px`;
      tip.style.top = `12px`;
    };
    chart.subscribeCrosshairMove(onCrosshairMove);

    const resize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.remove();
      chartRef.current = null;
    };
  }, [plotted, colorOf, mode, themeMode]);

  const dates = data?.dates ?? [];
  const latestDate = dates[dates.length - 1] ?? null;

  /** Per item: first and last price in the current range, and the move between them.
   * This is the table that gives the chart its relief — four of the light-mode series
   * colors sit below 3:1 against the surface, so the same numbers have to be readable
   * without relying on which line is which color. */
  const summary = useMemo(() => {
    if (!data) return [];
    const cutoff =
      range === 0 ? null : data.dates.length > range ? data.dates[data.dates.length - range] : null;
    return data.items.map((item) => {
      const points = cutoff ? item.points.filter((p) => p.price_date >= cutoff) : item.points;
      const first = points[0];
      const last = points[points.length - 1];
      const move = first && last && first.price ? ((last.price - first.price) / first.price) * 100 : null;
      return {
        item_name: item.item_name,
        first: first?.price ?? null,
        last: last?.price ?? null,
        latestChange: last?.change_pct ?? null,
        move,
        count: points.length,
      };
    });
  }, [data, range]);

  const toggleItem = (name: string) =>
    setHidden((prev) => {
      const next = { ...prev, [name]: !prev[name] };
      // Never let the last line be switched off — an empty plot area looks like a
      // failed load rather than a filter the reader applied.
      const anyVisible = (data?.items ?? []).some((i) => !next[i.item_name]);
      return anyVisible ? next : prev;
    });

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/dashboard" className="back-link">
          ← {t("메인으로")}
        </Link>
        <div>
          <div className="app-title-row">
            <h1 className="app-title">{t("D램 현물가격 이력")}</h1>
            <span className="app-header-meta app-header-meta-inline">
              <LanguageToggle />
              <ThemeToggle />
            </span>
          </div>
          <p className="app-subtitle">
            {t("TrendForce 일별 현물가 · 수집된 전체 기간")}
            {dates.length > 0 && (
              <>
                {" · "}
                {dates[0]} ~ {latestDate} ({dates.length}
                {t("일")})
              </>
            )}
          </p>
        </div>
      </header>

      {loading && <div className="loading-state">{t("불러오는 중...")}</div>}
      {error && <div className="error-state">{t(error)}</div>}
      {!loading && !error && dates.length === 0 && (
        <div className="loading-state">{t("아직 수집된 이력이 없습니다.")}</div>
      )}

      {!loading && !error && dates.length > 0 && (
        <div className="main-col">
          <div className="card dram-hist-card">
            {/* Filters in one row above the plot: what is measured, then over how long.
                Both change the same chart, so they belong together and above it rather
                than scattered around it. */}
            <div className="dram-hist-controls">
              <div className="dram-hist-segmented" role="group" aria-label={t("표시 기준")}>
                <button
                  type="button"
                  className={mode === "price" ? "active" : ""}
                  onClick={() => setMode("price")}
                >
                  {t("가격")} (USD)
                </button>
                <button
                  type="button"
                  className={mode === "index" ? "active" : ""}
                  onClick={() => setMode("index")}
                >
                  {t("지수")} (100)
                </button>
              </div>
              <div className="dram-hist-segmented" role="group" aria-label={t("기간")}>
                {RANGES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={range === r ? "active" : ""}
                    onClick={() => setRange(r)}
                    // A preset longer than the data would silently show the same
                    // thing as 전체, which reads as a broken button.
                    disabled={r !== 0 && dates.length <= r}
                  >
                    {t(RANGE_LABEL[r])}
                  </button>
                ))}
              </div>
            </div>

            <p className="dram-hist-mode-note">
              {mode === "index"
                ? t("각 품목의 기간 첫날을 100으로 환산했습니다. 가격대가 다른 품목의 등락을 같은 축에서 비교합니다.")
                : t("실제 현물가(USD)입니다. 품목별 가격대 차이가 커서 저가 품목의 움직임은 지수 보기가 더 잘 보입니다.")}
            </p>

            <div className="dram-hist-chart-wrap">
              <div className="dram-hist-chart" ref={containerRef} />
              <div className="dram-hist-tip" ref={tooltipRef} role="status" aria-live="off" />
            </div>

            {/* The legend is also the filter. Always present (there are seven series),
                and every entry carries its name in text — identity never rests on the
                swatch alone. */}
            <div className="dram-hist-legend">
              {(data?.items ?? []).map((item) => {
                const off = !!hidden[item.item_name];
                return (
                  <button
                    key={item.item_name}
                    type="button"
                    className={`dram-hist-legend-item ${off ? "off" : ""} ${
                      hovered === item.item_name ? "hover" : ""
                    }`}
                    onClick={() => toggleItem(item.item_name)}
                    onMouseEnter={() => setHovered(item.item_name)}
                    onMouseLeave={() => setHovered(null)}
                    aria-pressed={!off}
                  >
                    <span
                      className="dram-hist-swatch"
                      style={{ background: colorOf.get(item.item_name) }}
                      aria-hidden="true"
                    />
                    {item.item_name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* The same data as numbers. Required rather than optional: it is the relief
              for the light-mode series colors that sit below 3:1 contrast, and it is
              the only view that survives being printed or read by a screen reader. */}
          <div className="card dram-hist-card">
            <h2 className="dram-hist-table-title">{t("기간 요약")}</h2>
            <div className="dram-hist-table-wrap">
              <table className="dram-hist-table">
                <thead>
                  <tr>
                    <th>{t("품목")}</th>
                    <th>{t("시작")}</th>
                    <th>{t("최근")}</th>
                    <th>{t("기간 등락")}</th>
                    <th>{t("최근 일간")}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((row) => (
                    <tr
                      key={row.item_name}
                      className={hidden[row.item_name] ? "dimmed" : ""}
                      onMouseEnter={() => setHovered(row.item_name)}
                      onMouseLeave={() => setHovered(null)}
                    >
                      <td className="dram-hist-name">
                        <span
                          className="dram-hist-swatch"
                          style={{ background: colorOf.get(row.item_name) }}
                          aria-hidden="true"
                        />
                        {row.item_name}
                      </td>
                      <td>{row.first != null ? formatUsd(row.first) : "—"}</td>
                      <td>{row.last != null ? formatUsd(row.last) : "—"}</td>
                      <td
                        className={
                          row.move == null
                            ? "change-flat"
                            : row.move > 0
                              ? "change-up"
                              : row.move < 0
                                ? "change-down"
                                : "change-flat"
                        }
                      >
                        {formatSignedPct(row.move)}
                      </td>
                      <td
                        className={
                          row.latestChange == null
                            ? "change-flat"
                            : row.latestChange > 0
                              ? "change-up"
                              : row.latestChange < 0
                                ? "change-down"
                                : "change-flat"
                        }
                      >
                        {formatSignedPct(row.latestChange)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}
