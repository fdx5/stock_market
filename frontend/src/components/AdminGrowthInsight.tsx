import { useState } from "react";
import { GrowthInsight, adminApi } from "../adminApi";

/* One '지금 할 일' card. "완료" stores an append-only mark on the server
   (growth_insight_marks); done cards stay visible, struck through and sorted last,
   until their rule stops firing — then they move to the '해결됨' list. */

const SEV_LABEL = { critical: "긴급", warning: "주의", good: "양호", info: "참고" } as const;

export default function InsightCard({ it, onChanged }: { it: GrowthInsight; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const done = !!it.mark;
  const toggle = async () => {
    setBusy(true);
    try {
      await adminApi.growthInsightMark({ key: it.key, status: done ? "open" : "done", title: it.title });
      onChanged();
    } catch { /* the card simply stays as it was */ } finally { setBusy(false); }
  };
  return (
    <article className={`gc-insight gc-insight--${it.severity}${done ? " is-done" : ""}`}>
      <header>
        <i>{done ? "완료" : SEV_LABEL[it.severity]}</i><span>{it.area}</span>
        {done && <em className="gc-done-at">✓ {it.mark!.at.slice(5, 10).replace("-", "/")}</em>}
        <button type="button" className="gc-mark-btn" disabled={busy} onClick={toggle}>{done ? "되돌리기" : "완료"}</button>
      </header>
      <b>{it.title}</b>
      <p className="gc-evidence">{it.evidence}</p>
      {done && it.mark!.note && <p className="gc-done-note">✓ {it.mark!.note}</p>}
      <p className="gc-todo">→ {it.action}</p>
    </article>
  );
}
