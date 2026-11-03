import { useEffect, useMemo, useState } from "react";
import { SHOP_ITEMS, type ShopItem, type ShopKind } from "./interior/shop";
import { CAT_LABEL, type Cat } from "./interior/catalog";
import { wallet, won } from "./game/wallet";
import { missions } from "./game/missions";
import ProductPic from "./ProductPic";

/* A shop's goods, bought with the game's play money: each with its picture, brand and price, by
 * category, searchable; bought goods go in the bag (kept in this browser — BagPanel), drinks and
 * food can be had at once (the hand's animation and its sounds) or carried. */
export default function ShopMenu({ shop, onBuy, onClose, onBag, onRead }: { shop: { kind: ShopKind; label: string }; onBuy: (it: ShopItem) => boolean; onClose: () => void; onBag?: () => void; onRead?: (story: string) => void }) {
  const [money, setMoney] = useState(wallet.money);
  const [note, setNote] = useState<string | null>(null);
  const [cat, setCat] = useState<Cat | "all">("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"pick" | "low" | "high">("pick");
  const [pick, setPick] = useState<ShopItem | null>(null);
  const [qty, setQty] = useState(1);
  const [shown, setShown] = useState(36);
  const [bagN, setBagN] = useState(() => wallet.items.reduce((t, i) => t + i.count, 0));
  useEffect(() => wallet.on(() => { setMoney(wallet.money); setBagN(wallet.items.reduce((t, i) => t + i.count, 0)); }), []);
  const all = SHOP_ITEMS[shop.kind];
  const cats = useMemo(() => [...new Set(all.map(i => i.cat))], [all]);
  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    let r = all.filter(i => (cat === "all" || i.cat === cat) && (!t || `${i.name} ${i.brand} ${i.desc}`.toLowerCase().includes(t)));
    if (sort === "low") r = [...r].sort((a, b) => a.price - b.price); else if (sort === "high") r = [...r].sort((a, b) => b.price - a.price);
    return r;
  }, [all, cat, q, sort]);
  useEffect(() => setShown(36), [cat, q, sort]);
  const buy = (it: ShopItem, now: boolean) => {
    const n = now ? 1 : qty, cost = it.price * n;
    if (!wallet.spend(cost)) { setNote(`게임 머니가 부족해요 (${won(cost - wallet.money)} 더 필요) · 거리의 코인과 미션 보상을 모아 보세요`); return; }
    missions.event("buy");
    if (now) {
      // (had there and then; if the hands are full the money is given back)
      if (!onBuy(it)) { wallet.earn(cost); setNote("손에 든 것을 먼저 내려놓아 주세요"); return; }
      onClose(); return;
    }
    wallet.carry({ id: it.id, name: it.name, kind: it.kind, price: it.price }, n);
    setNote(`${it.name}${n > 1 ? ` ${n}개` : ""}를 샀어요 · 가방에 넣었어요 🎒`); setPick(null); setQty(1);
  };
  return (
    <div className="wk-prompt wk-shop" role="dialog" aria-label={`${shop.label} 구매`} onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      <header>
        <h3>{shop.label}</h3><small className="wk-shop-count">{all.length}개 상품</small>
        <span className="wk-shop-money">{won(money)}<small>게임 머니</small></span>
        {onBag && <button type="button" className="wk-shop-bagbtn" onClick={onBag}>🎒 가방 {bagN > 0 && <b>{bagN}</b>}</button>}
      </header>
      <div className="wk-shop-tools">
        <input className="wk-shop-search" type="search" placeholder="상품·브랜드 검색" value={q} onChange={e => setQ(e.target.value)} />
        <select value={sort} onChange={e => setSort(e.target.value as typeof sort)} aria-label="정렬"><option value="pick">추천순</option><option value="low">낮은 가격순</option><option value="high">높은 가격순</option></select>
      </div>
      {cats.length > 1 && <nav className="wk-shop-cats">{(["all", ...cats] as (Cat | "all")[]).map(c => <button type="button" key={c} className={c === cat ? "on" : ""} onClick={() => setCat(c)}>{c === "all" ? "전체" : CAT_LABEL[c]}</button>)}</nav>}
      {pick ? (
        <section className="wk-shop-detail">
          <ProductPic p={pick} size={256} className="wk-shop-detail-pic" />
          <div>
            <small className="wk-shop-brand">{pick.brand}</small>
            <h4>{pick.name}</h4>
            <p className="wk-shop-desc">{CAT_LABEL[pick.cat]} · {pick.desc}</p>
            <p className="wk-shop-price">{won(pick.price)}</p>
            <div className="wk-shop-qty"><button type="button" onClick={() => setQty(v => Math.max(1, v - 1))}>−</button><b>{qty}</b><button type="button" onClick={() => setQty(v => Math.min(20, v + 1))}>+</button><span>합계 {won(pick.price * qty)}</span></div>
            <div className="wk-row">
              <button type="button" className="wk-btn wk-btn-shop" disabled={money < pick.price * qty} onClick={() => buy(pick, false)}>구매해서 가방에 담기</button>
              {pick.how && <button type="button" className="wk-btn" disabled={money < pick.price} onClick={() => buy(pick, true)}>{pick.kind === "drink" ? "바로 마시기" : "바로 먹기"}</button>}
              {pick.story && onRead && <button type="button" className="wk-btn" onClick={() => onRead(pick.story!)}>📖 미리 읽기</button>}
              <button type="button" className="wk-btn" onClick={() => setPick(null)}>목록으로</button>
            </div>
          </div>
        </section>
      ) : (
        <div className="wk-shop-grid">
          {items.slice(0, shown).map(it => (
            <button type="button" key={it.id} className="wk-shop-item" onClick={() => { setPick(it); setQty(1); setNote(null); }}>
              <ProductPic p={it} size={160} className="wk-shop-pic" />
              <small className="wk-shop-brand">{it.brand}</small>
              <b>{it.name.replace(it.brand, "").trim() || it.name}</b>
              <span className={money < it.price ? "short" : ""}>{won(it.price)}</span>
            </button>))}
          {items.length > shown && <button type="button" className="wk-shop-more" onClick={() => setShown(s => s + 48)}>더 보기 ({items.length - shown}개 더)</button>}
          {!items.length && <p className="wk-shop-empty">찾는 상품이 없어요</p>}
        </div>
      )}
      {note && <p className="wk-shop-note" role="status">{note}</p>}
      <button type="button" className="wk-btn" onClick={onClose}>나가기 <kbd>Esc</kbd></button>
    </div>
  );
}
