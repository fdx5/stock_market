import { useEffect, useMemo, useRef, useState } from "react";
import { GlobalTop20Item, api } from "../../api/client";
import CompanyLogo from "../../components/CompanyLogo";
import { COMPANY_SHORT_NAMES } from "../../data/companyShortNames";
import { hiResFlagUrl } from "../../data/flagCodes";
import { useLanguage } from "../../i18n/LanguageContext";
import { useTranslatedText } from "../../i18n/useTranslatedTexts";
import { Link } from "../../router";
import { useDocumentTitle } from "../../useDocumentTitle";
import Colophon from "../Colophon";
import Finder from "../Finder";
import Masthead from "../Masthead";
import { Skel } from "../parts";
import { pct, toneOf, useL } from "../lib";
import { jumpTo, useBroadsheet, useFinderHotkey } from "../shell";
import { Article, newsDate, useCompanyNews } from "./shared";
import "../pages.css";
import "./news.css";

/* 국제면 — the world's twenty largest companies, in the news today.
 *
 * Kept: the roster of the global top 20 as tabs, twelve stories per company from the
 * same endpoint, the in-place article reader with its fallback to the snippet and
 * the link to the original, and translation of foreign stories.
 *
 * New:
 *  - the stories are set as a page: a lead with its picture, two seconds, and the
 *    rest as a numbered column — the order the source ranked them in;
 *  - a company line above them: rank, value, today's move, and a way into the
 *    company's cap fight;
 *  - search across the headlines and a filter by outlet;
 *  - in the reader, 이전 기사 / 다음 기사 and ← / →, so a reader goes through the
 *    stories without going back to the list each time;
 *  - the company and the open story live in the URL. */

const LIMIT = 12;

function Tab({ item, active, onSelect }: { item: GlobalTop20Item; active: boolean; onSelect: () => void }) {
  const translated = useTranslatedText(item.name);
  const label = COMPANY_SHORT_NAMES[item.code] ?? translated;
  return (
    <button type="button" role="tab" aria-selected={active} className={active ? "is-on" : ""} onClick={onSelect} title={translated}>
      <CompanyLogo item={item} className="nw-tab-logo" />
      <span>{label}</span>
    </button>
  );
}

function readUrl() {
  const p = new URLSearchParams(window.location.search);
  const a = Number(p.get("a"));
  return { c: p.get("c"), a: Number.isInteger(a) && p.has("a") ? a : null };
}

export default function NewsPage() {
  const { lang } = useLanguage();
  const L = useL();
  useBroadsheet();
  useDocumentTitle("글로벌 뉴스 | K-Stock Hub");
  const init = useMemo(readUrl, []);
  const [roster, setRoster] = useState<GlobalTop20Item[]>([]);
  const [rosterError, setRosterError] = useState("");
  const [activeCode, setActiveCode] = useState<string | null>(init.c);
  const [openAt, setOpenAt] = useState<number | null>(init.a);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [finderOpen, setFinderOpen] = useState(false);
  useFinderHotkey(setFinderOpen);
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .globalTop20()
      .then((r) => {
        setRoster(r.items);
        setActiveCode((c) => (c && r.items.some((i) => i.code === c) ? c : r.items[0]?.code ?? null));
      })
      .catch((e: Error) => setRosterError(e.message || L("글로벌 TOP20 데이터를 불러오지 못했습니다.", "Could not load the roster.")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = roster.find((r) => r.code === activeCode) ?? null;
  const { items, loading, error } = useCompanyNews(active, LIMIT);
  const activeName = useTranslatedText(active?.name ?? "");

  // Keep the chosen tab in view in the scrolling strip.
  useEffect(() => {
    const strip = tabsRef.current;
    const tab = strip?.querySelector<HTMLElement>(".is-on");
    if (strip && tab) strip.scrollLeft = tab.offsetLeft - strip.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2;
  }, [activeCode, roster.length]);

  useEffect(() => {
    const p = new URLSearchParams();
    if (activeCode && roster[0] && activeCode !== roster[0].code) p.set("c", activeCode);
    if (openAt !== null) {
      if (activeCode) p.set("c", activeCode);
      p.set("a", String(openAt));
    }
    const next = `${window.location.pathname}${p.toString() ? `?${p}` : ""}`;
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, "", next);
  }, [activeCode, openAt, roster]);

  const sources = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) m.set(it.source, (m.get(it.source) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => (!source || it.source === source) && (!needle || it.title.toLowerCase().includes(needle) || (it.snippet ?? "").toLowerCase().includes(needle)));
  }, [items, query, source]);

  const choose = (code: string) => {
    setActiveCode(code);
    setOpenAt(null);
    setSource("");
    setQuery("");
  };
  const open = (i: number) => {
    setOpenAt(i);
    window.setTimeout(() => jumpTo("nw-stories"), 0);
  };
  const reading = openAt !== null && items[openAt] ? items[openAt] : null;
  const order = shown.map((s) => s.i);
  const pos = openAt !== null ? order.indexOf(openAt) : -1;
  const step = (d: -1 | 1) => {
    const next = order[pos + d];
    if (next !== undefined) setOpenAt(next);
  };

  useEffect(() => {
    if (!reading) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") setOpenAt(null);
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const next = order[pos + (e.key === "ArrowLeft" ? -1 : 1)];
        if (next !== undefined) {
          e.preventDefault();
          setOpenAt(next);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reading, order, pos]);

  const [lead, ...rest] = shown;
  const seconds = rest.slice(0, 2);
  const column = rest.slice(2);
  const flag = active ? hiResFlagUrl(active.country) ?? active.flag_url : null;
  const fightWith = active ? roster.find((r) => r.code !== active.code) : null;

  return (
    <div className="d2 nw" lang={lang}>
      <a className="d2-skip" href="#nw-stories">
        {L("본문 바로가기", "Skip to content")}
      </a>
      <Masthead
        rail={false}
        onPrint={() => window.print()}
        section={{ ko: "뉴스", en: "World Business", taglineKo: "세계 시가총액 20대 기업, 오늘의 기사", taglineEn: "The world's twenty largest companies in today's news" }}
      />

      <div className="d2-cmd nw-bar" data-d2-sticky>
        <div className="d2-cmd-inner nw-bar-inner">
          <div className="nw-tabs" role="tablist" aria-label={L("기업 선택", "Company")} ref={tabsRef}>
            {roster.length === 0 && !rosterError && Array.from({ length: 8 }, (_, i) => <Skel key={i} w={92} h={30} />)}
            {roster.map((r) => (
              <Tab key={r.code} item={r} active={r.code === activeCode} onSelect={() => choose(r.code)} />
            ))}
          </div>
        </div>
      </div>

      <main className="d2-main">
        {rosterError && <p className="d2-empty">{rosterError}</p>}
        {active && (
          <section className="d2-sec nw-company" aria-label={L("기업 정보", "Company")}>
            <CompanyLogo item={active} className="nw-company-logo" />
            <div>
              <p className="d2-lead-kicker">
                <span className="d2-lead-status">{L(`세계 시총 ${active.rank}위`, `No. ${active.rank} by value`)}</span>
                <span>
                  {flag && <img src={flag} alt="" className="nw-flag" />}
                  {active.country}
                </span>
                <span>{active.code}</span>
              </p>
              <h2>{activeName}</h2>
            </div>
            <dl>
              <div>
                <dt>{L("시가총액", "Market value")}</dt>
                <dd>{lang === "ko" ? `$${(active.marcap_usd / 1e12).toFixed(2)}조` : `$${(active.marcap_usd / 1e12).toFixed(2)}T`}</dd>
              </div>
              <div>
                <dt>{L("오늘", "Today")}</dt>
                <dd className={`is-${toneOf(active.change_pct)}`}>{pct(active.change_pct)}</dd>
              </div>
            </dl>
            {fightWith && (
              <Link to={`/fight?a=${encodeURIComponent(active.code)}&b=${encodeURIComponent(fightWith.code)}`} className="d2-more nw-fight">
                {L(`${fightWith.name} 상대로 시총 대결`, `Cap fight vs ${fightWith.name}`)} →
              </Link>
            )}
          </section>
        )}

        <section id="nw-stories" className="d2-sec nw-stories" aria-label={L("기사", "Stories")}>
          {reading && active ? (
            <Article item={reading} code={active.code} onBack={() => setOpenAt(null)} onStep={step} position={{ at: Math.max(0, pos), of: order.length }} />
          ) : (
            <>
              <div className="nw-tools">
                <label className="st-search">
                  <span aria-hidden="true">⌕</span>
                  <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={L("제목 · 요약에서 찾기", "Search the headlines")} aria-label={L("기사 검색", "Search stories")} autoComplete="off" />
                  {query && (
                    <button type="button" onClick={() => setQuery("")} aria-label={L("지우기", "Clear")}>
                      ×
                    </button>
                  )}
                </label>
                {sources.length > 1 && (
                  <div className="st-chips" role="group" aria-label={L("언론사", "Outlet")}>
                    <button type="button" className={!source ? "is-on" : ""} onClick={() => setSource("")}>
                      {L("전체", "All")}
                      <small>{items.length}</small>
                    </button>
                    {sources.slice(0, 8).map(([s, n]) => (
                      <button key={s} type="button" className={source === s ? "is-on" : ""} onClick={() => setSource(source === s ? "" : s)}>
                        {s}
                        <small>{n}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {loading && (
                <div className="nw-layout">
                  <Skel h={360} />
                  <div className="nw-seconds">
                    <Skel h={170} />
                    <Skel h={170} />
                  </div>
                </div>
              )}
              {error && <p className="d2-empty">{error}</p>}
              {!loading && !error && items.length === 0 && active && <p className="d2-empty">{L("최근 뉴스가 없습니다.", "No recent stories.")}</p>}
              {!loading && items.length > 0 && shown.length === 0 && <p className="d2-empty">{L("조건에 맞는 기사가 없습니다.", "No stories match.")}</p>}

              {!loading && lead && active && (
                <div className="nw-layout">
                  <button type="button" className="nw-lead" onClick={() => open(lead.i)}>
                    {lead.it.image_url ? (
                      <img src={lead.it.image_url} alt="" loading="lazy" />
                    ) : (
                      <span className="nw-noimg">
                        <CompanyLogo item={active} className="nw-noimg-logo" />
                      </span>
                    )}
                    <span className="nw-meta">
                      <b>{lead.it.source}</b>
                      {newsDate(lead.it, lang)}
                    </span>
                    <span className="nw-lead-head">{lead.it.title}</span>
                    {lead.it.snippet && <span className="nw-lead-deck">{lead.it.snippet}</span>}
                  </button>
                  <div className="nw-seconds">
                    {seconds.map(({ it, i }) => (
                      <button key={i} type="button" className="nw-second" onClick={() => open(i)}>
                        {it.image_url && <img src={it.image_url} alt="" loading="lazy" />}
                        <span className="nw-meta">
                          <b>{it.source}</b>
                          {newsDate(it, lang)}
                        </span>
                        <span className="nw-second-head">{it.title}</span>
                        {it.snippet && <span className="nw-second-deck">{it.snippet}</span>}
                      </button>
                    ))}
                  </div>
                  {column.length > 0 && (
                    <ol className="nw-column">
                      {column.map(({ it, i }) => (
                        <li key={i}>
                          <button type="button" onClick={() => open(i)}>
                            <span className="nw-meta">
                              <b>{it.source}</b>
                              {newsDate(it, lang)}
                            </span>
                            <span className="nw-column-head">{it.title}</span>
                            {it.snippet && <span className="nw-column-deck">{it.snippet}</span>}
                          </button>
                          {it.image_url && <img src={it.image_url} alt="" loading="lazy" />}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </>
          )}
          <p className="sk-disclaimer">
            {L(
              "기사는 공개 뉴스 검색 결과를 모은 것이며, 해외 기사는 자동 번역되어 원문과 표현이 다를 수 있습니다. 저작권은 각 언론사에 있습니다.",
              "Stories are gathered from public news search; foreign articles are machine-translated and may differ from the original. Copyright belongs to each outlet."
            )}
          </p>
        </section>
      </main>

      <Colophon />
      <Finder open={finderOpen} onClose={() => setFinderOpen(false)} />
    </div>
  );
}
