import { useEffect, useState } from "react";
import { useT } from "../i18n/LanguageContext";
import { StoredStock, isFavorite, subscribeWatchlist, toggleFavorite } from "../watchlist";

/** Star toggle for the currently displayed stock. Reads its state from the shared
 * store rather than props so the header star and the mobile bar's star always
 * agree, including when the chip strip removes a star from a third place. */
export default function FavoriteButton({ stock, className = "" }: { stock: StoredStock; className?: string }) {
  const t = useT();
  const [starred, setStarred] = useState(() => isFavorite(stock.code));

  useEffect(() => {
    const sync = () => setStarred(isFavorite(stock.code));
    sync();
    return subscribeWatchlist(sync);
  }, [stock.code]);

  const label = starred ? t("관심종목에서 제거") : t("관심종목에 추가");

  return (
    <button
      type="button"
      className={`favorite-button ${starred ? "is-on" : ""} ${className}`}
      onClick={() => toggleFavorite(stock)}
      aria-pressed={starred}
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">{starred ? "★" : "☆"}</span>
    </button>
  );
}
