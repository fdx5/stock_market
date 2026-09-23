import { useCallback, useEffect, useMemo, useState } from "react";
import { EtfItem, MarketMapItem, MarketSparkline, MarketTickerItem, api } from "../../api/client";
import StockLogo from "../../components/StockLogo";
import { useLanguage } from "../../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../../pollVisibility";
import { Link, navigate } from "../../router";
import { useDocumentTitle } from "../../useDocumentTitle";
import { usePopularStocks } from "../../usePopularStocks";
import { useUsMarketSnapshot } from "../../useUsMarketSnapshot";
import Colophon from "../Colophon";
import CommandBar, { DeskSection } from "../CommandBar";
import CommodityDesk from "../CommodityDesk";
import Finder from "../Finder";
import GlobalDesk from "../GlobalDesk";
import Masthead from "../Masthead";
import Tape from "../Tape";
import { Marker, SectionHead, Skel, Spark } from "../parts";
import { Lang } from "../../i18n/LanguageContext";
import { pct, sentimentLabel, toneOf, usd, usdPrice, useGlobalIndices, useL, useSentiment } from "../lib";
import { jumpTo, useBroadsheet, useFinderHotkey, useScrollSpy } from "../shell";
import "../pages.css";
import "./world.css";

/* /global — 해외판: the US market as the paper's world edition.
 *
 * Everything the classic global desk carried is here: breadth across the S&P 500
 * and NASDAQ 100, the site's most-opened US names, today's standouts, the world
 * index grid, FX and macro, rankings (now with overseas ETFs beside the stocks)
 * and the commodity board.
 *
 * What is written for a Korean reader of an American market:
 *  - 원화 렌즈 — every price and move can be read in won. A US stock bought from
 *    Seoul earns its dollar move *and* the dollar's move against the won; the lens
 *    shows the return actually landing in a Korean account, (1+r)(1+fx)−1;
 *  - 시간외 레이더 — the pre-market and after-hours movers, since most of New
 *    York's session happens while Seoul sleeps and the extended sessions are when
 *    Korean readers actually watch; during the regular session it becomes a board
 *    of names trading far above their usual volume;
 *  - 빅테크 7 — the seven names that move the index, their combined weight and
 *    how much of today's S&P move they account for;
 *  - 섹터 지도 — the eleven GICS sectors sized by value; click one to open it;
 *  - 서학개미 픽 — the US names this site's readers open most, priced in won;
 *  - 교차 자산 — the dollar, gold, oil and crypto on one sheet. */

type Lens = "usd" | "krw";

const SECTIONS: DeskSection[] = [
  { id: "w-front", no: "00", ko: "1면", en: "Front" },
  { id: "w-sectors", no: "01", ko: "섹터", en: "Sectors" },
  { id: "w-bigtech", no: "02", ko: "빅테크", en: "Big Tech" },
  { id: "w-ext", no: "03", ko: "시간외", en: "Extended" },
  { id: "w-rank", no: "04", ko: "순위", en: "Rankings" },
  { id: "w-picks", no: "05", ko: "서학개미", en: "KR picks" },
  { id: "w-cross", no: "06", ko: "교차 자산", en: "Cross-asset" },
  { id: "w-index", no: "07", ko: "세계 지수", en: "World" },
  { id: "w-cmdty", no: "08", ko: "원자재", en: "Commodities" },
];

const BIG_TECH = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA"];

const SECTOR_KO: Record<string, string> = {
  "Information Technology": "정보기술",
  "Health Care": "헬스케어",
  Financials: "금융",
  "Consumer Discretionary": "경기소비재",
  "Communication Services": "커뮤니케이션",
  Industrials: "산업재",
  "Consumer Staples": "필수소비재",
  Energy: "에너지",
  Utilities: "유틸리티",
  "Real Estate": "부동산",
  Materials: "소재",
};

/** "Alphabet Inc. Class A Common Stock" → "Alphabet": the legal tail says nothing
 * a reader needs and pushes the figures off a narrow row. */
const cleanName = (name: string) => {
  let n = name;
  for (let i = 0; i < 3; i++) n = n.replace(/,?\s+(Class [A-Z]\b.*|Common Stock.*|Capital Stock.*|Ordinary Shares.*|Inc\.?|Corp\.?|Corporation|Co\.|Ltd\.?|plc|N\.V\.|Holdings?)$/i, "");
  return n.trim() || name;
};
const secName = (s: string, lang: Lang) => (lang === "ko" ? SECTOR_KO[s] ?? s : s);
const capOf = (it: MarketMapItem) => it.market_cap ?? 0;
/** What a Korean holder actually earns: the stock's move compounded with the won's. */
const inKrw = (r: number | null | undefined, fx: number) => (r == null ? null : ((1 + r / 100) * (1 + fx / 100) - 1) * 100);

function useTicker(): MarketTickerItem[] {
  const [items, setItems] = useState<MarketTickerItem[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .marketTicker()
        .then((r) => alive && setItems(r.items))
        .catch(() => {});
    load();
    const stop = startVisibilityAwareInterval(load, 30_000);
    return () => {
      alive = false;
      stop();
    };
  }, []);
  return items;
}

function sessionLabel(s: string | null | undefined, L: (ko: string, en: string) => string) {
  if (s === "pre") return L("프리마켓", "Pre-market");
  if (s === "post") return L("애프터마켓", "After-hours");
  if (s === "regular") return L("정규장", "Regular session");
  return L("휴장", "Closed");
}

export default function WorldPage() {
  const L = useL();
  const { lang } = useLanguage();
  useBroadsheet();
  useDocumentTitle("해외 증시 · K-Stock Hub");

  // An old /global?code= link was a stock page; send it to where stocks live now.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (code) navigate(`/stock/${encodeURIComponent(code.toUpperCase())}`);
  }, []);

  const [finderOpen, setFinderOpen] = useState(false);
  const [active, setActive] = useState(SECTIONS[0].id);
  const [lens, setLens] = useState<Lens>(() => {
    try {
      return window.localStorage.getItem("world:lens") === "krw" ? "krw" : "usd";
    } catch {
      return "usd";
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("world:lens", lens);
    } catch {
      /* a preference only */
    }
  }, [lens]);
  useFinderHotkey(setFinderOpen);
  useScrollSpy(
    SECTIONS.map((s) => s.id),
    setActive
  );
  const jump = useCallback((id: string) => {
    jumpTo(id);
    setActive(id);
  }, []);

  const snap = useUsMarketSnapshot();
  const ticker = useTicker();
  const indices = useGlobalIndices();
  const sentiment = useSentiment();
  const tk = (sym: string) => ticker.find((t) => t.symbol === sym) ?? null;
  const fx = tk("KRW=X");
  const fxPct = fx?.change_pct ?? 0;
  const fxRate = fx?.price ?? null;

  const all = snap.all;
  const pulse = useMemo(() => {
    if (all.length === 0) return null;
    const up = all.filter((i) => i.change_pct > 0.05).length;
    const down = all.filter((i) => i.change_pct < -0.05).length;
    const cap = all.reduce((s, i) => s + capOf(i), 0);
    const weighted = cap ? all.reduce((s, i) => s + capOf(i) * i.change_pct, 0) / cap : 0;
    const map = new Map<string, { cap: number; move: number; n: number; items: MarketMapItem[] }>();
    for (const it of snap.sp500) {
      const e = map.get(it.sector) ?? { cap: 0, move: 0, n: 0, items: [] };
      e.cap += capOf(it);
      e.move += capOf(it) * it.change_pct;
      e.n += 1;
      e.items.push(it);
      map.set(it.sector, e);
    }
    const spCap = snap.sp500.reduce((s, i) => s + capOf(i), 0);
    const sectors = [...map.entries()]
      .map(([sector, e]) => ({ sector, cap: e.cap, share: spCap ? e.cap / spCap : 0, move: e.cap ? e.move / e.cap : 0, n: e.n, items: e.items.sort((a, b) => capOf(b) - capOf(a)) }))
      // "Other" is the scraper's bucket for names it could not classify; it is not
      // a sector, so it is neither drawn nor named as leading or trailing the day.
      .filter((x) => x.sector && x.sector !== "Other")
      .sort((a, b) => b.cap - a.cap);
    const byMove = sectors.filter((x) => x.n >= 3).sort((a, b) => b.move - a.move);
    const tech = BIG_TECH.map((c) => all.find((i) => i.code === c)).filter((i): i is MarketMapItem => !!i);
    const techCap = tech.reduce((s, i) => s + capOf(i), 0);
    const techMove = techCap ? tech.reduce((s, i) => s + capOf(i) * i.change_pct, 0) / techCap : 0;
    // The seven's contribution to the S&P's cap-weighted move, in percentage points.
    const techContribution = spCap ? tech.reduce((s, i) => s + capOf(i) * i.change_pct, 0) / spCap : null;
    return { up, down, flat: all.length - up - down, weighted, sectors, best: byMove[0], worst: byMove[byMove.length - 1], tech, techCap, techMove, techShare: spCap ? techCap / spCap : 0, techContribution };
  }, [all, snap.sp500]);

  const session = snap.session;
  const sp = tk("^GSPC");
  const ndx = tk("^NDX");
  const dow = indices?.find((i) => i.key === "dow") ?? null;
  const fg = sentiment.find((s) => s.key === "sp500")?.score ?? null;
  const asOf = snap.generatedAt
    ? new Intl.DateTimeFormat(lang === "ko" ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(snap.generatedAt))
    : null;

  const lensPct = (r: number | null | undefined) => (lens === "krw" ? inKrw(r, fxPct) : r ?? null);
  const lensPrice = (usdValue: number) => (lens === "krw" && fxRate ? `${Math.round(usdValue * fxRate).toLocaleString()}${lang === "ko" ? "원" : " KRW"}` : usdPrice(usdValue));

  const headline = pulse
    ? L(
        `뉴욕 대형주 ${all.length}종목 시총가중 ${pct(pulse.weighted)}, 선두 섹터 ${secName(pulse.best.sector, "ko")} ${pct(pulse.best.move, 1)}`,
        `New York's large caps ${pct(pulse.weighted)} cap-weighted; ${secName(pulse.best.sector, "en")} leads at ${pct(pulse.best.move, 1)}`
      )
    : "";

  return (
    <div className="d2 wd" lang={lang}>
      <a className="d2-skip" href="#w-front">
        {L("본문 바로가기", "Skip to content")}
      </a>
      <Masthead
        onPrint={() => window.print()}
        section={{ ko: "해외 증시", en: "World Markets", taglineKo: "서울에서 읽는 뉴욕 — 미국 대형주를 원화의 눈으로", taglineEn: "New York, read from Seoul — US large caps through a won lens" }}
      />
      <Tape />
      <CommandBar
        sections={SECTIONS}
        active={active}
        onJump={jump}
        onFind={() => setFinderOpen(true)}
        market={[sp && { label: "S&P 500", t: sp }, ndx && { label: L("나스닥100", "NDX 100"), t: ndx }, fx && { label: L("원/달러", "USD/KRW"), t: fx }]
          .filter((x): x is { label: string; t: MarketTickerItem } => !!x)
          .map(({ label, t }) => (
            <span key={label} className={`d2-cmd-idx is-${toneOf(t.change_pct)}`}>
              <small>{label}</small>
              <b>{t.price.toLocaleString("en-US", { maximumFractionDigits: t.price > 1000 ? 0 : 2 })}</b>
              <span className="d2-cmd-idx-ch">{pct(t.change_pct)}</span>
            </span>
          ))}
      />

      <main className="d2-main">
        {/* ── 1면 ── */}
        <section id="w-front" className="d2-sec wd-front" aria-label={L("1면", "Front")}>
          <p className="d2-lead-kicker">
            <span className={`d2-lead-status ${session === "regular" ? "is-live" : ""}`}>{sessionLabel(session, L)}</span>
            {asOf && <span>{L(`${asOf} 기준`, `As of ${asOf} KST`)}</span>}
            <span>{L("S&P 500 · 나스닥 100 구성 종목", "S&P 500 and NASDAQ 100 constituents")}</span>
          </p>
          {pulse ? <h2 className="wd-head">{headline}</h2> : <Skel h={48} w="70%" />}
          <div className="wd-lens">
            <Marker
              options={[
                { id: "usd" as Lens, label: L("달러 기준", "In dollars") },
                { id: "krw" as Lens, label: L("원화 기준", "In won") },
              ]}
              value={lens}
              onChange={setLens}
              label={L("통화 렌즈", "Currency lens")}
            />
            <p>
              {fx
                ? L(
                    `원/달러 ${fx.price.toLocaleString(undefined, { maximumFractionDigits: 1 })}원 (${pct(fx.change_pct)}). 원화 기준은 주가 변화에 환율 변화를 더한, 한국 계좌에 실제로 찍히는 수익률입니다.`,
                    `USD/KRW ${fx.price.toLocaleString(undefined, { maximumFractionDigits: 1 })} (${pct(fx.change_pct)}). The won view compounds each move with the dollar's, i.e. what lands in a Korean account.`
                  )
                : L("환율을 불러오는 중…", "Loading FX…")}
            </p>
          </div>

          <div className="wd-figs">
            {[
              { k: "S&P 500", v: sp?.price, r: sp?.change_pct, pts: sp?.points },
              { k: L("나스닥 100", "NASDAQ 100"), v: ndx?.price, r: ndx?.change_pct, pts: ndx?.points },
              { k: L("다우존스", "Dow Jones"), v: dow?.close, r: dow?.change_pct, pts: dow?.points?.map((p) => p.close) },
            ].map((f) => (
              <div key={f.k} className="wd-fig">
                <span>{f.k}</span>
                <b className="d2-num">{f.v != null ? f.v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}</b>
                <em className={`d2-num is-${toneOf(lensPct(f.r))}`}>{pct(lensPct(f.r))}</em>
                {lens === "krw" && f.r != null && <small>{L(`달러 기준 ${pct(f.r)}`, `${pct(f.r)} in USD`)}</small>}
                {f.pts && f.pts.length > 1 && <Spark points={f.pts} tone={toneOf(f.r)} className="wd-fig-spark" />}
              </div>
            ))}
            <div className="wd-fig">
              <span>{L("원/달러", "USD/KRW")}</span>
              <b className="d2-num">{fx ? fx.price.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"}</b>
              <em className={`d2-num is-${toneOf(fx?.change_pct)}`}>{pct(fx?.change_pct)}</em>
              <small>{fx ? (fx.change_pct > 0 ? L("달러 강세 — 원화 기준 수익에 유리", "Strong dollar — helps won returns") : fx.change_pct < 0 ? L("달러 약세 — 원화 기준 수익을 깎음", "Weak dollar — trims won returns") : L("보합", "Flat")) : ""}</small>
              {fx && fx.points.length > 1 && <Spark points={fx.points} tone={toneOf(fx.change_pct)} className="wd-fig-spark" />}
            </div>
            <div className="wd-fig wd-fig--fg">
              <span>{L("공포·탐욕 (미국)", "Fear & Greed (US)")}</span>
              <b className="d2-num">{fg ?? "—"}</b>
              <em>{fg != null ? sentimentLabel(fg, lang) : ""}</em>
              <span className="wd-fg-bar" aria-hidden="true">
                <i style={{ left: `${fg ?? 50}%` }} />
              </span>
            </div>
          </div>

          {pulse && (
            <div className="wd-front-grid">
              <div className="wd-deck">
                <p>
                  {L(
                    `${all.length}종목 가운데 ${pulse.up}종목이 오르고 ${pulse.down}종목이 내렸습니다. 시가총액으로 가중하면 ${pct(pulse.weighted)}, 원화로 환산한 한국 투자자 기준으로는 ${pct(inKrw(pulse.weighted, fxPct))}입니다.`,
                    `Of ${all.length} names, ${pulse.up} rose and ${pulse.down} fell. Cap-weighted that is ${pct(pulse.weighted)}; for a holder in won, ${pct(inKrw(pulse.weighted, fxPct))}.`
                  )}
                </p>
                <p>
                  {L(
                    `섹터 가운데 가장 강한 곳은 ${secName(pulse.best.sector, "ko")}(${pct(pulse.best.move, 1)}), 가장 약한 곳은 ${secName(pulse.worst.sector, "ko")}(${pct(pulse.worst.move, 1)})입니다. 빅테크 7종목은 S&P 500 시가총액의 ${(pulse.techShare * 100).toFixed(0)}%를 차지하며 오늘 ${pct(pulse.techMove)} 움직였습니다.`,
                    `${secName(pulse.best.sector, "en")} is the strongest sector (${pct(pulse.best.move, 1)}), ${secName(pulse.worst.sector, "en")} the weakest (${pct(pulse.worst.move, 1)}). The Big Tech seven are ${(pulse.techShare * 100).toFixed(0)}% of the S&P 500 and moved ${pct(pulse.techMove)}.`
                  )}
                </p>
              </div>
              <div>
                <div className="d2-adbar" role="img" aria-label={`${pulse.up} / ${pulse.flat} / ${pulse.down}`}>
                  <span className="is-up" style={{ flexGrow: pulse.up }}>
                    {pulse.up}
                  </span>
                  <span className="is-flat" style={{ flexGrow: Math.max(pulse.flat, 2) }}>
                    {pulse.flat}
                  </span>
                  <span className="is-down" style={{ flexGrow: pulse.down }}>
                    {pulse.down}
                  </span>
                </div>
                <p className="wd-note">{L("상승 · 보합 · 하락 (S&P 500 ∪ 나스닥 100)", "Up · flat · down (S&P 500 ∪ NASDAQ 100)")}</p>
              </div>
            </div>
          )}
        </section>

        <section id="w-sectors" className="d2-sec" aria-labelledby="w-sectors-h">
          <SectionHead id="w-sectors-h" no="01" kicker={L("섹터 지도", "Sector map")} title={L("S&P 500의 열한 섹터", "The S&P 500's eleven sectors")} note={L("폭은 섹터 시가총액, 색은 시총가중 등락. 누르면 그 섹터의 대장주가 펼쳐집니다.", "Width is the sector's value, shade its weighted move. Click to open its leaders.")} />
          <Sectors pulse={pulse} lensPct={lensPct} lensPrice={lensPrice} lang={lang} />
        </section>

        <section id="w-bigtech" className="d2-sec" aria-labelledby="w-bigtech-h">
          <SectionHead
            id="w-bigtech-h"
            no="02"
            kicker={L("빅테크 7", "Big Tech seven")}
            title={L("지수를 움직이는 일곱 종목", "Seven names that move the index")}
            note={
              pulse
                ? L(
                    `합계 시가총액 ${usd(pulse.techCap)} · S&P 500의 ${(pulse.techShare * 100).toFixed(1)}%${pulse.techContribution != null ? ` · 오늘 S&P 500 기여 ${pulse.techContribution >= 0 ? "+" : "−"}${Math.abs(pulse.techContribution).toFixed(2)}%p` : ""}`,
                    `${usd(pulse.techCap)} combined · ${(pulse.techShare * 100).toFixed(1)}% of the S&P 500${pulse.techContribution != null ? ` · ${pulse.techContribution >= 0 ? "+" : "−"}${Math.abs(pulse.techContribution).toFixed(2)} pts of today's S&P move` : ""}`
                  )
                : undefined
            }
          />
          <BigTech items={pulse?.tech ?? []} lensPct={lensPct} lensPrice={lensPrice} />
        </section>

        <section id="w-ext" className="d2-sec" aria-labelledby="w-ext-h">
          <SectionHead
            id="w-ext-h"
            no="03"
            kicker={L("시간외 레이더", "Extended-hours radar")}
            title={session === "regular" ? L("평소보다 훨씬 많이 거래되는 종목", "Names trading far above their usual volume") : L("정규장 밖에서 움직인 종목", "What moved outside the regular session")}
            note={
              session === "regular"
                ? L("정규장 중에는 평균 거래량 대비 오늘 거래량 배율로 봅니다. 프리마켓·애프터마켓이 열리면 시간외 등락으로 바뀝니다.", "During the session: today's volume against the average. In pre-market and after-hours it switches to the extended move.")
                : L("정규장 종가 대비 시간외 등락입니다. 한국 시각으로 저녁(프리마켓)과 새벽·아침(애프터마켓)에 해당합니다.", "Extended-session moves against the regular close — Seoul's evening (pre-market) and early morning (after-hours).")
            }
          />
          <Extended items={all} session={session} lensPrice={lensPrice} />
        </section>

        <section id="w-rank" className="d2-sec" aria-labelledby="w-rank-h">
          <SectionHead id="w-rank-h" no="04" kicker={L("실시간 순위", "Live rankings")} title={L("뉴욕에서 돈이 몰린 곳", "Where the money went in New York")} note={L("미국 대형주와 해외 ETF를 같은 자리에서. 기준을 바꿔도 다시 불러오지 않습니다.", "US large caps and overseas ETFs side by side. Re-sorting never refetches.")} />
          <Rankings items={all} lensPct={lensPct} lensPrice={lensPrice} lang={lang} />
        </section>

        <section id="w-picks" className="d2-sec" aria-labelledby="w-picks-h">
          <SectionHead id="w-picks-h" no="05" kicker={L("서학개미 픽", "Korean readers' picks")} title={L("이 사이트 독자가 많이 여는 미국 종목", "The US names this site's readers open most")} note={L("원화 가격은 실시간 원/달러 환율로 환산했습니다.", "Won prices use the live USD/KRW rate.")} />
          <Picks items={all} fxRate={fxRate} fxPct={fxPct} />
        </section>

        <section id="w-cross" className="d2-sec" aria-labelledby="w-cross-h">
          <SectionHead id="w-cross-h" no="06" kicker={L("교차 자산", "Cross-asset")} title={L("달러, 금, 기름, 코인", "The dollar, gold, oil and coins")} note={L("선은 최근 흐름입니다.", "Lines are the recent path.")} />
          <Cross ticker={ticker} />
        </section>

        <section id="w-index" className="d2-sec" aria-labelledby="w-index-h">
          <SectionHead id="w-index-h" no="07" kicker={L("세계 지수", "World indices")} title={L("미국, 그리고 아시아와 유럽", "America, and Asia and Europe")} note={L("선은 최근 흐름, 점선은 전일 종가.", "Line is the recent path; the dashed rule is the previous close.")} />
          <GlobalDesk />
        </section>

        <section id="w-cmdty" className="d2-sec" aria-labelledby="w-cmdty-h">
          <SectionHead id="w-cmdty-h" no="08" kicker={L("원자재 · 산업 지표", "Commodities · industry")} title={L("공장과 밭과 광산의 가격", "Prices from the fields, mines and fabs")} />
          <CommodityDesk />
        </section>
      </main>

      <Colophon />
      <Finder open={finderOpen} onClose={() => setFinderOpen(false)} />
    </div>
  );
}

interface SectorRow {
  sector: string;
  cap: number;
  share: number;
  move: number;
  n: number;
  items: MarketMapItem[];
}

function Sectors({
  pulse,
  lensPct,
  lensPrice,
  lang,
}: {
  pulse: { sectors: SectorRow[] } | null;
  lensPct: (r: number | null | undefined) => number | null;
  lensPrice: (v: number) => string;
  lang: Lang;
}) {
  const L = useL();
  const [open, setOpen] = useState<string | null>(null);
  if (!pulse) return <Skel h={180} />;
  const chosen = pulse.sectors.find((s) => s.sector === (open ?? pulse.sectors[0]?.sector)) ?? null;
  return (
    <div className="wd-sectors">
      <div className="wd-strip">
        {pulse.sectors.map((s) => (
          <button
            key={s.sector}
            type="button"
            className={`is-${toneOf(s.move)}${chosen?.sector === s.sector ? " is-me" : ""}${s.share < 0.05 ? " is-thin" : ""}`}
            style={{ flexGrow: s.share * 100, ["--heat" as string]: Math.min(1, Math.abs(s.move) / 2).toFixed(2) }}
            onClick={() => setOpen(s.sector)}
            title={`${secName(s.sector, lang)} ${pct(s.move)} · ${(s.share * 100).toFixed(1)}%`}
          >
            <span>{secName(s.sector, lang)}</span>
            <b>{pct(lensPct(s.move), 1)}</b>
            <small>{(s.share * 100).toFixed(0)}%</small>
          </button>
        ))}
      </div>
      {chosen && (
        <div className="wd-sector-open">
          <h3>
            {secName(chosen.sector, lang)}
            <small>
              {chosen.n}
              {L("종목 · 시총", " names · ")} {usd(chosen.cap)} · <em className={`is-${toneOf(chosen.move)}`}>{pct(lensPct(chosen.move))}</em>
            </small>
          </h3>
          <ol className="wd-rows">
            {chosen.items.slice(0, 8).map((it, i) => (
              <li key={it.code}>
                <Link to={`/stock/${it.code}`}>
                  <span className="wd-rank">{i + 1}</span>
                  <StockLogo code={it.code} name={it.name} className="wd-logo" />
                  <span className="wd-id">
                    <b>{it.code}</b>
                    <small>{cleanName(it.name)}</small>
                  </span>
                  <span className="wd-px">
                    <b className="d2-num">{lensPrice(it.close)}</b>
                    <em className={`d2-num is-${toneOf(lensPct(it.change_pct))}`}>{pct(lensPct(it.change_pct))}</em>
                  </span>
                  <span className="wd-cap d2-num">{usd(capOf(it))}</span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function BigTech({ items, lensPct, lensPrice }: { items: MarketMapItem[]; lensPct: (r: number | null | undefined) => number | null; lensPrice: (v: number) => string }) {
  const L = useL();
  const [spark, setSpark] = useState<Record<string, MarketSparkline>>({});
  const codes = items.map((i) => i.code).join(",");
  useEffect(() => {
    if (!codes) return;
    let alive = true;
    api
      .marketSparklines(codes.split(","), "us")
      .then((r) => alive && setSpark(r.items))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [codes]);
  if (items.length === 0) return <Skel h={220} />;
  const maxCap = Math.max(...items.map(capOf));
  return (
    <ol className="wd-tech">
      {[...items]
        .sort((a, b) => capOf(b) - capOf(a))
        .map((it) => {
          const s = spark[it.code];
          const r20 = s?.returns.d20 ?? null;
          return (
            <li key={it.code}>
              <Link to={`/stock/${it.code}`} className={`is-${toneOf(it.change_pct)}`}>
                <span className="wd-tech-head">
                  <StockLogo code={it.code} name={it.name} className="wd-logo wd-logo--lg" />
                  <span>
                    <b>{it.code}</b>
                    <small>{cleanName(it.name)}</small>
                  </span>
                </span>
                <span className="wd-tech-px">
                  <b className="d2-num">{lensPrice(it.close)}</b>
                  <em className={`d2-num is-${toneOf(lensPct(it.change_pct))}`}>{pct(lensPct(it.change_pct))}</em>
                </span>
                {s && s.points.length > 1 ? <Spark points={s.points} tone={toneOf(s.points[s.points.length - 1] - s.points[0])} className="wd-tech-spark" /> : <Skel h={44} />}
                <span className="wd-tech-foot">
                  <span>
                    {L("시총", "Cap")} <b className="d2-num">{usd(capOf(it))}</b>
                  </span>
                  <span>
                    {L("20일", "20D")} <b className={`d2-num is-${toneOf(r20)}`}>{pct(lensPct(r20))}</b>
                  </span>
                </span>
                <i className="wd-tech-bar" style={{ width: `${(capOf(it) / maxCap) * 100}%` }} aria-hidden="true" />
              </Link>
            </li>
          );
        })}
    </ol>
  );
}

function Extended({ items, session, lensPrice }: { items: MarketMapItem[]; session: string | null; lensPrice: (v: number) => string }) {
  const L = useL();
  const extended = session === "pre" || session === "post";
  const rows = useMemo(() => {
    if (extended) {
      const withExt = items.filter((i) => i.extended_change_pct != null);
      const byExt = [...withExt].sort((a, b) => (b.extended_change_pct ?? 0) - (a.extended_change_pct ?? 0));
      return { up: byExt.slice(0, 6), down: byExt.slice(-6).reverse() };
    }
    const surge = items
      .filter((i) => (i.average_volume ?? 0) > 0 && (i.volume ?? 0) > 0)
      .map((i) => ({ it: i, x: (i.volume ?? 0) / (i.average_volume ?? 1) }))
      .sort((a, b) => b.x - a.x)
      .slice(0, 12);
    return { surge };
  }, [items, extended]);

  if (items.length === 0) return <Skel h={200} />;
  if ("surge" in rows) {
    return (
      <ol className="wd-rows wd-rows--two">
        {rows.surge!.map(({ it, x }, i) => (
          <li key={it.code}>
            <Link to={`/stock/${it.code}`}>
              <span className="wd-rank">{i + 1}</span>
              <StockLogo code={it.code} name={it.name} className="wd-logo" />
              <span className="wd-id">
                <b>{it.code}</b>
                <small>{cleanName(it.name)}</small>
              </span>
              <span className="wd-mult d2-num">×{x.toFixed(1)}</span>
              <span className="wd-px">
                <b className="d2-num">{lensPrice(it.close)}</b>
                <em className={`d2-num is-${toneOf(it.change_pct)}`}>{pct(it.change_pct)}</em>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    );
  }
  const col = (list: MarketMapItem[], title: string) => (
    <div>
      <h3 className="sk-col-head">{title}</h3>
      <ol className="wd-rows">
        {list.map((it, i) => (
          <li key={it.code}>
            <Link to={`/stock/${it.code}`}>
              <span className="wd-rank">{i + 1}</span>
              <StockLogo code={it.code} name={it.name} className="wd-logo" />
              <span className="wd-id">
                <b>{it.code}</b>
                <small>
                  {it.regular_change_pct != null
                    ? `${L("정규장", "Reg.")} ${pct(it.regular_change_pct)}`
                    : it.regular_close
                      ? `${L("전일 종가", "Prev. close")} ${usdPrice(it.regular_close)}`
                      : cleanName(it.name)}
                </small>
              </span>
              <span className="wd-px">
                <b className="d2-num">{lensPrice(it.close)}</b>
                <em className={`d2-num is-${toneOf(it.extended_change_pct)}`}>
                  {L("시간외", "Ext.")} {pct(it.extended_change_pct ?? null)}
                </em>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
  return (
    <div className="wd-two">
      {col(rows.up!, L("시간외 상승", "Extended gainers"))}
      {col(rows.down!, L("시간외 하락", "Extended losers"))}
    </div>
  );
}

type RankKey = "up" | "down" | "turnover" | "cap" | "surge" | "etf";

function Rankings({ items, lensPct, lensPrice, lang }: { items: MarketMapItem[]; lensPct: (r: number | null | undefined) => number | null; lensPrice: (v: number) => string; lang: Lang }) {
  const L = useL();
  const [key, setKey] = useState<RankKey>("turnover");
  const [etfs, setEtfs] = useState<EtfItem[]>([]);
  useEffect(() => {
    if (key !== "etf" || etfs.length) return;
    api
      .etfs("US")
      .then((r) => setEtfs(r.items))
      .catch(() => {});
  }, [key, etfs.length]);

  const rows = useMemo(() => {
    const turn = (i: MarketMapItem) => (i.volume ?? 0) * i.close;
    const list = [...items];
    if (key === "up") list.sort((a, b) => b.change_pct - a.change_pct);
    else if (key === "down") list.sort((a, b) => a.change_pct - b.change_pct);
    else if (key === "turnover") list.sort((a, b) => turn(b) - turn(a));
    else if (key === "cap") list.sort((a, b) => capOf(b) - capOf(a));
    else if (key === "surge") list.sort((a, b) => (b.volume ?? 0) / (b.average_volume || 1) - (a.volume ?? 0) / (a.average_volume || 1));
    return list.slice(0, 15).map((i) => ({
      code: i.code,
      name: i.name,
      close: i.close,
      change: i.change_pct,
      metric: key === "turnover" ? usd(turn(i)) : key === "cap" ? usd(capOf(i)) : key === "surge" ? `×${((i.volume ?? 0) / (i.average_volume || 1)).toFixed(1)}` : secName(i.sector, lang),
    }));
  }, [items, key, lang]);
  const etfRows = useMemo(
    () =>
      [...etfs]
        .sort((a, b) => b.turnover - a.turnover)
        .slice(0, 15)
        .map((e) => ({ code: e.code, name: e.name, close: e.close, change: e.change_pct, metric: usd(e.turnover) })),
    [etfs]
  );
  const shown = key === "etf" ? etfRows : rows;

  return (
    <>
      <Marker
        options={[
          { id: "turnover" as RankKey, label: L("거래대금", "Turnover") },
          { id: "up" as RankKey, label: L("상승률", "Gainers") },
          { id: "down" as RankKey, label: L("하락률", "Losers") },
          { id: "cap" as RankKey, label: L("시가총액", "Market cap") },
          { id: "surge" as RankKey, label: L("거래 급증", "Volume surge") },
          { id: "etf" as RankKey, label: L("해외 ETF", "US ETFs") },
        ]}
        value={key}
        onChange={setKey}
        label={L("순위 기준", "Ranking")}
        className="wd-rank-tabs"
      />
      {shown.length === 0 ? (
        <Skel h={320} />
      ) : (
        <ol className="wd-rows wd-rows--two wd-ranklist">
          {shown.map((r, i) => (
            <li key={r.code}>
              <Link to={key === "etf" ? `/stock/${encodeURIComponent(r.code)}?asset=ETF` : `/stock/${r.code}`}>
                <span className={`wd-rank${i < 3 ? " is-top" : ""}`}>{i + 1}</span>
                <StockLogo code={r.code} name={r.name} className="wd-logo" assetType={key === "etf" ? "etf" : "stock"} />
                <span className="wd-id">
                  <b>{key === "etf" ? r.name : r.code}</b>
                  <small>{key === "etf" ? r.code : `${cleanName(r.name)} · ${r.metric}`}</small>
                </span>
                <span className="wd-px">
                  <b className="d2-num">{lensPrice(r.close)}</b>
                  <em className={`d2-num is-${toneOf(lensPct(r.change))}`}>{pct(lensPct(r.change))}</em>
                </span>
                {key === "etf" && <span className="wd-cap d2-num">{r.metric}</span>}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function Picks({ items, fxRate, fxPct }: { items: MarketMapItem[]; fxRate: number | null; fxPct: number }) {
  const L = useL();
  const popular = usePopularStocks(10, "US");
  const [quotes, setQuotes] = useState<Record<string, { close: number; change_pct: number; name: string }>>({});
  const missing = (popular ?? []).filter((p) => !items.some((i) => i.code === p.code)).map((p) => p.code);
  const missingKey = missing.join(",");
  useEffect(() => {
    if (!missingKey) return;
    let alive = true;
    Promise.all(missingKey.split(",").map((c) => api.usStockQuote(c).catch(() => null))).then((rs) => {
      if (!alive) return;
      const next: Record<string, { close: number; change_pct: number; name: string }> = {};
      rs.forEach((q) => q && (next[q.code] = { close: q.close, change_pct: q.change_pct, name: q.name }));
      setQuotes(next);
    });
    return () => {
      alive = false;
    };
  }, [missingKey]);
  if (!popular) return <Skel h={220} />;
  const unique = popular.filter((p, i) => popular.findIndex((x) => x.code === p.code) === i).slice(0, 8);
  if (unique.length === 0) return <p className="d2-empty">{L("아직 집계된 조회가 없습니다.", "No views counted yet.")}</p>;
  return (
    <ol className="wd-picks">
      {unique.map((p, i) => {
        const it = items.find((x) => x.code === p.code);
        const q = it ? { close: it.close, change_pct: it.change_pct, name: it.name } : quotes[p.code];
        const krw = q && fxRate ? Math.round(q.close * fxRate) : null;
        return (
          <li key={p.code}>
            <Link to={`/stock/${p.code}`}>
              <span className="wd-pick-no">{i + 1}</span>
              <StockLogo code={p.code} name={p.name} className="wd-logo wd-logo--lg" />
              <span className="wd-id">
                <b>{p.code}</b>
                <small>{cleanName(q?.name ?? p.name)}</small>
              </span>
              <span className="wd-pick-px">
                <b className="d2-num">{krw != null ? `${krw.toLocaleString()}원` : "—"}</b>
                <small className="d2-num">{q ? usdPrice(q.close) : ""}</small>
              </span>
              <span className="wd-pick-ret">
                <em className={`d2-num is-${toneOf(q ? inKrw(q.change_pct, fxPct) : null)}`}>{q ? pct(inKrw(q.change_pct, fxPct)) : "—"}</em>
                <small>{L("원화 기준", "in won")}</small>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

const CROSS: { group: { ko: string; en: string }; symbols: string[] }[] = [
  { group: { ko: "환율", en: "FX" }, symbols: ["KRW=X", "JPYKRW=X", "EURKRW=X", "GBPKRW=X"] },
  { group: { ko: "원자재", en: "Commodities" }, symbols: ["GC=F", "SI=F", "CL=F"] },
  { group: { ko: "암호화폐", en: "Crypto" }, symbols: ["BTC-USD", "ETH-USD", "XRP-USD"] },
];

function Cross({ ticker }: { ticker: MarketTickerItem[] }) {
  const L = useL();
  if (ticker.length === 0) return <Skel h={200} />;
  return (
    <div className="wd-cross">
      {CROSS.map((g) => (
        <div key={g.group.ko}>
          <h3 className="sk-col-head">{L(g.group.ko, g.group.en)}</h3>
          <ul>
            {g.symbols.map((sym) => {
              const t = ticker.find((x) => x.symbol === sym);
              if (!t) return null;
              return (
                <li key={sym}>
                  <span className="wd-cross-name">{t.label}</span>
                  <Spark points={t.points} tone={toneOf(t.change_pct)} className="wd-cross-spark" />
                  <b className="d2-num">{t.price.toLocaleString("en-US", { maximumFractionDigits: t.price < 10 ? 4 : 2 })}</b>
                  <em className={`d2-num is-${toneOf(t.change_pct)}`}>{pct(t.change_pct)}</em>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
