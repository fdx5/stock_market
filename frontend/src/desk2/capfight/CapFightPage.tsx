import { useEffect, useMemo, useRef, useState } from "react";
import { FightComment, GlobalTop20Item, api } from "../../api/client";
import CompanyLogo from "../../components/CompanyLogo";
import { CEO_NAMES } from "../../data/ceoNames";
import { ceoStylizedImageFor } from "../../data/ceoStylizedImages";
import { generateNickname } from "../../data/cheerNames";
import { hiResFlagUrl } from "../../data/flagCodes";
import { productImageFor } from "../../data/productImages";
import { useLanguage } from "../../i18n/LanguageContext";
import { useTranslatedText, useTranslatedTexts } from "../../i18n/useTranslatedTexts";
import { startVisibilityAwareInterval } from "../../pollVisibility";
import { Link } from "../../router";
import { useBodyScrollLock } from "../../useBodyScrollLock";
import { useDocumentTitle } from "../../useDocumentTitle";
import Colophon from "../Colophon";
import Finder from "../Finder";
import Masthead from "../Masthead";
import { SectionHead, Skel } from "../parts";
import { pct, toneOf, useL } from "../lib";
import { useBroadsheet, useFinderHotkey } from "../shell";
import { Article, newsDate, useCompanyNews } from "../news/shared";
import "../pages.css";
import "../news/news.css";
import "./capfight.css";

/* 시총대결 — two of the world's twenty largest companies, weighed against each other.
 *
 * The classic page's whole flow is here: pick 1P and 2P from the global top 20 (a
 * second click on a pick clears it), each side's flag, CEO and a three-line company
 * intro typed out, a 3-2-1 once both have finished, then the result: each side's
 * share of the combined value as a tug of war that re-draws every nine seconds, the
 * values and day moves polled every three seconds, the leader and the gap, the CEO
 * portrait opening the company profile, each side's news with an in-place reader,
 * 다시 선택, the 삼성 vs SK하이닉스 link, and the cheer board with its counts, gauge,
 * nickname posting, thank-you flash and 더보기.
 *
 * New:
 *  - the result is set as a report: a headline saying who leads and by how much,
 *    each side as a column of facts, and 역전 조건 — how far the trailing side's
 *    price has to rise, all else equal, to draw level;
 *  - 추천 대진: the top two, today's best against today's worst, the two nearest
 *    in size — one click each;
 *  - 좌우 바꾸기;
 *  - the matchup lives in the URL (?a=NVDA&b=AAPL), so a result can be shared and
 *    opened straight to the fight. */

const INTRO_MAX = 130;
const TYPE_MS = 16;
const INTRO_CACHE = new Map<string, string>();
type Side = "p1" | "p2";

function trimIntro(text: string): string {
  const sentences = text.trim().split(/(?<=[.!?。])\s+/);
  let out = "";
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (out && next.length > INTRO_MAX) break;
    out = next;
    if (next.length > INTRO_MAX) break;
  }
  return out;
}

function useIntro(item: GlobalTop20Item | null, lang: string): string | null {
  const [intro, setIntro] = useState<string | null>(null);
  useEffect(() => {
    if (!item) return setIntro(null);
    if (!item.detail_path) return setIntro("");
    const key = `${item.detail_path}:${lang}`;
    const hit = INTRO_CACHE.get(key);
    if (hit !== undefined) return setIntro(hit);
    let cancelled = false;
    setIntro(null);
    api
      .companyDetail(item.detail_path, lang)
      .then((r) => {
        const t = trimIntro(r.description || "");
        INTRO_CACHE.set(key, t);
        if (!cancelled) setIntro(t);
      })
      .catch(() => !cancelled && setIntro(""));
    return () => {
      cancelled = true;
    };
  }, [item?.code, item?.detail_path, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  return intro;
}

/** Types the intro out and reports once it is done — the countdown waits on both. */
function Typed({ text, onDone }: { text: string; onDone: () => void }) {
  const [n, setN] = useState(0);
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    setN(reduce ? text.length : 0);
    if (!text || reduce) return;
    const id = window.setInterval(() => setN((c) => (c >= text.length ? (window.clearInterval(id), c) : c + 1)), TYPE_MS);
    return () => window.clearInterval(id);
  }, [text, reduce]);
  const done = n >= text.length;
  useEffect(() => {
    if (done) onDone();
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <p className="cf-intro">
      {text.slice(0, n)}
      {!done && <i className="cf-caret" aria-hidden="true" />}
    </p>
  );
}

const trillion = (usd: number, lang: "ko" | "en") => (lang === "ko" ? `$${(usd / 1e12).toFixed(2)}조` : `$${(usd / 1e12).toFixed(2)}T`);

function Corner({ item, side, intro, onIntroDone }: { item: GlobalTop20Item | null; side: Side; intro: string | null; onIntroDone: () => void }) {
  const L = useL();
  const name = useTranslatedText(item?.name ?? "");
  if (!item) {
    return (
      <div className={`cf-corner is-${side} is-empty`}>
        <span className="cf-corner-tag">{side === "p1" ? "1P" : "2P"}</span>
        <span className="cf-corner-q">?</span>
        <p>{side === "p1" ? L("아래 명단에서 첫 번째 기업을 고르세요", "Pick the first company below") : L("두 번째 기업을 고르세요", "Now pick the second")}</p>
      </div>
    );
  }
  const ceo = CEO_NAMES[item.code];
  const portrait = ceoStylizedImageFor(item.code);
  const flag = hiResFlagUrl(item.country) ?? item.flag_url;
  return (
    <div className={`cf-corner is-${side}`}>
      <span className="cf-corner-tag">{side === "p1" ? "1P" : "2P"}</span>
      <div className="cf-corner-pics">
        <CompanyLogo item={item} className="cf-logo" />
        {portrait && <img src={portrait} alt={ceo ?? item.name} className="cf-portrait" />}
        {flag && <img src={flag} alt={item.country} className="cf-flag" />}
      </div>
      <h3>{name}</h3>
      <p className="cf-corner-meta">
        {L(`세계 ${item.rank}위`, `World No. ${item.rank}`)} · {trillion(item.marcap_usd, "ko")}
        {ceo && <> · CEO {ceo}</>}
      </p>
      {intro === null ? <p className="cf-intro d2-muted">{L("회사 소개를 불러오는 중…", "Loading the profile…")}</p> : <Typed text={intro} onDone={onIntroDone} />}
    </div>
  );
}

function CompanySheet({ item, side, onClose }: { item: GlobalTop20Item; side: Side; onClose: () => void }) {
  const L = useL();
  const { lang } = useLanguage();
  useBodyScrollLock(true);
  const [desc, setDesc] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!item.detail_path) return setError(L("회사 정보가 없습니다.", "No profile on file."));
    api
      .companyDetail(item.detail_path, lang)
      .then((r) => setDesc(r.description || L("회사 정보가 없습니다.", "No profile on file.")))
      .catch((e: Error) => setError(e.message || L("회사 정보를 불러오지 못했습니다.", "Could not load the profile.")));
  }, [item.detail_path, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const ceo = CEO_NAMES[item.code];
  const portrait = ceoStylizedImageFor(item.code);
  const product = productImageFor(item.code);
  const flag = hiResFlagUrl(item.country) ?? item.flag_url;
  return (
    <div className="d2-find-scrim cf-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className={`d2-find cf-sheet is-${side}`} role="dialog" aria-modal="true" aria-label={item.name}>
        <div className="cf-sheet-hero" style={product ? { backgroundImage: `url(${product})` } : undefined}>
          {portrait && <img src={portrait} alt={ceo ?? item.name} className="cf-sheet-ceo" />}
          <CompanyLogo item={item} className="cf-logo cf-sheet-logo" />
          <button type="button" className="st-sheet-close" onClick={onClose} aria-label={L("닫기", "Close")}>
            ×
          </button>
        </div>
        <div className="cf-sheet-body">
          <p className="d2-lead-kicker">
            <span className="d2-lead-status">{L(`세계 시총 ${item.rank}위`, `World No. ${item.rank}`)}</span>
            <span>
              {flag && <img src={flag} alt="" className="nw-flag" />}
              {item.country}
            </span>
          </p>
          <h2>{item.name}</h2>
          {ceo && <p className="cf-sheet-ceo-name">CEO · {ceo}</p>}
          {error && <p className="d2-empty">{error}</p>}
          {!desc && !error && (
            <div className="nw-article-skel">
              <Skel h={14} />
              <Skel h={14} />
              <Skel h={14} w="60%" />
            </div>
          )}
          {desc && <p className="cf-sheet-desc">{desc}</p>}
        </div>
      </section>
    </div>
  );
}

function NewsSheet({ item, side, onClose }: { item: GlobalTop20Item; side: Side; onClose: () => void }) {
  const L = useL();
  const { lang } = useLanguage();
  useBodyScrollLock(true);
  const company = useMemo(() => ({ code: item.code, name: item.name }), [item.code, item.name]);
  const { items, loading, error } = useCompanyNews(company, 6);
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && (at !== null ? setAt(null) : onClose());
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, at]);
  return (
    <div className="d2-find-scrim cf-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className={`d2-find cf-news is-${side}`} role="dialog" aria-modal="true" aria-label={`${item.name} ${L("주요 뉴스", "news")}`}>
        <header className="cf-news-head">
          <CompanyLogo item={item} className="cf-logo cf-logo--sm" />
          <h2>
            {item.name} <small>{L("주요 뉴스", "in the news")}</small>
          </h2>
          <button type="button" className="st-sheet-close" onClick={onClose} aria-label={L("닫기", "Close")}>
            ×
          </button>
        </header>
        <div className="cf-news-body">
          {at !== null && items[at] ? (
            <Article item={items[at]} code={item.code} onBack={() => setAt(null)} onStep={(d) => setAt((a) => Math.min(items.length - 1, Math.max(0, (a ?? 0) + d)))} position={{ at, of: items.length }} />
          ) : (
            <>
              {loading && Array.from({ length: 4 }, (_, i) => <Skel key={i} h={70} className="cf-news-skel" />)}
              {error && <p className="d2-empty">{error}</p>}
              {!loading && !error && items.length === 0 && <p className="d2-empty">{L("최근 뉴스가 없습니다.", "No recent stories.")}</p>}
              <ol className="cf-news-list">
                {items.map((n, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => setAt(i)}>
                      <span className="nw-meta">
                        <b>{n.source}</b>
                        {newsDate(n, lang)}
                      </span>
                      <span className="cf-news-title">{n.title}</span>
                      {n.snippet && <span className="nw-column-deck">{n.snippet}</span>}
                    </button>
                    {n.image_url && <img src={n.image_url} alt="" loading="lazy" />}
                  </li>
                ))}
              </ol>
              <Link to={`/news?c=${encodeURIComponent(item.code)}`} className="d2-more">
                {L("뉴스면에서 더 보기", "More on the news page")} →
              </Link>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/** 독자 응원란 — the cheer board, set as a letters column. */
function Cheers({ a, b }: { a: GlobalTop20Item; b: GlobalTop20Item }) {
  const L = useL();
  const [comments, setComments] = useState<FightComment[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(10);
  const [thanks, setThanks] = useState<{ side: Side; n: number } | null>(null);
  useEffect(() => {
    api
      .fightComments(a.code, b.code)
      .then((r) => {
        setComments(r.items);
        setCounts(r.counts);
      })
      .catch(() => {});
  }, [a.code, b.code]);
  const visible = comments.slice(0, shown);
  const translated = useTranslatedTexts(visible.map((c) => c.text));
  const ca = counts[a.code] ?? 0;
  const cb = counts[b.code] ?? 0;
  const share = ca + cb > 0 ? (ca / (ca + cb)) * 100 : 50;

  const submit = (item: GlobalTop20Item, side: Side) => {
    const t = text.trim();
    if (!t || posting) return;
    setPosting(true);
    setError("");
    api
      .postFightComment(item.code, generateNickname(), t)
      .then((c) => {
        setComments((p) => [c, ...p]);
        setCounts((p) => ({ ...p, [item.code]: (p[item.code] ?? 0) + 1 }));
        setText("");
        const n = Date.now();
        setThanks({ side, n });
        window.setTimeout(() => setThanks((cur) => (cur?.n === n ? null : cur)), 2600);
      })
      .catch((e: Error) => setError(e.message || L("댓글을 등록하지 못했습니다.", "Could not post.")))
      .finally(() => setPosting(false));
  };

  return (
    <section className="d2-sec cf-cheers" aria-labelledby="cf-cheers-h">
      <SectionHead id="cf-cheers-h" no="02" kicker={L("독자 응원란", "Readers' corner")} title={L("어느 쪽을 응원하십니까", "Whose side are you on?")} note={L(`응원 ${ca + cb}건 · 한 마디를 쓰고 응원할 기업의 버튼을 누르세요.`, `${ca + cb} cheers · write a line, then press your side.`)} />
      <div className="cf-cheer-gauge" role="img" aria-label={`${a.name} ${ca} · ${b.name} ${cb}`}>
        <span className="is-p1" style={{ width: `${share}%` }}>
          {a.name} {ca}
        </span>
        <span className="is-p2" style={{ width: `${100 - share}%` }}>
          {cb} {b.name}
        </span>
      </div>
      <div className="cf-cheer-form">
        <input type="text" value={text} maxLength={200} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit(a, "p1")} placeholder={L("응원 한마디를 쓰고 기업 버튼을 누르세요", "Write a line, then press a side")} aria-label={L("응원 댓글", "Cheer")} />
        <button type="button" className="is-p1" disabled={posting || !text.trim()} onClick={() => submit(a, "p1")}>
          {a.name} {L("응원", "")}
        </button>
        <button type="button" className="is-p2" disabled={posting || !text.trim()} onClick={() => submit(b, "p2")}>
          {b.name} {L("응원", "")}
        </button>
      </div>
      {error && <p className="sk-error">{error}</p>}
      {thanks && (
        <p key={thanks.n} className={`cf-thanks is-${thanks.side}`} role="status">
          {L("응원이 실렸습니다. 고맙습니다!", "Your cheer is in. Thank you!")}
        </p>
      )}
      <ul className="cf-letters">
        {visible.map((c, i) => {
          const side: Side = c.company_code === a.code ? "p1" : "p2";
          return (
            <li key={c.id} className={`is-${side}`}>
              <span className="cf-letter-who">
                <b>{side === "p1" ? a.name : b.name}</b> {L("응원", "fan")} · {c.username}
              </span>
              <p>{translated[i] ?? c.text}</p>
            </li>
          );
        })}
      </ul>
      {comments.length === 0 && <p className="d2-empty">{L("첫 응원을 남겨 보세요.", "Be the first to cheer.")}</p>}
      {shown < comments.length && (
        <button type="button" className="fc-more" onClick={() => setShown((n) => n + 10)}>
          {L(`응원 ${Math.min(10, comments.length - shown)}건 더 보기`, "More")} ↓
        </button>
      )}
    </section>
  );
}

function readUrl() {
  const p = new URLSearchParams(window.location.search);
  return { a: p.get("a"), b: p.get("b") };
}

export default function CapFightPage() {
  const { lang } = useLanguage();
  const L = useL();
  useBroadsheet();
  useDocumentTitle("시총대결 | K-Stock Hub");
  const init = useMemo(readUrl, []);
  const [roster, setRoster] = useState<GlobalTop20Item[]>([]);
  const [rosterError, setRosterError] = useState("");
  const [p1, setP1] = useState<GlobalTop20Item | null>(null);
  const [p2, setP2] = useState<GlobalTop20Item | null>(null);
  const [phase, setPhase] = useState<"select" | "fight">("select");
  const [count, setCount] = useState<number | null>(null);
  const [done1, setDone1] = useState(false);
  const [done2, setDone2] = useState(false);
  const [sa, setSa] = useState<GlobalTop20Item | null>(null);
  const [sb, setSb] = useState<GlobalTop20Item | null>(null);
  const [statusError, setStatusError] = useState("");
  const [redraw, setRedraw] = useState(false);
  const [sheet, setSheet] = useState<{ kind: "company" | "news"; item: GlobalTop20Item; side: Side } | null>(null);
  const [finderOpen, setFinderOpen] = useState(false);
  useFinderHotkey(setFinderOpen);
  const topRef = useRef<HTMLDivElement>(null);
  const intro1 = useIntro(p1, lang);
  const intro2 = useIntro(p2, lang);

  useEffect(() => {
    api
      .globalTop20()
      .then((r) => {
        setRoster(r.items);
        const a = r.items.find((i) => i.code === init.a);
        const b = r.items.find((i) => i.code === init.b);
        if (a && b && a.code !== b.code) {
          setP1(a);
          setP2(b);
          setPhase("fight");
        }
      })
      .catch((e: Error) => setRosterError(e.message || L("글로벌 TOP20 데이터를 불러오지 못했습니다.", "Could not load the roster.")));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setDone1(false), [p1?.code]);
  useEffect(() => setDone2(false), [p2?.code]);

  // The matchup is shareable once it is a fight.
  useEffect(() => {
    const next = phase === "fight" && p1 && p2 ? `${window.location.pathname}?a=${encodeURIComponent(p1.code)}&b=${encodeURIComponent(p2.code)}` : window.location.pathname;
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, "", next);
  }, [phase, p1, p2]);

  // On a phone the corners are above the roster; bring them back into view.
  useEffect(() => {
    if (p1 && p2 && phase === "select" && window.matchMedia("(max-width: 760px)").matches) topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [p1, p2, phase]);

  useEffect(() => {
    if (phase !== "select" || !p1 || !p2 || !done1 || !done2) return;
    let n = 3;
    setCount(n);
    const id = window.setInterval(() => {
      n -= 1;
      if (n <= 0) {
        window.clearInterval(id);
        setCount(null);
        setPhase("fight");
        window.scrollTo({ top: 0 });
        return;
      }
      setCount(n);
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase, p1, p2, done1, done2]);

  useEffect(() => {
    if (phase !== "fight" || !p1 || !p2) return;
    let cancelled = false;
    const poll = () =>
      api
        .fightStatus(p1.code, p2.code)
        .then((r) => {
          if (cancelled) return;
          setSa(r.a);
          setSb(r.b);
          setStatusError("");
        })
        .catch((e: Error) => !cancelled && setStatusError(e.message || L("시가총액 데이터를 불러오지 못했습니다.", "Could not load the values.")));
    poll();
    const stop = startVisibilityAwareInterval(poll, 3000);
    const id = window.setInterval(() => {
      setRedraw(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setRedraw(false)));
    }, 9000);
    return () => {
      cancelled = true;
      stop();
      window.clearInterval(id);
    };
  }, [phase, p1, p2]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (item: GlobalTop20Item) => {
    if (p1?.code === item.code) return setP1(null);
    if (p2?.code === item.code) return setP2(null);
    if (!p1) return setP1(item);
    if (!p2) setP2(item);
  };
  const reset = () => {
    setP1(null);
    setP2(null);
    setSa(null);
    setSb(null);
    setCount(null);
    setPhase("select");
    window.scrollTo({ top: 0 });
  };
  const swap = () => {
    const a = p1;
    setP1(p2);
    setP2(a);
    const x = sa;
    setSa(sb);
    setSb(x);
  };
  const quick = (a: GlobalTop20Item, b: GlobalTop20Item) => {
    setP1(a);
    setP2(b);
    setSa(null);
    setSb(null);
    setPhase("fight");
    window.scrollTo({ top: 0 });
  };

  const suggestions = useMemo(() => {
    if (roster.length < 4) return [];
    const byMove = [...roster].filter((r) => r.change_pct != null).sort((x, y) => (y.change_pct ?? 0) - (x.change_pct ?? 0));
    let near: [GlobalTop20Item, GlobalTop20Item] = [roster[0], roster[1]];
    let gap = Infinity;
    for (let i = 1; i < roster.length - 1; i += 1) {
      const d = roster[i].marcap_usd / roster[i + 1].marcap_usd;
      if (d < gap) {
        gap = d;
        near = [roster[i], roster[i + 1]];
      }
    }
    return [
      { ko: "1위 대 2위", en: "No. 1 vs No. 2", a: roster[0], b: roster[1] },
      { ko: "오늘 최강 대 최약", en: "Best vs worst today", a: byMove[0], b: byMove[byMove.length - 1] },
      { ko: "가장 박빙", en: "Closest in size", a: near[0], b: near[1] },
    ].filter((s) => s.a && s.b && s.a.code !== s.b.code);
  }, [roster]);

  const A = sa ?? p1;
  const B = sb ?? p2;
  const nameA = useTranslatedText(A?.name ?? "");
  const nameB = useTranslatedText(B?.name ?? "");
  const total = A && B ? A.marcap_usd + B.marcap_usd : 0;
  const shareA = total > 0 && A ? (A.marcap_usd / total) * 100 : 50;
  const aLeads = shareA >= 50;
  const lead = aLeads ? A : B;
  const trail = aLeads ? B : A;
  const leadName = aLeads ? nameA : nameB;
  const trailName = aLeads ? nameB : nameA;
  const gapUsd = A && B ? Math.abs(A.marcap_usd - B.marcap_usd) : 0;
  const catchUp = lead && trail && trail.marcap_usd > 0 ? (lead.marcap_usd / trail.marcap_usd - 1) * 100 : 0;

  return (
    <div className="d2 cf" lang={lang}>
      <a className="d2-skip" href="#cf-main">
        {L("본문 바로가기", "Skip to content")}
      </a>
      <Masthead
        rail={false}
        onPrint={() => window.print()}
        section={{ ko: "시총대결", en: "Cap Fight", taglineKo: "세계 20대 기업 가운데 둘을 골라, 몸값을 맞대 봅니다", taglineEn: "Pick two of the world's twenty largest companies and weigh them" }}
      />

      <main id="cf-main" className="d2-main">
        <div ref={topRef} />
        {phase === "select" ? (
          <>
            <section className="d2-sec cf-select" aria-label={L("선수 선택", "Pick two")}>
              <p className="d2-lead-kicker">
                <span className="d2-lead-status">{L("대진 편성", "The draw")}</span>
                <span>{!p1 ? L("1P를 고르세요", "Pick 1P") : !p2 ? L("2P를 고르세요", "Pick 2P") : count !== null ? L("곧 시작합니다", "Starting") : L("소개를 읽는 중", "Reading the profiles")}</span>
              </p>
              <div className="cf-ring">
                <Corner item={p1} side="p1" intro={intro1} onIntroDone={() => setDone1(true)} />
                <div className="cf-vs" aria-hidden="true">
                  {count !== null ? <b key={count} className="cf-count">{count}</b> : <b>VS</b>}
                </div>
                <Corner item={p2} side="p2" intro={intro2} onIntroDone={() => setDone2(true)} />
              </div>
              {count !== null && (
                <p className="cf-skip">
                  <button type="button" className="d2-more" onClick={() => setPhase("fight")}>
                    {L("바로 결과 보기", "Skip to the result")} →
                  </button>
                </p>
              )}
            </section>

            <section className="d2-sec" aria-labelledby="cf-roster-h">
              <SectionHead id="cf-roster-h" no="01" kicker={L("출전 명단", "The field")} title={L("세계 시가총액 20대 기업", "The world's twenty largest")} note={L("두 곳을 고르면 소개가 끝난 뒤 대결이 시작됩니다. 고른 곳을 다시 누르면 취소됩니다.", "Pick two; the fight starts once both profiles are read. Click a pick again to clear it.")} />
              {suggestions.length > 0 && (
                <div className="cf-suggest">
                  <span>{L("추천 대진", "Suggested")}</span>
                  {suggestions.map((s) => (
                    <button key={s.ko} type="button" onClick={() => quick(s.a, s.b)}>
                      <small>{L(s.ko, s.en)}</small>
                      {s.a.name} <i>vs</i> {s.b.name}
                    </button>
                  ))}
                </div>
              )}
              {rosterError && <p className="d2-empty">{rosterError}</p>}
              <ol className="cf-roster">
                {roster.length === 0 && !rosterError && Array.from({ length: 10 }, (_, i) => <Skel key={i} h={120} />)}
                {roster.map((r) => {
                  const slot = p1?.code === r.code ? "p1" : p2?.code === r.code ? "p2" : null;
                  return (
                    <li key={r.code}>
                      <button type="button" className={slot ? `is-${slot}` : ""} onClick={() => pick(r)} aria-pressed={!!slot}>
                        {slot && <span className="cf-slot">{slot === "p1" ? "1P" : "2P"}</span>}
                        <span className="cf-roster-rank">{r.rank}</span>
                        <CompanyLogo item={r} className="cf-logo" />
                        <b>{r.name}</b>
                        <small>
                          {trillion(r.marcap_usd, lang)} · <em className={`is-${toneOf(r.change_pct)}`}>{pct(r.change_pct)}</em>
                        </small>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          </>
        ) : (
          A &&
          B && (
            <>
              <section className="d2-sec cf-result" aria-label={L("대결 결과", "Result")}>
                <p className="d2-lead-kicker">
                  <span className="d2-lead-status is-live">{L("3초마다 갱신", "Live, every 3s")}</span>
                  <span>{L("시가총액 대결", "Market-value fight")}</span>
                  <span>
                    {nameA} vs {nameB}
                  </span>
                </p>
                {sa && sb && lead && trail ? (
                  <h2 className="cf-head">{L(`${leadName} 우세, ${trailName}보다 ${trillion(gapUsd, "ko")} 앞서`, `${leadName} leads ${trailName} by ${trillion(gapUsd, "en")}`)}</h2>
                ) : statusError ? (
                  <p className="d2-empty">{statusError}</p>
                ) : (
                  <Skel h={48} w="70%" />
                )}

                <div className="cf-rope" role="img" aria-label={`${nameA} ${shareA.toFixed(1)}% · ${nameB} ${(100 - shareA).toFixed(1)}%`}>
                  <span className={`is-p1${redraw ? " is-redraw" : ""}`} style={{ width: `${redraw ? 0 : shareA}%` }} />
                  <span className={`is-p2${redraw ? " is-redraw" : ""}`} style={{ width: `${redraw ? 0 : 100 - shareA}%` }} />
                  <i style={{ left: `${shareA}%` }} aria-hidden="true" />
                </div>
                <div className="cf-rope-read">
                  <b className="is-p1">{shareA.toFixed(1)}%</b>
                  <span>{L("두 회사 시가총액 합계 대비 비중", "Share of the two companies' combined value")}</span>
                  <b className="is-p2">{(100 - shareA).toFixed(1)}%</b>
                </div>

                <div className="cf-sides">
                  {([
                    [A, "p1", nameA],
                    [B, "p2", nameB],
                  ] as const).map(([it, side, nm]) => {
                    const portrait = ceoStylizedImageFor(it.code);
                    const flag = hiResFlagUrl(it.country) ?? it.flag_url;
                    const leads = it === lead;
                    return (
                      <article key={side} className={`cf-side is-${side}`}>
                        <button type="button" className="cf-side-pic" onClick={() => setSheet({ kind: "company", item: it, side })} aria-label={L(`${nm} 회사 정보`, `${nm} profile`)}>
                          {portrait ? <img src={portrait} alt={CEO_NAMES[it.code] ?? it.name} /> : <CompanyLogo item={it} className="cf-logo cf-logo--xl" />}
                          {portrait && <CompanyLogo item={it} className="cf-logo cf-side-badge" />}
                        </button>
                        <div className="cf-side-copy">
                          <p className="cf-side-tag">
                            {side === "p1" ? "1P" : "2P"}
                            {leads && <em>{L("선두", "Leads")}</em>}
                          </p>
                          <h3>{nm}</h3>
                          <p className="cf-side-meta">
                            {flag && <img src={flag} alt="" className="nw-flag" />}
                            {it.country} · {L(`세계 ${it.rank}위`, `World No. ${it.rank}`)}
                            {CEO_NAMES[it.code] && ` · CEO ${CEO_NAMES[it.code]}`}
                          </p>
                          <dl>
                            <div>
                              <dt>{L("시가총액", "Market value")}</dt>
                              <dd>{trillion(it.marcap_usd, lang)}</dd>
                            </div>
                            <div>
                              <dt>{L("오늘", "Today")}</dt>
                              <dd className={`is-${toneOf(it.change_pct)}`}>{pct(it.change_pct)}</dd>
                            </div>
                          </dl>
                          <div className="cf-side-actions">
                            <button type="button" onClick={() => setSheet({ kind: "company", item: it, side })}>
                              {L("회사 소개", "Profile")}
                            </button>
                            <button type="button" onClick={() => setSheet({ kind: "news", item: it, side })}>
                              {L("주요 뉴스", "News")}
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>

                {sa && sb && lead && trail && (
                  <dl className="cf-facts">
                    <div>
                      <dt>{L("시총 격차", "The gap")}</dt>
                      <dd>{trillion(gapUsd, lang)}</dd>
                      <small>{L(`비중 차이 ${Math.abs(shareA * 2 - 100).toFixed(1)}%p`, `${Math.abs(shareA * 2 - 100).toFixed(1)} pts of share`)}</small>
                    </div>
                    <div>
                      <dt>{L("역전 조건", "To draw level")}</dt>
                      <dd>+{catchUp.toFixed(1)}%</dd>
                      <small>{L(`다른 조건이 같을 때 ${trailName} 주가가 올라야 할 폭`, `How far ${trailName} must rise, all else equal`)}</small>
                    </div>
                    <div>
                      <dt>{L("오늘 등락 차이", "Today's spread")}</dt>
                      <dd>{(((A.change_pct ?? 0) - (B.change_pct ?? 0)) >= 0 ? "+" : "") + ((A.change_pct ?? 0) - (B.change_pct ?? 0)).toFixed(2)}%p</dd>
                      <small>{L("1P 등락률 − 2P 등락률", "1P move minus 2P move")}</small>
                    </div>
                  </dl>
                )}

                <div className="cf-actions">
                  <button type="button" onClick={swap}>
                    ⇄ {L("좌우 바꾸기", "Swap sides")}
                  </button>
                  <button type="button" onClick={reset}>
                    {L("다시 선택", "Pick again")}
                  </button>
                  <Link to="/battle" className="d2-more">
                    {L("삼성전자 vs SK하이닉스", "Samsung vs SK hynix")} →
                  </Link>
                </div>
              </section>

              {sa && sb && <Cheers key={`${A.code}-${B.code}`} a={A} b={B} />}
            </>
          )
        )}
      </main>

      <Colophon />
      <Finder open={finderOpen} onClose={() => setFinderOpen(false)} />
      {sheet?.kind === "company" && <CompanySheet item={sheet.item} side={sheet.side} onClose={() => setSheet(null)} />}
      {sheet?.kind === "news" && <NewsSheet item={sheet.item} side={sheet.side} onClose={() => setSheet(null)} />}
    </div>
  );
}
