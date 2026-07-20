import { useEffect, useRef, useState } from "react";
import { CheerComment, CheerSide, api } from "../api/client";
import { generateNickname } from "../data/cheerNames";
import { useT } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";

const PAGE_SIZE = 10;
const CELEBRATE_MS = 2800;

const CELEBRATE_TEXT: Record<CheerSide, string> = {
  samsung: "감사합니다!!",
  skhynix: "HBM 나 너무 좋아",
};

const CELEBRATE_IMG: Record<CheerSide, string> = {
  samsung: "/img/samsung.png",
  skhynix: "/img/skhynix.jpg",
};

export default function CheerSection() {
  const t = useT();
  const [comments, setComments] = useState<CheerComment[]>([]);
  const [counts, setCounts] = useState({ samsung: 0, skhynix: 0 });
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [celebrate, setCelebrate] = useState<{ side: CheerSide; nonce: number } | null>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const pendingRevealIndex = useRef<number | null>(null);

  useEffect(() => {
    api
      .cheerComments()
      .then((res) => {
        setComments(res.items);
        setCounts(res.counts);
      })
      .catch(() => {
        // Cheer comments are a nice-to-have — leave the section empty on failure
        // rather than blocking the rest of the battle page.
      });
  }, []);

  const total = counts.samsung + counts.skhynix;
  const samsungPct = total > 0 ? (counts.samsung / total) * 100 : 50;

  const visibleComments = comments.slice(0, visibleCount);
  const translatedCommentTexts = useTranslatedTexts(visibleComments.map((c) => c.text));

  // "더보기" only grows visibleCount client-side, so the scroll container's
  // scrollTop doesn't move on its own — bring the first newly revealed
  // comment into view so it's obvious something loaded.
  useEffect(() => {
    const revealIndex = pendingRevealIndex.current;
    if (revealIndex === null) return;
    pendingRevealIndex.current = null;
    const target = comments[revealIndex];
    if (!target) return;
    rowRefs.current.get(target.id)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [comments, visibleCount]);

  const showMore = () => {
    pendingRevealIndex.current = visibleCount;
    setVisibleCount((v) => v + PAGE_SIZE);
  };

  const submit = (side: CheerSide) => {
    const trimmed = text.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    setError(null);
    api
      .postCheerComment(side, generateNickname(), trimmed)
      .then((comment) => {
        setComments((prev) => [comment, ...prev]);
        setCounts((prev) => ({ ...prev, [side]: prev[side] + 1 }));
        setText("");

        const nonce = Date.now();
        setCelebrate({ side, nonce });
        window.setTimeout(() => {
          setCelebrate((cur) => (cur?.nonce === nonce ? null : cur));
        }, CELEBRATE_MS);
      })
      .catch((err: Error) => {
        setError(err.message || "댓글을 등록하지 못했습니다.");
      })
      .finally(() => setPosting(false));
  };

  return (
    <div className="cheer-section">
      {celebrate && (
        <div className="cheer-celebrate-overlay">
          <div key={celebrate.nonce} className={`cheer-celebrate ${celebrate.side}`}>
            <div className="cheer-celebrate-text">{t(CELEBRATE_TEXT[celebrate.side])}</div>
            <img className="cheer-celebrate-img" src={CELEBRATE_IMG[celebrate.side]} alt="" />
          </div>
        </div>
      )}

      <div className="cheer-header">
        🔥 {t("응원 댓글")} <span className="cheer-header-count">({total})</span>
      </div>

      <div className="cheer-count-row">
        <span className="cheer-count samsung">{t("삼성전자")} {counts.samsung}</span>
        <span className="cheer-count skhynix">{counts.skhynix} {t("SK하이닉스")}</span>
      </div>

      <div className="cheer-gauge-track">
        <div className="cheer-gauge-fill samsung" style={{ width: `${samsungPct}%` }} />
        <div className="cheer-gauge-fill skhynix" style={{ width: `${100 - samsungPct}%` }} />
      </div>

      <input
        type="text"
        className="cheer-input"
        placeholder={t("응원 한마디 쓰고 회사 버튼을 눌러보세요")}
        value={text}
        maxLength={200}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit("samsung");
        }}
      />

      {error && <div className="cheer-error">{t(error)}</div>}

      <div className="cheer-button-row">
        <button type="button" className="cheer-btn samsung" disabled={posting} onClick={() => submit("samsung")}>
          {t("삼성전자 응원 💙")}
        </button>
        <button type="button" className="cheer-btn skhynix" disabled={posting} onClick={() => submit("skhynix")}>
          {t("SK하이닉스 응원 🧡")}
        </button>
      </div>

      <div className="cheer-list">
        {visibleComments.map((c, idx) => (
          <div
            key={c.id}
            className={`cheer-row ${c.side}`}
            ref={(el) => {
              if (el) rowRefs.current.set(c.id, el);
              else rowRefs.current.delete(c.id);
            }}
          >
            <div className="cheer-bubble-wrap">
              <span className={`cheer-badge ${c.side}`}>{c.side === "samsung" ? t("삼성전자") : t("SK하이닉스")}</span>
              <span className="cheer-username">{c.username}</span>
            </div>
            <div className={`cheer-bubble ${c.side}`}>{translatedCommentTexts[idx] ?? c.text}</div>
          </div>
        ))}
      </div>

      {visibleCount < comments.length && (
        <button type="button" className="cheer-more-btn" onClick={showMore}>
          {t("더보기")}
        </button>
      )}
    </div>
  );
}
