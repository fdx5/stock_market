import { useEffect, useMemo, useRef, useState } from "react";
import { StockSearchResult } from "../api/client";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { wonSuffix } from "../i18n/format";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { SpotlightPick, pickSpotlight, sessionBucket } from "../spotlight";
import { useMarketSnapshot } from "../useMarketSnapshot";
import StockIcon from "./StockIcon";

/* 오늘의 주목 종목 — three per board, wide cards, with a line of context.
 *
 * The picking and the commentary are in spotlight.ts, which is also where the
 * note on why none of it comes from a language model lives. This file is the
 * board: two rows, the session badge, and the rule that keeps the six still.
 *
 * That rule is the only interesting thing here. The snapshot behind it refreshes
 * every minute, and re-running the selection on every refresh would have the
 * cards reshuffle under a reader mid-sentence — the ranking near the cut is
 * close enough that a fourth-place name overtakes a third-place one on almost
 * every tick. So the pick is memoised on the session bucket: it is computed on
 * the first snapshot of a bucket and then held, whatever arrives afterwards,
 * until the clock moves the bucket on. The prices on the cards keep updating;
 * which six cards they are does not. */

const CLOCK_MS = 30_000;

export default function SpotlightBoard({
  onSelect,
  activeCode,
}: {
  onSelect: (stock: StockSearchResult) => void;
  activeCode?: string;
}) {
  const t = useT();
  const snapshot = useMarketSnapshot();

  /* The bucket is read from a clock of its own rather than derived at render
     time — a page left open across 09:00 would otherwise keep yesterday's
     closing six until something unrelated happened to re-render it. Thirty
     seconds is well inside the shortest bucket (an hour) and costs one Date. */
  const [bucket, setBucket] = useState(() => sessionBucket());
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = sessionBucket();
      setBucket((prev) => (prev.key === next.key ? prev : next));
    }, CLOCK_MS);
    return () => window.clearInterval(id);
  }, []);

  /* Held across snapshot refreshes, replaced only when the bucket changes. The
     ref is the memo: useMemo on [bucket.key] alone would recompute whenever
     React felt like dropping the cache, and on [bucket.key, snapshot] would
     recompute every minute, which is the thing being avoided. */
  const heldRef = useRef<{ key: string; picks: SpotlightPick[] } | null>(null);
  const picks = useMemo(() => {
    const held = heldRef.current;
    if (held && held.key === bucket.key && held.picks.length > 0) return held.picks;
    if (snapshot.generatedAt === null) return [];
    const next = [
      ...pickSpotlight(snapshot.kospi, "KOSPI", bucket.phase),
      ...pickSpotlight(snapshot.kosdaq, "KOSDAQ", bucket.phase),
    ];
    if (next.length === 0) return held?.picks ?? [];
    heldRef.current = { key: bucket.key, picks: next };
    return next;
  }, [bucket.key, bucket.phase, snapshot]);

  /* Prices come from this minute's snapshot rather than from the frozen pick, so
     a card that was chosen at 09:00 still shows the 09:47 price. Looked up by
     code against the live lists. */
  const live = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const item of [...snapshot.kospi, ...snapshot.kosdaq]) {
      map.set(item.code, [item.close, item.change, item.change_pct]);
    }
    return map;
  }, [snapshot]);

  const names = useTranslatedTexts(picks.map((p) => p.item.name));

  const kospi = picks.filter((p) => p.market === "KOSPI");
  const kosdaq = picks.filter((p) => p.market === "KOSDAQ");

  const phaseLabel =
    bucket.phase === "pre" ? "프리장 기준" : bucket.phase === "live" ? "장중 기준" : "장 마감 기준";

  if (picks.length === 0) {
    return (
      <div className="desk-spot" aria-busy="true">
        <div className="desk-spot-rows">
          {[0, 1].map((row) => (
            <div className="desk-spot-row" key={row}>
              <div className="desk-spot-rowhead">
                <span className="skeleton" style={{ width: 54, height: 14 }} />
              </div>
              <div className="desk-spot-grid">
                {[0, 1, 2].map((i) => (
                  <div className="desk-spot-card is-skeleton" key={i}>
                    <span className="skeleton" style={{ height: 22 }} />
                    <span className="skeleton" style={{ height: 30 }} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="desk-spot">
      <div className="desk-spot-meta">
        <span className={`desk-spot-phase is-${bucket.phase}`}>{t(phaseLabel)}</span>
        <span className="desk-spot-note">
          {t("상승률과 거래대금을 함께 보고 지수별 3종목을 고릅니다. 투자 판단의 근거가 아닙니다.")}
        </span>
      </div>

      <div className="desk-spot-rows">
        <Row
          label="코스피"
          picks={kospi}
          names={names}
          offset={0}
          live={live}
          onSelect={onSelect}
          activeCode={activeCode}
        />
        <Row
          label="코스닥"
          picks={kosdaq}
          names={names}
          offset={kospi.length}
          live={live}
          onSelect={onSelect}
          activeCode={activeCode}
        />
      </div>
    </div>
  );
}

function Row({
  label,
  picks,
  names,
  offset,
  live,
  onSelect,
  activeCode,
}: {
  label: string;
  picks: SpotlightPick[];
  names: string[];
  /** Where this row starts in the flat `names` array. */
  offset: number;
  live: Map<string, number[]>;
  onSelect: (stock: StockSearchResult) => void;
  activeCode?: string;
}) {
  const t = useT();
  const { lang } = useLanguage();
  if (picks.length === 0) return null;

  return (
    <section className="desk-spot-row" aria-label={t(label)}>
      <div className="desk-spot-rowhead">
        <h3>{t(label)}</h3>
        <span className="desk-spot-rowrule" aria-hidden="true" />
      </div>
      <div className="desk-spot-grid">
        {picks.map((pick, index) => {
          const item = pick.item;
          const [close, change, changePct] = live.get(item.code) ?? [
            item.close,
            item.change,
            item.change_pct,
          ];
          const tone = changePct > 0 ? "up" : changePct < 0 ? "down" : "flat";
          return (
            <button
              key={item.code}
              type="button"
              className={`desk-spot-card is-${tone} ${activeCode === item.code ? "is-active" : ""}`}
              onClick={() =>
                onSelect({ code: item.code, name: item.name, market: pick.market })
              }
            >
              <span className="desk-spot-top">
                <StockIcon code={item.code} className="desk-spot-logo" />
                <span className="desk-spot-id">
                  <b className="desk-spot-name">{names[offset + index] ?? item.name}</b>
                  <i className="desk-spot-sector">{item.sector}</i>
                </span>
                <span className="desk-spot-quote">
                  <b className="desk-spot-price">
                    {close.toLocaleString()}
                    {wonSuffix(lang)}
                  </b>
                  <i className={`desk-spot-pct change-${tone}`}>
                    {changePct >= 0 ? "▲" : "▼"} {Math.abs(change).toLocaleString()} (
                    {changePct >= 0 ? "+" : ""}
                    {changePct}%)
                  </i>
                </span>
              </span>
              <span className="desk-spot-lines">
                {pick.lines.map((line, i) => (
                  <em key={i}>{line}</em>
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
