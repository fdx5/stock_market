import { useEffect, useRef, useState } from "react";
import { GlobalIndexWidget, IndexQuote, MarketInvestorSummary } from "../api/client";
import { Lang, useLanguage } from "../i18n/LanguageContext";
import { useTranslatedText } from "../i18n/useTranslatedTexts";
import { useMarketIndices } from "../useMarketIndices";
import { useMarketTicker } from "../useMarketTicker";
import StockLogo from "../components/StockLogo";
import { Skel } from "./parts";
import {
  Breadth,
  SEOUL,
  eok,
  moodOf,
  num,
  openStock,
  pct,
  sentimentLabel,
  signed,
  useGlobalIndices,
  useL,
  useSentiment,
  won,
} from "./lib";

/* 1면 — the front page.
 *
 * The classic desk opened on a row of widgets and left the reader to assemble
 * the day from them. A newspaper does the assembling for you: one headline,
 * one paragraph under it, three points in the margin. This does the same, and
 * every word of it is set from numbers already on the page — the two indices,
 * the investor flows, breadth, the sector averages, the Nasdaq and the dollar.
 *
 * Same rule as spotlight.ts, and for the same reasons: nothing here can be
 * wrong about a figure because it has no way to produce one that is not in a
 * payload, it costs nothing per view, and it says what happened — never what
 * to do about it. */

function dirKo(v: number): string {
  if (v >= 1.5) return "급등";
  if (v >= 0.5) return "상승";
  if (v > 0.05) return "강보합";
  if (v >= -0.05) return "보합";
  if (v > -0.5) return "약보합";
  if (v > -1.5) return "하락";
  return "급락";
}
function dirEn(v: number): string {
  if (v >= 1.5) return "surges";
  if (v >= 0.5) return "rises";
  if (v > 0.05) return "edges up";
  if (v >= -0.05) return "flat";
  if (v > -0.5) return "edges down";
  if (v > -1.5) return "falls";
  return "slumps";
}
function bucket(v: number): number {
  return v >= 0.5 ? 2 : v > 0.05 ? 1 : v >= -0.05 ? 0 : v > -0.5 ? -1 : -2;
}

function headline(k: IndexQuote, q: IndexQuote, lang: Lang): string {
  const same = bucket(k.change_pct) === bucket(q.change_pct);
  if (same && bucket(k.change_pct) === 0) return lang === "en" ? "KOSPI and KOSDAQ hold steady" : "코스피·코스닥 보합권 공방";
  if (lang === "en") {
    if (same) return `KOSPI and KOSDAQ ${dirEn(k.change_pct).replace(/s$/, "")} together`;
    return `KOSPI ${dirEn(k.change_pct)}, KOSDAQ ${dirEn(q.change_pct)}`;
  }
  if (same) return `코스피·코스닥 동반 ${dirKo(k.change_pct)}`;
  return `코스피 ${dirKo(k.change_pct)}, 코스닥은 ${dirKo(q.change_pct)}`;
}

/** Who moved the KOSPI, in the order a desk editor would say it: the side that
 * traded most in the direction of the day, then the one against it. */
function flowLine(inv: MarketInvestorSummary, lang: Lang): string | null {
  const parts = [
    { ko: "외국인", en: "Foreigners", v: inv.foreign_amount },
    { ko: "기관", en: "Institutions", v: inv.institution_amount },
    { ko: "개인", en: "Individuals", v: inv.individual_amount },
  ]
    .filter((p) => Math.abs(p.v) >= 100)
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  if (parts.length === 0) return null;
  const buyer = parts.find((p) => p.v > 0);
  const seller = parts.find((p) => p.v < 0);
  if (lang === "en") {
    const bits = [];
    if (seller) bits.push(`${seller.en} sold ${eok(seller.v, lang, false)}`);
    if (buyer) bits.push(`${buyer.en.toLowerCase()} bought ${eok(buyer.v, lang, false)}`);
    return bits.join(", ");
  }
  const bits = [];
  if (seller) bits.push(`${seller.ko} ${eok(seller.v, lang, false)} 순매도`);
  if (buyer) bits.push(`${buyer.ko} ${eok(buyer.v, lang, false)} 순매수`);
  return bits.join(" · ");
}

function findGlobal(items: GlobalIndexWidget[] | null, key: string): GlobalIndexWidget | null {
  return items?.find((it) => it.key === key) ?? null;
}

/* ── since your last visit ───────────────────────────────────────────────── */

const LAST_KEY = "d2_last_seen";
/** A reload a minute later is the same visit, not a new one. */
const MIN_GAP_MS = 5 * 60_000;

interface Seen {
  at: number;
  kospi: number;
  kosdaq: number;
  usdkrw: number | null;
}

function readSeen(): Seen | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return typeof v?.at === "number" && typeof v?.kospi === "number" ? v : null;
  } catch {
    return null;
  }
}

function writeSeen(v: Seen) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(v));
  } catch {
    // A visit that cannot be remembered is simply not compared next time.
  }
}

function SinceLastVisit({ kospi, kosdaq, usdkrw }: { kospi: IndexQuote | null; kosdaq: IndexQuote | null; usdkrw: number | null }) {
  const { lang } = useLanguage();
  const L = useL();
  // Read once: the reference point for this whole page view is the previous
  // visit, and it must not slide forward as this visit writes its own record.
  const previous = useRef<Seen | null | undefined>(undefined);
  if (previous.current === undefined) {
    const seen = readSeen();
    previous.current = seen && Date.now() - seen.at >= MIN_GAP_MS ? seen : null;
    // A reload inside the gap keeps comparing against the visit before it.
    if (seen && Date.now() - seen.at < MIN_GAP_MS) {
      try {
        const kept = sessionStorage.getItem(`${LAST_KEY}_ref`);
        if (kept) previous.current = JSON.parse(kept);
      } catch {
        /* nothing to keep */
      }
    }
    try {
      if (previous.current) sessionStorage.setItem(`${LAST_KEY}_ref`, JSON.stringify(previous.current));
    } catch {
      /* not persisted */
    }
  }

  useEffect(() => {
    if (!kospi || !kosdaq) return;
    writeSeen({ at: Date.now(), kospi: kospi.close, kosdaq: kosdaq.close, usdkrw });
  }, [kospi, kosdaq, usdkrw]);

  const prev = previous.current;
  if (!prev) {
    return (
      <aside className="d2-since d2-since--first">
        <h3>{L("지난 방문 이후", "Since your last visit")}</h3>
        <p>{L("이 브라우저에서 처음 펼친 지면입니다. 다음에 다시 오시면 그 사이 지수와 환율이 얼마나 움직였는지 여기에 적어 둡니다.", "This is the first edition opened on this browser. Next time, this note will show how far the indices and the won moved while you were away.")}</p>
      </aside>
    );
  }

  const when = new Intl.DateTimeFormat(lang === "ko" ? "ko-KR" : "en-US", {
    timeZone: SEOUL,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(prev.at));

  const rows = [
    { label: L("코스피", "KOSPI"), before: prev.kospi, after: kospi?.close ?? null, unit: "p" },
    { label: L("코스닥", "KOSDAQ"), before: prev.kosdaq, after: kosdaq?.close ?? null, unit: "p" },
    { label: L("원/달러", "USD/KRW"), before: prev.usdkrw, after: usdkrw, unit: L("원", "₩") },
  ];

  return (
    <aside className="d2-since">
      <h3>
        {L("지난 방문 이후", "Since your last visit")}
        <small>{when}</small>
      </h3>
      <ul>
        {rows.map((r) => {
          if (r.before === null || r.after === null) return null;
          const diff = r.after - r.before;
          const rate = r.before ? (diff / r.before) * 100 : 0;
          const tone = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
          return (
            <li key={r.label} className={`is-${tone}`}>
              <span>{r.label}</span>
              <b>
                {signed(diff, 2)}
                {r.unit}
              </b>
              <em>{pct(rate)}</em>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

/* ── dials ───────────────────────────────────────────────────────────────── */

function Dial({ name, score }: { name: string; score: number | null }) {
  const { lang } = useLanguage();
  const value = score ?? 0;
  // A half circle from 180° (fear) to 0° (greed).
  const angle = Math.PI * (1 - value / 100);
  const cx = 50,
    cy = 50,
    r = 38;
  const nx = cx + Math.cos(angle) * (r - 6);
  const ny = cy - Math.sin(angle) * (r - 6);
  const tone = score === null ? "unknown" : value <= 40 ? "fear" : value <= 60 ? "neutral" : "greed";
  return (
    <figure className={`d2-dial is-${tone}`}>
      <svg viewBox="0 0 100 58" aria-hidden="true">
        <path className="d2-dial-track" d={`M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}`} />
        {Array.from({ length: 11 }, (_, i) => {
          const a = Math.PI * (1 - i / 10);
          return (
            <line
              key={i}
              className="d2-dial-tick"
              x1={cx + Math.cos(a) * (r + 3)}
              y1={cy - Math.sin(a) * (r + 3)}
              x2={cx + Math.cos(a) * (r + (i % 5 === 0 ? 8 : 6))}
              y2={cy - Math.sin(a) * (r + (i % 5 === 0 ? 8 : 6))}
            />
          );
        })}
        {score !== null && <line className="d2-dial-needle" x1={cx} y1={cy} x2={nx} y2={ny} />}
        <circle className="d2-dial-hub" cx={cx} cy={cy} r="3" />
      </svg>
      <figcaption>
        <span>{name}</span>
        <b>{score ?? "—"}</b>
        <em>{score === null ? (lang === "ko" ? "측정 중" : "pending") : sentimentLabel(value, lang)}</em>
      </figcaption>
    </figure>
  );
}

/* ── the page ────────────────────────────────────────────────────────────── */

export default function FrontPage({ breadth, asOf }: { breadth: Breadth | null; asOf: string | null }) {
  const { lang } = useLanguage();
  const L = useL();
  const { kospi, kosdaq, kospiInvestor } = useMarketIndices();
  const globals = useGlobalIndices();
  const ticker = useMarketTicker();
  const sentiment = useSentiment();
  const usdkrw = ticker.find((t) => t.symbol === "KRW=X") ?? null;
  const nasdaq = findGlobal(globals, "nasdaq");
  const dow = findGlobal(globals, "dow");

  const ready = kospi && kosdaq;
  const status = kospi?.market_status ?? null;
  const statusText = status === "OPEN" ? L("장중", "Market open") : status === "PREOPEN" ? L("장 시작 전", "Pre-open") : L("장 마감", "Market closed");
  const stamp = kospi?.updated_at
    ? new Intl.DateTimeFormat("en-GB", { timeZone: SEOUL, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(kospi.updated_at))
    : asOf;

  const leader = breadth?.sectors[0];
  const laggard = breadth && breadth.sectors.length > 1 ? breadth.sectors[breadth.sectors.length - 1] : undefined;
  const gap = breadth ? breadth.capWeighted - breadth.equalWeighted : 0;
  const mood = breadth ? moodOf(breadth.temperature, lang) : null;

  const deck: string[] = [];
  if (breadth) {
    deck.push(
      lang === "ko"
        ? `코스피·코스닥 ${num(breadth.total)}개 종목 가운데 ${num(breadth.up)}개가 오르고 ${num(breadth.down)}개가 내렸다.`
        : `Of ${num(breadth.total)} KOSPI and KOSDAQ names, ${num(breadth.up)} rose and ${num(breadth.down)} fell.`
    );
    if (Math.abs(gap) >= 0.25) {
      deck.push(
        lang === "ko"
          ? `시가총액 가중 ${pct(breadth.capWeighted)}, 동일 가중 ${pct(breadth.equalWeighted)} — ${gap > 0 ? "대형주" : "중소형주"}가 상대적으로 강했다.`
          : `Cap-weighted ${pct(breadth.capWeighted)} against equal-weighted ${pct(breadth.equalWeighted)} — ${gap > 0 ? "large caps" : "smaller names"} did relatively better.`
      );
    } else {
      deck.push(lang === "ko" ? `대형주와 중소형주의 흐름에는 큰 차이가 없었다.` : `Large and small caps moved broadly together.`);
    }
    if (leader && laggard) {
      deck.push(
        lang === "ko"
          ? `업종별로는 ${leader.sector} ${pct(leader.change)}로 가장 강했고, ${laggard.sector} ${pct(laggard.change)}로 가장 약했다.`
          : `By sector, ${leader.sector} (${pct(leader.change)}) led and ${laggard.sector} (${pct(laggard.change)}) lagged.`
      );
    }
  }

  const flow = kospiInvestor ? flowLine(kospiInvestor, lang) : null;
  const top = breadth?.topTurnover[0];
  const topName = useTranslatedText(top?.name ?? "");

  return (
    <div className="d2-front">
      <article className="d2-lead">
        <p className="d2-lead-kicker">
          <span className={`d2-lead-status ${status === "OPEN" ? "is-live" : ""}`}>{statusText}</span>
          {stamp && (
            <span>
              {stamp} {L("기준", "KST")}
            </span>
          )}
          <span>{L("데이터로 쓴 1면", "Front page, written from data")}</span>
        </p>

        {ready ? (
          <>
            <h2 className="d2-lead-head">{headline(kospi, kosdaq, lang)}</h2>
            <p className="d2-lead-sub">
              <span className={`is-${kospi.change >= 0 ? "up" : "down"}`}>
                {L("코스피", "KOSPI")} {kospi.close.toLocaleString("en-US", { minimumFractionDigits: 2 })} ({pct(kospi.change_pct)})
              </span>
              <span className={`is-${kosdaq.change >= 0 ? "up" : "down"}`}>
                {L("코스닥", "KOSDAQ")} {kosdaq.close.toLocaleString("en-US", { minimumFractionDigits: 2 })} ({pct(kosdaq.change_pct)})
              </span>
              {flow && <span className="d2-lead-flow">{flow}</span>}
            </p>
          </>
        ) : (
          <div className="d2-lead-skel">
            <Skel h={46} w="80%" />
            <Skel h={46} w="55%" />
            <Skel h={16} w="70%" />
          </div>
        )}

        <div className="d2-lead-body">
          <div className="d2-lead-deck">
            {deck.length > 0 ? (
              deck.map((line, i) => <p key={i}>{line}</p>)
            ) : (
              <>
                <Skel h={14} />
                <Skel h={14} w="92%" />
                <Skel h={14} w="75%" />
              </>
            )}
          </div>
          <ol className="d2-lead-points">
            <li>
              <span>{L("해외", "Overseas")}</span>
              {nasdaq?.change_pct != null ? (
                <p>
                  {L("나스닥", "Nasdaq")} <b className={nasdaq.change_pct >= 0 ? "is-up" : "is-down"}>{pct(nasdaq.change_pct)}</b>
                  {dow?.change_pct != null && (
                    <>
                      {" · "}
                      {L("다우", "Dow")} <b className={dow.change_pct >= 0 ? "is-up" : "is-down"}>{pct(dow.change_pct)}</b>
                    </>
                  )}
                </p>
              ) : (
                <Skel h={13} w="80%" />
              )}
            </li>
            <li>
              <span>{L("환율", "FX")}</span>
              {usdkrw ? (
                <p>
                  {L("원/달러", "USD/KRW")} <b>{usdkrw.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>{" "}
                  <em className={usdkrw.change >= 0 ? "is-up" : "is-down"}>{signed(usdkrw.change, 2)}</em>
                </p>
              ) : (
                <Skel h={13} w="70%" />
              )}
            </li>
            <li>
              <span>{L("거래대금 1위", "Top turnover")}</span>
              {top ? (
                <button type="button" onClick={() => openStock({ code: top.code, name: top.name, market: "KOSPI" })}>
                  <StockLogo code={top.code} name={top.name} className="d2-lead-logo" />
                  {topName || top.name} <b>{won(top.turnover ?? top.close * (top.volume ?? 0), lang)}</b>{" "}
                  <em className={top.change_pct >= 0 ? "is-up" : "is-down"}>{pct(top.change_pct)}</em>
                </button>
              ) : (
                <Skel h={13} w="75%" />
              )}
            </li>
            <li>
              <span>{L("가격제한폭", "Limit moves")}</span>
              {breadth ? (
                <p>
                  {L("상한가", "Limit-up")} <b className="is-up">{breadth.limitUp.length}</b> · {L("하한가", "limit-down")} <b className="is-down">{breadth.limitDown.length}</b> ·{" "}
                  {L("±5% 이상", "±5%+")} <b>{breadth.strongUp + breadth.strongDown}</b>
                </p>
              ) : (
                <Skel h={13} w="60%" />
              )}
            </li>
          </ol>
        </div>
      </article>

      <div className="d2-front-side">
        <section className={`d2-temp is-${mood?.tone ?? "even"}`} aria-labelledby="d2-temp-title">
          <h3 id="d2-temp-title">{L("시장 체온", "Market temperature")}</h3>
          {breadth && mood ? (
            <>
              <div className="d2-temp-read">
                <b>
                  {Math.round(breadth.temperature)}
                  <sup>°</sup>
                </b>
                <span>
                  <strong>{mood.label}</strong>
                  <small>{L("오른 종목 비율(보합 제외)", "Share of decisive names that rose")}</small>
                </span>
              </div>
              <div className="d2-temp-scale" aria-hidden="true">
                <i style={{ left: `${breadth.temperature}%` }} />
                <span>0</span>
                <span>50</span>
                <span>100</span>
              </div>
              <div className="d2-adbar" role="img" aria-label={`${L("상승", "Up")} ${breadth.up}, ${L("보합", "Flat")} ${breadth.flat}, ${L("하락", "Down")} ${breadth.down}`}>
                <span className="is-up" style={{ flexGrow: breadth.up }}>
                  {breadth.up}
                </span>
                <span className="is-flat" style={{ flexGrow: Math.max(breadth.flat, breadth.total * 0.02) }}>
                  {breadth.flat}
                </span>
                <span className="is-down" style={{ flexGrow: breadth.down }}>
                  {breadth.down}
                </span>
              </div>
            </>
          ) : (
            <>
              <Skel h={64} w="60%" />
              <Skel h={10} />
              <Skel h={22} />
            </>
          )}
        </section>

        <section className="d2-fg" aria-labelledby="d2-fg-title">
          <h3 id="d2-fg-title">
            {L("공포·탐욕 지수", "Fear & Greed")}
            <small>{L("0 공포 · 100 탐욕", "0 fear · 100 greed")}</small>
          </h3>
          <div className="d2-fg-dials">
            {sentiment.map((s) => (
              <Dial key={s.key} name={s.name} score={s.score} />
            ))}
          </div>
        </section>

        <SinceLastVisit kospi={kospi} kosdaq={kosdaq} usdkrw={usdkrw?.price ?? null} />
      </div>
    </div>
  );
}

export function useFlashOnChange(value: number | undefined): "up" | "down" | null {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prev = useRef<number | undefined>(value);
  useEffect(() => {
    if (value === undefined) return;
    if (prev.current !== undefined && value !== prev.current) {
      setFlash(value > prev.current ? "up" : "down");
      const id = window.setTimeout(() => setFlash(null), 900);
      prev.current = value;
      return () => window.clearTimeout(id);
    }
    prev.current = value;
  }, [value]);
  return flash;
}
