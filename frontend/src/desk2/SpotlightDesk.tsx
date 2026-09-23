import { useEffect, useMemo, useRef, useState } from "react";
import { EtfItem, api } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { SpotlightPick, pickSpotlight, sessionBucket } from "../spotlight";
import { useMarketSnapshot } from "../useMarketSnapshot";
import { useMediaQuery } from "../useMediaQuery";
import StockLogo from "../components/StockLogo";
import { Skel, Spark } from "./parts";
import { krwPrice, openEtf, openStock, pct, toneOf, useL, won } from "./lib";

/* 08 오늘의 주목 종목.
 *
 * The picking and every sentence of commentary come from spotlight.ts, unchanged
 * — the rules there (up on real money, ranked on move and turnover together,
 * spread across sectors, held still for the session window) are the product,
 * and a redesign has no business re-deciding them. What changes is the page:
 * each pick is set as a short article — name in the serif, the numbers in a
 * standfirst line, the commentary as body copy, and a month's line beside it. */

const SPARK_DAYS = 20;
const ETFS = ["069500", "360750", "133690", "458730"];
const ETF_NAMES: Record<string, string> = {
  "069500": "KODEX 200",
  "360750": "TIGER 미국S&P500",
  "133690": "TIGER 미국나스닥100",
  "458730": "TIGER 미국배당다우존스",
};

function useSeries(codes: string[], enabled: boolean): Map<string, number[]> {
  const [series, setSeries] = useState<Map<string, number[]>>(new Map());
  const key = [...codes].sort().join(",");
  useEffect(() => {
    if (!enabled || !key) return;
    let cancelled = false;
    for (const code of key.split(",")) {
      api
        .dailyPrices(code, 0, SPARK_DAYS)
        .then((page) => {
          if (cancelled || page.items.length === 0) return;
          setSeries((prev) => {
            if (prev.has(code)) return prev;
            const next = new Map(prev);
            next.set(code, [...page.items].reverse().map((p) => p.close));
            return next;
          });
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [key, enabled]);
  return series;
}

export default function SpotlightDesk() {
  const { lang } = useLanguage();
  const L = useL();
  const snap = useMarketSnapshot();
  const wide = useMediaQuery("(min-width: 761px)");
  const [tick, setTick] = useState(0);
  const [etfs, setEtfs] = useState<EtfItem[]>([]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .etfs("KR")
        .then((res) => {
          if (cancelled) return;
          const by = new Map(res.items.map((i) => [i.code, i]));
          setEtfs(ETFS.map((c) => by.get(c)).filter((i): i is EtfItem => Boolean(i)));
        })
        .catch(() => {});
    load();
    const stop = startVisibilityAwareInterval(load, 60_000);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bucket = useMemo(() => sessionBucket(), [tick]);
  const held = useRef<{ key: string; picks: SpotlightPick[] } | null>(null);
  const picks = useMemo(() => {
    const h = held.current;
    if (h && h.key === bucket.key && h.picks.length > 0) return h.picks;
    if (snap.generatedAt === null) return [];
    const first = pickSpotlight(snap.kospi, "KOSPI", bucket.phase, "kr");
    const second = pickSpotlight(snap.kosdaq, "KOSDAQ", bucket.phase, "kr", new Set(first.map((p) => p.item.code)));
    const next = [...first, ...second];
    if (next.length === 0) return h?.picks ?? [];
    held.current = { key: bucket.key, picks: next };
    return next;
  }, [bucket.key, bucket.phase, snap]);

  const live = useMemo(() => {
    const m = new Map<string, { close: number; change: number; change_pct: number }>();
    for (const it of [...snap.kospi, ...snap.kosdaq]) m.set(it.code, it);
    return m;
  }, [snap]);

  const names = useTranslatedTexts(picks.map((p) => p.item.name));
  const series = useSeries(
    picks.map((p) => p.item.code),
    wide
  );

  const phase =
    bucket.phase === "pre" ? L("프리장 기준", "Pre-market") : bucket.phase === "live" ? L("장중 기준", "Intraday") : L("장 마감 기준", "At the close");
  const basis =
    bucket.phase === "pre"
      ? L("프리마켓 상승률로 지수별 4종목을 골랐습니다.", "Four per index, picked on the pre-market move.")
      : L("상승률과 거래대금을 함께 보고 지수별 4종목을 골랐습니다. 한 시간 단위로만 바뀝니다.", "Four per index, picked on move and turnover together. Changes only on the hour.");

  if (picks.length === 0) {
    return (
      <div className="d2-spot-grid">
        {Array.from({ length: 8 }, (_, i) => (
          <Skel key={i} h={190} />
        ))}
      </div>
    );
  }

  const rows: { label: string; picks: SpotlightPick[]; offset: number }[] = [];
  const kospiPicks = picks.filter((p) => p.market === "KOSPI");
  rows.push({ label: L("코스피", "KOSPI"), picks: kospiPicks, offset: 0 });
  rows.push({ label: L("코스닥", "KOSDAQ"), picks: picks.filter((p) => p.market === "KOSDAQ"), offset: kospiPicks.length });

  return (
    <div className="d2-spot">
      <p className="d2-spot-meta">
        <em className={`is-${bucket.phase}`}>{phase}</em>
        {basis}
      </p>
      {rows.map((row) =>
        row.picks.length === 0 ? null : (
          <section key={row.label} className="d2-spot-row">
            <h3 className="d2-spot-rowname">{row.label}</h3>
            <div className="d2-spot-grid">
              {row.picks.map((pick, i) => {
                const it = pick.item;
                const q = live.get(it.code) ?? it;
                const tone = toneOf(q.change_pct);
                const line = series.get(it.code);
                return (
                  <article key={it.code} className={`d2-spot-card is-${tone}`}>
                    <button type="button" onClick={() => openStock({ code: it.code, name: it.name, market: pick.market })}>
                      <header>
                        <StockLogo code={it.code} name={it.name} className="d2-spot-logo" />
                        <span>
                          <h4>{names[row.offset + i] ?? it.name}</h4>
                          <small>
                            {it.code} · {it.sector}
                          </small>
                        </span>
                      </header>
                      <p className="d2-spot-quote">
                        <b>{krwPrice(q.close, lang)}</b>
                        <span>
                          {q.change > 0 ? "▲" : q.change < 0 ? "▼" : "–"} {Math.abs(q.change).toLocaleString()} ({pct(q.change_pct)})
                        </span>
                      </p>
                      <div className="d2-spot-body">
                        <ul>
                          {pick.lines.map((l, j) => (
                            <li key={j}>{l}</li>
                          ))}
                        </ul>
                        {line && (
                          <figure>
                            <Spark points={line} tone={tone} />
                            <figcaption>
                              {SPARK_DAYS}
                              {L("일", "D")}
                            </figcaption>
                          </figure>
                        )}
                      </div>
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        )
      )}
      {etfs.length > 0 && (
        <section className="d2-spot-row">
          <h3 className="d2-spot-rowname">ETF</h3>
          <div className="d2-spot-grid">
            {etfs.map((e) => {
              const tone = toneOf(e.change_pct);
              return (
                <article key={e.code} className={`d2-spot-card d2-spot-card--etf is-${tone}`}>
                  <button type="button" onClick={() => openEtf(e.code)}>
                    <header>
                      <span className="d2-spot-logo d2-spot-logo--etf" aria-hidden="true">
                        {(ETF_NAMES[e.code] ?? e.name).slice(0, 1)}
                      </span>
                      <span>
                        <h4>{ETF_NAMES[e.code] ?? e.name}</h4>
                        <small>
                          {e.code} · {e.benchmark}
                        </small>
                      </span>
                    </header>
                    <p className="d2-spot-quote">
                      <b>{krwPrice(e.close, lang)}</b>
                      <span>{pct(e.change_pct)}</span>
                    </p>
                    <div className="d2-spot-body">
                      <ul>
                        <li>{e.category}</li>
                        <li>
                          {L("거래대금", "Turnover")} {won(e.turnover, lang)} · 20{L("일", "D")} {pct(e.returns.d20)}
                        </li>
                      </ul>
                      <figure>
                        <Spark points={e.sparkline.slice(-SPARK_DAYS)} tone={tone} />
                        <figcaption>
                          {SPARK_DAYS}
                          {L("일", "D")}
                        </figcaption>
                      </figure>
                    </div>
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
