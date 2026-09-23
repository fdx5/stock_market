import { useEffect, useState } from "react";
import { CompanyNewsItem, api } from "../../api/client";
import { formatNewsDate } from "../../i18n/format";
import { useLanguage } from "../../i18n/LanguageContext";
import { Skel } from "../parts";
import { useL } from "../lib";

/* The company-news plumbing the 국제면 and the 시총대결 share: one hook for a
 * company's headlines, and one reader that fetches the article body (translated
 * server-side when the source is foreign) and shows it in place. */

export function useCompanyNews(company: { code: string; name: string } | null, limit: number) {
  const { lang } = useLanguage();
  const [items, setItems] = useState<CompanyNewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!company) return;
    let cancelled = false;
    setItems([]);
    setLoading(true);
    setError("");
    api
      .fightNews(company.code, company.name, lang, limit)
      .then((r) => !cancelled && setItems(r.items))
      .catch((e: Error) => !cancelled && setError(e.message || "뉴스를 불러오지 못했습니다."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [company?.code, company?.name, lang, limit]); // eslint-disable-line react-hooks/exhaustive-deps
  return { items, loading, error };
}

export function newsDate(item: CompanyNewsItem, lang: "ko" | "en"): string {
  return item.published ? formatNewsDate(item.published, lang) : "";
}

/** One article, read in place. `position` and the step handlers let the caller
 * walk its own list without closing the reader. */
export function Article({
  item,
  code,
  onBack,
  onStep,
  position,
}: {
  item: CompanyNewsItem;
  code: string;
  onBack: () => void;
  onStep?: (delta: -1 | 1) => void;
  position?: { at: number; of: number };
}) {
  const L = useL();
  const { lang } = useLanguage();
  const [paras, setParas] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setParas(null);
    setLoading(true);
    api
      .fightArticle(item.link, code, lang)
      .then((r) => !cancelled && setParas(r.paragraphs))
      .catch(() => !cancelled && setParas(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [item.link, code, lang]);

  const share = () => {
    navigator.clipboard
      ?.writeText(item.link)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {});
  };

  return (
    <article className="nw-article">
      <nav className="nw-article-nav">
        <button type="button" onClick={onBack}>
          ← {L("목록으로", "Back to list")}
        </button>
        {onStep && position && (
          <span>
            <button type="button" onClick={() => onStep(-1)} disabled={position.at === 0}>
              ‹ {L("이전 기사", "Previous")}
            </button>
            <small>
              {position.at + 1} / {position.of}
            </small>
            <button type="button" onClick={() => onStep(1)} disabled={position.at === position.of - 1}>
              {L("다음 기사", "Next")} ›
            </button>
          </span>
        )}
      </nav>
      <p className="nw-article-kicker">
        <b>{item.source}</b>
        {item.published && <span>{newsDate(item, lang)}</span>}
      </p>
      <h2 className="nw-article-head">{item.title}</h2>
      {item.image_url && <img className="nw-article-img" src={item.image_url} alt="" loading="lazy" />}
      <div className="nw-article-body">
        {loading ? (
          <div className="nw-article-skel">
            <Skel h={15} />
            <Skel h={15} />
            <Skel h={15} w="70%" />
            <Skel h={15} />
            <Skel h={15} w="55%" />
          </div>
        ) : paras && paras.length > 0 ? (
          paras.map((p, i) => <p key={i}>{p}</p>)
        ) : (
          <>
            {item.snippet && <p>{item.snippet}</p>}
            <p className="nw-article-miss">{L("본문을 불러오지 못했습니다. 원문에서 확인해 주세요.", "The article body could not be loaded; read it at the source.")}</p>
          </>
        )}
      </div>
      <footer className="nw-article-foot">
        <a className="d2-more" href={item.link} target="_blank" rel="noopener noreferrer">
          {L("원문에서 보기", "Read at the source")} ↗
        </a>
        <button type="button" className="d2-more" onClick={share}>
          {copied ? L("링크를 복사했습니다", "Link copied") : L("원문 링크 복사", "Copy link")}
        </button>
      </footer>
    </article>
  );
}
