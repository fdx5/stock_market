import { useEffect, useState } from "react";
import { CheerComment, CheerSide, api } from "../api/client";
import { generateNickname } from "../data/cheerNames";

export default function CheerSection() {
  const [comments, setComments] = useState<CheerComment[]>([]);
  const [counts, setCounts] = useState({ samsung: 0, skhynix: 0 });
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      })
      .catch((err: Error) => {
        setError(err.message || "댓글을 등록하지 못했습니다.");
      })
      .finally(() => setPosting(false));
  };

  return (
    <div className="cheer-section">
      <div className="cheer-header">🔥 응원 댓글</div>

      <div className="cheer-count-row">
        <span className="cheer-count samsung">삼성전자 {counts.samsung}</span>
        <span className="cheer-count skhynix">{counts.skhynix} SK하이닉스</span>
      </div>

      <div className="cheer-gauge-track">
        <div className="cheer-gauge-fill samsung" style={{ width: `${samsungPct}%` }} />
        <div className="cheer-gauge-fill skhynix" style={{ width: `${100 - samsungPct}%` }} />
      </div>

      <input
        type="text"
        className="cheer-input"
        placeholder="응원 한마디 쓰고 회사 버튼을 눌러보세요"
        value={text}
        maxLength={200}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit("samsung");
        }}
      />

      {error && <div className="cheer-error">{error}</div>}

      <div className="cheer-button-row">
        <button type="button" className="cheer-btn samsung" disabled={posting} onClick={() => submit("samsung")}>
          삼성전자 응원 💙
        </button>
        <button type="button" className="cheer-btn skhynix" disabled={posting} onClick={() => submit("skhynix")}>
          SK하이닉스 응원 🧡
        </button>
      </div>

      <div className="cheer-list">
        {comments.map((c) => (
          <div key={c.id} className={`cheer-row ${c.side}`}>
            <div className="cheer-bubble-wrap">
              <span className={`cheer-badge ${c.side}`}>{c.side === "samsung" ? "삼성전자" : "SK하이닉스"}</span>
              <span className="cheer-username">{c.username}</span>
            </div>
            <div className={`cheer-bubble ${c.side}`}>{c.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
