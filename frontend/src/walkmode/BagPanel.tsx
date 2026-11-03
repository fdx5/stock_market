import { useEffect, useMemo, useState } from "react";
import { CAT_LABEL, productById, type Cat, type Product } from "./interior/catalog";
import { wallet, won, type Carried } from "./game/wallet";
import ProductPic from "./ProductPic";

/* The bag: everything bought, kept in this browser (localStorage, wallet.ts) — each with its
 * picture, how many, what it cost and when; drinks and food can be had from it. */
export default function BagPanel({ onClose, onUse, onRead }: { onClose: () => void; onUse?: (p: Product) => boolean; onRead?: (story: string) => void }) {
  const [items, setItems] = useState<readonly Carried[]>(() => [...wallet.items]);
  const [cat, setCat] = useState<Cat | "all">("all");
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => wallet.on(() => setItems([...wallet.items])), []);
  const rows = useMemo(() => items.map(c => ({ c, p: productById(c.id) })).sort((a, b) => (b.c.at ?? 0) - (a.c.at ?? 0)), [items]);
  const cats = useMemo(() => [...new Set(rows.map(r => r.p?.cat).filter(Boolean) as Cat[])], [rows]);
  const shown = rows.filter(r => cat === "all" || r.p?.cat === cat);
  const total = rows.reduce((t, r) => t + (r.c.price ?? r.p?.price ?? 0) * r.c.count, 0), count = rows.reduce((t, r) => t + r.c.count, 0);
  const use = (r: (typeof rows)[number]) => {
    if (!r.p || !onUse) return;
    if (!onUse(r.p)) { setNote("손에 든 것을 먼저 내려놓아 주세요"); return; }
    wallet.use(r.c.id); onClose();
  };
  return (
    <div className="wk-prompt wk-shop wk-bag" role="dialog" aria-label="내 가방" onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      <header><h3>🎒 내 가방</h3><small className="wk-shop-count">{count}개 · 구입가 합계 {won(total)}</small><span className="wk-shop-money">{won(wallet.money)}<small>게임 머니</small></span></header>
      <p className="wk-bag-hint">산 물건은 이 브라우저에 저장돼요. 다음에 와도 그대로 있어요.</p>
      {cats.length > 1 && <nav className="wk-shop-cats">{(["all", ...cats] as (Cat | "all")[]).map(c => <button type="button" key={c} className={c === cat ? "on" : ""} onClick={() => setCat(c)}>{c === "all" ? "전체" : CAT_LABEL[c]}</button>)}</nav>}
      {shown.length ? (
        <div className="wk-shop-grid">
          {shown.map(r => (
            <div key={r.c.id} className="wk-shop-item wk-bag-item">
              {r.p ? <ProductPic p={r.p} size={160} className="wk-shop-pic" /> : <span className="wk-shop-pic wk-pic-wait" />}
              {r.c.count > 1 && <em className="wk-bag-n">×{r.c.count}</em>}
              <small className="wk-shop-brand">{r.p?.brand ?? ""}</small>
              <b>{r.c.name}</b>
              <small>{r.c.price ? won(r.c.price) : r.p ? won(r.p.price) : ""}{r.c.at ? ` · ${new Date(r.c.at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}` : ""}</small>
              {r.p?.how && onUse && <button type="button" className="wk-btn wk-btn-shop" onClick={() => use(r)}>{r.p.kind === "drink" ? "마시기" : "먹기"}</button>}
              {r.p?.story && onRead && <button type="button" className="wk-btn wk-btn-shop" onClick={() => onRead(r.p!.story!)}>📖 읽기</button>}
            </div>))}
        </div>
      ) : <p className="wk-shop-empty">아직 산 물건이 없어요. 백화점·마트·상점에서 골라 보세요!</p>}
      {note && <p className="wk-shop-note" role="status">{note}</p>}
      <button type="button" className="wk-btn" onClick={onClose}>닫기 <kbd>Esc</kbd></button>
    </div>
  );
}
