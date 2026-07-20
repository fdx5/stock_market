import { useEffect, useRef, useState } from "react";
import { FightComment, api } from "../api/client";
import { generateNickname } from "../data/cheerNames";
import { useT } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";

const PAGE_SIZE = 10;
const CELEBRATE_MS = 2800;

export interface FightSide {
  code: string;
  name: string;
  player: "p1" | "p2";
}

// Generalized version of CheerSection.tsx for two dynamically-picked companies instead
// of the fixed samsung/skhynix pair — mount this with `key={`${sideA.code}-${sideB.code}`}`
// from the parent so switching matchups remounts it and refetches that pair's comments,
// the same "fetch once on mount" shape CheerSection already uses.
export default function FightCheerSection({ sideA, sideB }: { sideA: FightSide; sideB: FightSide }) {
  const t = useT();
  const [comments, setComments] = useState<FightComment[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [celebrate, setCelebrate] = useState<{ player: "p1" | "p2"; nonce: number } | null>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const pendingRevealIndex = useRef<number | null>(null);

  useEffect(() => {
    api
      .fightComments(sideA.code, sideB.code)
      .then((res) => {
        setComments(res.items);
        setCounts(res.counts);
      })
      .catch(() => {
        // Cheer comments are a nice-to-have — leave the section empty on failure
        // rather than blocking the rest of the fight page.
      });
  }, [sideA.code, sideB.code]);

  const countA = counts[sideA.code] ?? 0;
  const countB = counts[sideB.code] ?? 0;
  const total = countA + countB;
  const aPct = total > 0 ? (countA / total) * 100 : 50;

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

  const sideForCode = (code: string): FightSide => (code === sideA.code ? sideA : sideB);

  const submit = (side: FightSide) => {
    const trimmed = text.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    setError(null);
    api
      .postFightComment(side.code, generateNickname(), trimmed)
      .then((comment) => {
        setComments((prev) => [comment, ...prev]);
        setCounts((prev) => ({ ...prev, [side.code]: (prev[side.code] ?? 0) + 1 }));
        setText("");

        const nonce = Date.now();
        setCelebrate({ player: side.player, nonce });
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
          <div key={celebrate.nonce} className={`cheer-celebrate fight-${celebrate.player}`}>
            <div className="cheer-celebrate-text">{t("땡큐! 👍")}</div>
          </div>
        </div>
      )}

      <div className="cheer-header">
        🔥 {t("응원 댓글")} <span className="cheer-header-count">({total})</span>
      </div>

      <div className="cheer-count-row">
        <span className="cheer-count fight-p1">{sideA.name} {countA}</span>
        <span className="cheer-count fight-p2">{countB} {sideB.name}</span>
      </div>

      <div className="cheer-gauge-track">
        <div className="cheer-gauge-fill fight-p1" style={{ width: `${aPct}%` }} />
        <div className="cheer-gauge-fill fight-p2" style={{ width: `${100 - aPct}%` }} />
      </div>

      <input
        type="text"
        className="cheer-input"
        placeholder={t("응원 한마디 쓰고 회사 버튼을 눌러보세요")}
        value={text}
        maxLength={200}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit(sideA);
        }}
      />

      {error && <div className="cheer-error">{t(error)}</div>}

      <div className="cheer-button-row">
        <button type="button" className="cheer-btn fight-p1" disabled={posting} onClick={() => submit(sideA)}>
          {sideA.name} {t("응원")} 💙
        </button>
        <button type="button" className="cheer-btn fight-p2" disabled={posting} onClick={() => submit(sideB)}>
          {sideB.name} {t("응원")} 🧡
        </button>
      </div>

      <div className="cheer-list">
        {visibleComments.map((c, idx) => {
          const side = sideForCode(c.company_code);
          return (
            <div
              key={c.id}
              className={`cheer-row fight-${side.player}`}
              ref={(el) => {
                if (el) rowRefs.current.set(c.id, el);
                else rowRefs.current.delete(c.id);
              }}
            >
              <div className="cheer-bubble-wrap">
                <span className={`cheer-badge fight-${side.player}`}>{side.name}</span>
                <span className="cheer-username">{c.username}</span>
              </div>
              <div className={`cheer-bubble fight-${side.player}`}>{translatedCommentTexts[idx] ?? c.text}</div>
            </div>
          );
        })}
      </div>

      {visibleCount < comments.length && (
        <button type="button" className="cheer-more-btn" onClick={showMore}>
          {t("더보기")}
        </button>
      )}
    </div>
  );
}
