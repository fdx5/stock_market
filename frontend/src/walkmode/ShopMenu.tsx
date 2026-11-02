import { useEffect, useState } from "react";
import { SHOP_ITEMS, type ShopItem, type ShopKind } from "./interior/shop";
import { wallet, won } from "./game/wallet";
import { missions } from "./game/missions";

/* A counter's goods, bought with the game's play money: drinks and food had at once (the hand's
 * animation and its sounds), goods put in the bag. */
export default function ShopMenu({ shop, onBuy, onClose }: { shop: { kind: ShopKind; label: string }; onBuy: (it: ShopItem) => boolean; onClose: () => void }) {
  const [money, setMoney] = useState(wallet.money);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => wallet.on(() => setMoney(wallet.money)), []);
  const items = SHOP_ITEMS[shop.kind], bag = wallet.items;
  const buy = (it: ShopItem) => {
    if (!wallet.spend(it.price)) { setNote(`게임 머니가 부족해요 (${won(it.price - wallet.money)} 더 필요) · 거리의 코인을 모아 보세요`); return; }
    missions.event("buy");
    if (it.kind === "goods") { wallet.carry({ id: it.id, name: it.name, kind: "goods" }); setNote(`${it.name}을(를) 가방에 넣었어요`); return; }
    // (had there and then; if the hands are full the money is given back)
    if (!onBuy(it)) { wallet.earn(it.price); setNote("손에 든 것을 먼저 내려놓아 주세요"); return; }
    onClose();
  };
  return (
    <div className="wk-prompt wk-shop" role="dialog" aria-label={`${shop.label} 구매`} onPointerDown={e => e.stopPropagation()}>
      <header><h3>{shop.label}</h3><span className="wk-shop-money">{won(money)}<small>게임 머니</small></span></header>
      <div className="wk-shop-grid">{items.map(it => (
        <button key={it.id} className="wk-shop-item" disabled={money < it.price} onClick={() => buy(it)}>
          <i style={{ background: it.color }} aria-hidden="true" /><b>{it.name}</b><span>{won(it.price)}</span><small>{it.kind === "goods" ? "가방에 담기" : it.kind === "drink" ? "바로 마시기" : "바로 먹기"}</small>
        </button>))}</div>
      {note && <p className="wk-shop-note" role="status">{note}</p>}
      {bag.length > 0 && <details><summary>가방 ({bag.reduce((t, i) => t + i.count, 0)})</summary><p>{bag.map(i => `${i.name}${i.count > 1 ? ` ×${i.count}` : ""}`).join(" · ")}</p></details>}
      <button className="wk-btn" onClick={onClose}>나가기 <kbd>Esc</kbd></button>
    </div>
  );
}
