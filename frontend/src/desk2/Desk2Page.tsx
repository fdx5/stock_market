import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { reportStockView } from "../useActivityTracking";
import { useDocumentTitle } from "../useDocumentTitle";
import { useMarketSnapshot } from "../useMarketSnapshot";
import { recordRecent } from "../watchlist";
import BreadthDesk from "./BreadthDesk";
import Colophon from "./Colophon";
import CommandBar, { DeskSection } from "./CommandBar";
import CommodityDesk from "./CommodityDesk";
import Finder from "./Finder";
import FlowDesk from "./FlowDesk";
import FrontPage from "./FrontPage";
import GlobalDesk from "./GlobalDesk";
import IndexDesk from "./IndexDesk";
import Masthead from "./Masthead";
import MobileDock from "./MobileDock";
import RankingDesk from "./RankingDesk";
import { Radar, Talk } from "./RoomDesk";
import SpotlightDesk from "./SpotlightDesk";
import Tape from "./Tape";
import { SectionHead } from "./parts";
import { measureBreadth, useL } from "./lib";
import "./desk2.css";

/* /desk2 — the market desk, reset as a live broadsheet.
 *
 * Every panel the classic desk renders has a place here, fed by the same hooks
 * and endpoints (see the report for the one-to-one map). What changed is the
 * page itself: a masthead with a live dateline and session rail instead of a
 * header strip, a front page written from the numbers instead of a row of
 * widgets, numbered sections with a sticky index instead of a side rail, one
 * finder instead of a search box plus a palette, and a type system — serif for
 * headlines, Pretendard for reading, a mono for every figure — instead of the
 * system font.
 *
 * It is its own route and its own stylesheet, scoped under `.d2` and a class on
 * <html>, so nothing here can leak into the classic desk or any other page. */

const SECTIONS: DeskSection[] = [
  { id: "d2-front", no: "00", ko: "1면", en: "Front" },
  { id: "d2-index", no: "01", ko: "지수", en: "Indices" },
  { id: "d2-breadth", no: "02", ko: "시장 폭", en: "Breadth" },
  { id: "d2-global", no: "03", ko: "해외", en: "Global" },
  { id: "d2-rank", no: "04", ko: "순위", en: "Rankings" },
  { id: "d2-flow", no: "05", ko: "수급", en: "Flows" },
  { id: "d2-room", no: "06", ko: "토론", en: "Talk" },
  { id: "d2-spot", no: "07", ko: "주목", en: "Spotlight" },
  { id: "d2-cmdty", no: "08", ko: "원자재", en: "Commodities" },
];

const FONT_LINKS = [
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css",
  "https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@500;700;900&family=IBM+Plex+Mono:wght@400;500;600&display=swap",
];

/** Loads the desk's three families once, only on this route. */
function useDeskFonts() {
  useEffect(() => {
    const added: HTMLLinkElement[] = [];
    for (const href of FONT_LINKS) {
      if (document.querySelector(`link[href="${href}"]`)) continue;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
      added.push(link);
    }
    // Left in place on unmount: a reader flipping back to the desk should not
    // re-download three font files, and nothing else references these names.
  }, []);
}

/** The page chrome that lives outside React's tree: the <html> class the theme
 * tokens hang off, and a noindex while this is a preview route beside /desk. */
function useDocumentShell() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("is-desk2");
    const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const previous = robots?.getAttribute("content") ?? null;
    robots?.setAttribute("content", "noindex,follow");
    return () => {
      root.classList.remove("is-desk2");
      if (robots && previous !== null) robots.setAttribute("content", previous);
    };
  }, []);
}

function stickyOffset(): number {
  const bar = document.querySelector<HTMLElement>("[data-d2-sticky]");
  if (!bar) return 12;
  const pos = window.getComputedStyle(bar).position;
  return (pos === "sticky" || pos === "fixed" ? bar.getBoundingClientRect().height : 0) + 12;
}

export default function Desk2Page() {
  const L = useL();
  useDeskFonts();
  useDocumentShell();
  useDocumentTitle("마켓 데스크 · 시장일보 | K-Stock Hub");

  const [finderOpen, setFinderOpen] = useState(false);
  const [active, setActive] = useState(SECTIONS[0].id);
  const code = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get("code") ?? "";
    return /^\d[0-9A-Z]{5}$/i.test(raw) ? raw.toUpperCase() : "005930";
  }, []);

  /* A ?code= arrival counts as a visit to that stock, as it did on the classic
     desk; the default Samsung does not, or every desk view would inflate it. */
  useEffect(() => {
    const explicit = new URLSearchParams(window.location.search).get("code");
    if (!explicit) return;
    let cancelled = false;
    api
      .summary(code)
      .then((s) => {
        if (cancelled) return;
        reportStockView(s.code, s.name);
        recordRecent({ code: s.code, name: s.name, market: "KOSPI" });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code]);

  /* ⌘K / Ctrl-K anywhere, "/" when nothing is being typed into. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setFinderOpen((v) => !v);
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        setFinderOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* Scrollspy on a band a third of the way down the screen. */
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: "-30% 0px -60% 0px" }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const jump = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - stickyOffset(), behavior: reduce ? "auto" : "smooth" });
    setActive(id);
  }, []);

  const snapshot = useMarketSnapshot();
  const breadth = useMemo(() => measureBreadth([...snapshot.kospi, ...snapshot.kosdaq]), [snapshot.kospi, snapshot.kosdaq]);
  const asOf = snapshot.generatedAt
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(snapshot.generatedAt))
    : null;

  return (
    <div className="d2">
      <a className="d2-skip" href="#d2-front">
        {L("본문 바로가기", "Skip to content")}
      </a>
      <Masthead onPrint={() => window.print()} />
      <Tape />
      <CommandBar sections={SECTIONS} active={active} onJump={jump} onFind={() => setFinderOpen(true)} />

      <main className="d2-main">
        <section id="d2-front" className="d2-sec d2-sec--front" aria-label={L("1면", "Front page")}>
          <FrontPage breadth={breadth} asOf={asOf} />
        </section>

        <section id="d2-index" className="d2-sec" aria-labelledby="d2-index-h">
          <SectionHead
            id="d2-index-h"
            no="01"
            kicker={L("지수 · 수급 · 환율", "Indices · flows · FX")}
            title={L("오늘의 두 지수와 그 뒤의 돈", "Two indices, and the money behind them")}
            note={L("지수 아래 막대는 시장 전체의 투자자별 누적 순매수(억원). 두 시장이 같은 눈금을 씁니다.", "Bars show cumulative net buying by investor type (KRW 100M), on one scale for both markets.")}
          />
          <IndexDesk />
        </section>

        <section id="d2-breadth" className="d2-sec" aria-labelledby="d2-breadth-h">
          <SectionHead
            id="d2-breadth-h"
            no="02"
            kicker={L("시장 폭", "Market breadth")}
            title={L("지수가 말하지 않는 것", "What the index doesn't say")}
            note={
              breadth
                ? L(`코스피 500 · 코스닥 200, 모두 ${breadth.total.toLocaleString()}종목의 오늘`, `Today across all ${breadth.total.toLocaleString()} KOSPI 500 and KOSDAQ 200 names`)
                : L("코스피 500 · 코스닥 200 전 종목 기준", "Across the KOSPI 500 and KOSDAQ 200")
            }
          />
          <BreadthDesk breadth={breadth} />
        </section>

        <section id="d2-global" className="d2-sec" aria-labelledby="d2-global-h">
          <SectionHead
            id="d2-global-h"
            no="03"
            kicker={L("해외 증시", "Global markets")}
            title={L("밤사이, 그리고 지금 바다 건너", "Overnight, and across the water now")}
            note={L("선은 최근 흐름, 점선은 전일 종가.", "Line is the recent path; the dashed rule is the previous close.")}
          />
          <GlobalDesk />
        </section>

        <section id="d2-rank" className="d2-sec" aria-labelledby="d2-rank-h">
          <SectionHead
            id="d2-rank-h"
            no="04"
            kicker={L("실시간 순위", "Live rankings")}
            title={L("돈이 몰린 곳, 많이 움직인 곳", "Where the money went, what moved")}
            note={L("기준을 바꿔도 다시 불러오지 않습니다 — 이미 받아 둔 전 종목을 다시 정렬할 뿐입니다.", "Switching the ordering never refetches — it re-sorts the whole universe already on the page.")}
          />
          <RankingDesk />
        </section>

        <section id="d2-flow" className="d2-sec" aria-labelledby="d2-flow-h">
          <SectionHead id="d2-flow-h" no="05" kicker={L("수급 표", "Flow tables")} title={L("누가 사고, 누가 팔았나", "Who bought, who sold")} />
          <FlowDesk />
        </section>

        <section id="d2-room" className="d2-sec" aria-labelledby="d2-room-h">
          <SectionHead
            id="d2-room-h"
            no="06"
            kicker={L("레이더 · 종목 토론", "Radar · discussion")}
            title={L("사람들이 보고, 말하는 종목", "What people are watching, and saying")}
            note={L("왼쪽은 이 사이트 방문자가 많이 연 종목, 오른쪽은 오늘의 화제 종목 토론방 최신 글.", "Left: names this site's readers open most. Right: the newest posts on today's busiest boards.")}
          />
          <div className="d2-room">
            <Radar />
            <Talk />
          </div>
        </section>

        <section id="d2-spot" className="d2-sec" aria-labelledby="d2-spot-h">
          <SectionHead id="d2-spot-h" no="07" kicker={L("오늘의 주목 종목", "In focus today")} title={L("숫자가 고른 여덟, 그리고 ETF 넷", "Eight picked by the numbers, and four ETFs")} />
          <SpotlightDesk />
        </section>

        <section id="d2-cmdty" className="d2-sec" aria-labelledby="d2-cmdty-h">
          <SectionHead id="d2-cmdty-h" no="08" kicker={L("원자재 · 산업 지표", "Commodities · industry")} title={L("공장과 밭과 광산의 가격", "Prices from the fields, mines and fabs")} />
          <CommodityDesk />
        </section>
      </main>

      <Colophon />
      <MobileDock sections={SECTIONS} active={active} onJump={jump} onFind={() => setFinderOpen(true)} code={code} />
      <Finder open={finderOpen} onClose={() => setFinderOpen(false)} />
    </div>
  );
}
