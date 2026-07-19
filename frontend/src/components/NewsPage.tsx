import { useEffect, useRef, useState } from "react";
import { CompanyNewsItem, GlobalTop20Item, api } from "../api/client";
import { COMPANY_SHORT_NAMES } from "../data/companyShortNames";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { useTranslatedText } from "../i18n/useTranslatedTexts";
import { Link } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import { useNavRowAutoScroll } from "../useNavRowAutoScroll";
import BattleIcon from "./BattleIcon";
import CompanyLogo from "./CompanyLogo";
import DashboardIcon from "./DashboardIcon";
import Footer from "./Footer";
import LanguageToggle from "./LanguageToggle";
import Logo from "./Logo";
import MarketIcon from "./MarketIcon";
import ThemeToggle from "./ThemeToggle";
import VisitorBadge from "./VisitorBadge";

// A full page gets more room than the fight page's popup (limit=6) — 12 items fills
// out a proper grid (an even 4x3/3x4 on most viewports) without the last row
// trailing off half-empty.
const NEWS_LIMIT = 12;

function NewsTab({
  item,
  active,
  onSelect,
}: {
  item: GlobalTop20Item;
  active: boolean;
  onSelect: () => void;
}) {
  const translatedName = useTranslatedText(item.name);
  const label = COMPANY_SHORT_NAMES[item.code] ?? translatedName;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`news-tab${active ? " news-tab--active" : ""}`}
      onClick={onSelect}
      title={translatedName}
    >
      <span className="news-tab-logo">
        <CompanyLogo item={item} className="news-tab-logo-img" />
      </span>
      <span className="news-tab-name">{label}</span>
    </button>
  );
}

function NewsGridSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="news-card news-skeleton" aria-hidden="true">
          <div className="news-card-img news-skeleton-block" />
          <div className="news-card-body">
            <div className="news-skeleton-line news-skeleton-line--title" />
            <div className="news-skeleton-line news-skeleton-line--title-short" />
            <div className="news-skeleton-line news-skeleton-line--meta" />
          </div>
        </div>
      ))}
    </>
  );
}

function ArticleBodySkeleton() {
  return (
    <div className="news-article-body news-skeleton" aria-hidden="true">
      <div className="news-skeleton-line news-skeleton-line--para" />
      <div className="news-skeleton-line news-skeleton-line--para" />
      <div className="news-skeleton-line news-skeleton-line--para-short" />
      <div className="news-skeleton-line news-skeleton-line--para" />
      <div className="news-skeleton-line news-skeleton-line--para-short" />
    </div>
  );
}

export default function NewsPage() {
  const t = useT();
  const { lang } = useLanguage();
  useDocumentTitle("글로벌 뉴스 | K-Stock Hub");

  const headerNavRowRef = useRef<HTMLDivElement>(null);
  useNavRowAutoScroll(headerNavRowRef);

  const [roster, setRoster] = useState<GlobalTop20Item[]>([]);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [active, setActive] = useState<GlobalTop20Item | null>(null);

  const [items, setItems] = useState<CompanyNewsItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<CompanyNewsItem | null>(null);
  const [paragraphs, setParagraphs] = useState<string[] | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);

  const tabRowRef = useRef<HTMLDivElement>(null);
  const [tabsScrollable, setTabsScrollable] = useState(false);

  useEffect(() => {
    api
      .globalTop20()
      .then((res) => {
        setRoster(res.items);
        setActive((prev) => prev ?? res.items[0] ?? null);
      })
      .catch((err: Error) => setRosterError(err.message || "글로벌 TOP20 데이터를 불러오지 못했습니다."));
  }, []);

  // Drives the right-edge fade's visibility so it only implies "more to scroll to"
  // while that's actually true — hidden once the row is scrolled all the way to Visa,
  // and never shown at all if every tab happens to already fit (narrower roster, wide
  // viewport).
  useEffect(() => {
    const el = tabRowRef.current;
    if (!el) return;
    const update = () => setTabsScrollable(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [roster.length]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setSelected(null);
    setParagraphs(null);
    setListLoading(true);
    setListError(null);
    api
      .fightNews(active.code, active.name, lang, NEWS_LIMIT)
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((err: Error) => {
        if (!cancelled) setListError(err.message || "뉴스를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active?.code, lang]);

  const openArticle = (item: CompanyNewsItem) => {
    if (!active) return;
    setSelected(item);
    setParagraphs(null);
    setArticleLoading(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
    api
      .fightArticle(item.link, active.code, lang)
      .then((res) => setParagraphs(res.paragraphs))
      .catch(() => setParagraphs(null))
      .finally(() => setArticleLoading(false));
  };

  const backToList = () => {
    setSelected(null);
    setParagraphs(null);
  };

  return (
    <div className="app news-page">
      <header className="app-header">
        <div>
          <div className="app-title-row">
            <Link to="/" className="app-brand" aria-label="K-Stock Hub">
              <Logo className="app-logo-wide" />
            </Link>
            <div className="app-header-meta">
              <LanguageToggle />
              <ThemeToggle />
            </div>
          </div>
          <div className="app-nav-row" ref={headerNavRowRef}>
            <Link to="/" className="kospi-map-nav-link kospi-map-nav-link--home">
              <DashboardIcon /> {t("홈")}
            </Link>
            <Link to="/map" className="kospi-map-nav-link">
              <MarketIcon /> KOSPI
            </Link>
            <Link to="/kosdaq-map" className="kospi-map-nav-link kospi-map-nav-link--kosdaq">
              <MarketIcon /> KOSDAQ
            </Link>
            <Link to="/sp500-map" className="kospi-map-nav-link kospi-map-nav-link--sp500">
              <MarketIcon /> S&P500
            </Link>
            <Link to="/nasdaq100-map" className="kospi-map-nav-link kospi-map-nav-link--nasdaq">
              <MarketIcon /> NASDAQ100
            </Link>
            <Link to="/fight" className="kospi-map-nav-link kospi-map-nav-link--battle">
              <BattleIcon /> {t("시총대결")}
            </Link>
            <VisitorBadge />
          </div>
          <h1 className="app-title">{t("글로벌 뉴스")}</h1>
        </div>
      </header>

      {rosterError && <div className="error-state">{t(rosterError)}</div>}
      {!roster.length && !rosterError && <div className="loading-state">{t("데이터를 불러오는 중...")}</div>}

      {roster.length > 0 && (
        <div className={`news-tab-row-wrap${tabsScrollable ? " news-tab-row-wrap--scrollable" : ""}`}>
          <div className="news-tab-row" role="tablist" ref={tabRowRef}>
            {roster.map((item) => (
              <NewsTab
                key={item.code}
                item={item}
                active={active?.code === item.code}
                onSelect={() => setActive(item)}
              />
            ))}
          </div>
        </div>
      )}

      {selected ? (
        <div className="news-article">
          <button type="button" className="news-article-back" onClick={backToList}>
            ← {t("목록으로")}
          </button>

          {selected.image_url ? (
            <img className="news-article-img" src={selected.image_url} alt="" />
          ) : (
            active && (
              <div className="news-article-img news-article-img--placeholder">
                <CompanyLogo item={active} className="news-article-img-logo" />
              </div>
            )
          )}
          <div className="news-article-title">{selected.title}</div>
          <div className="news-article-meta">
            <span className="news-article-source">{selected.source}</span>
            {selected.published && <span className="news-article-date">{selected.published}</span>}
          </div>

          {articleLoading && <ArticleBodySkeleton />}

          {!articleLoading && paragraphs && (
            <div className="news-article-body">
              {paragraphs.map((p, idx) => (
                <p key={idx}>{p}</p>
              ))}
            </div>
          )}

          {!articleLoading && !paragraphs && (
            <>
              {selected.snippet && <p className="news-article-fallback-snippet">{selected.snippet}</p>}
              <div className="news-article-fallback-note">
                {t("본문을 불러오지 못했습니다. 원문에서 확인해 주세요.")}
              </div>
            </>
          )}

          <a className="news-article-link" href={selected.link} target="_blank" rel="noopener noreferrer">
            {t("원문에서 보기")} ↗
          </a>
        </div>
      ) : (
        <div className="news-grid">
          {listLoading && <NewsGridSkeleton />}
          {listError && <div className="error-state">{t(listError)}</div>}
          {!listLoading && !listError && items.length === 0 && (
            <div className="loading-state">{t("최근 뉴스가 없습니다.")}</div>
          )}
          {!listLoading &&
            items.map((item, idx) => (
              <button key={idx} type="button" className="news-card" onClick={() => openArticle(item)}>
                {item.image_url ? (
                  <img className="news-card-img" src={item.image_url} alt="" />
                ) : (
                  <div className="news-card-img news-card-img--placeholder">
                    {active && <CompanyLogo item={active} className="news-card-img-logo" />}
                  </div>
                )}
                <div className="news-card-body">
                  <div className="news-card-title">{item.title}</div>
                  {item.snippet && <div className="news-card-snippet">{item.snippet}</div>}
                  <div className="news-card-meta">
                    <span className="news-card-source">{item.source}</span>
                    {item.published && <span className="news-card-date">{item.published}</span>}
                  </div>
                </div>
              </button>
            ))}
        </div>
      )}

      <Footer />
    </div>
  );
}
