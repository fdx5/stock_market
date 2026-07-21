import type { StockSearchResult } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { usePopularStocks } from "../usePopularStocks";
import { useWatchlist } from "../useWatchlist";
import { StoredStock, clearRecents, removeFavorite } from "../watchlist";
import StockIcon from "./StockIcon";

const POPULAR_LIMIT = 8;
// Enough chips to read as a populated row while the first response lands, without
// implying more content than the row will actually hold.
const POPULAR_SKELETON = [0, 1, 2, 3, 4];

interface Props {
  onSelect: (stock: StockSearchResult) => void;
  /** Highlighted as the active chip — the stock the dashboard is currently showing. */
  activeCode?: string;
}

function ChipRow({
  icon,
  label,
  children,
  trailing,
}: {
  icon: string;
  label: string;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="quick-access-row">
      <span className="quick-access-label">
        <span className="quick-access-label-icon" aria-hidden="true">
          {icon}
        </span>
        {label}
      </span>
      <div className="quick-access-chips">
        {children}
        {trailing}
      </div>
    </div>
  );
}

/** Live "what everyone is looking at" ranking, plus this device's own stars and
 * history — the three shortcuts that save a visitor from retyping a search on
 * every visit. Each row hides itself entirely when it has nothing to show, so a
 * first-time visitor sees one row rather than three empty ones. */
export default function StockQuickAccess({ onSelect, activeCode }: Props) {
  const t = useT();
  const { favorites, recents } = useWatchlist();
  const popular = usePopularStocks(POPULAR_LIMIT);

  const popularNames = useTranslatedTexts((popular ?? []).map((item) => item.name));
  const favoriteNames = useTranslatedTexts(favorites.map((item) => item.name));
  const recentNames = useTranslatedTexts(recents.map((item) => item.name));

  const hasPopular = popular === null || popular.length > 0;
  if (!hasPopular && favorites.length === 0 && recents.length === 0) return null;

  const chipClass = (code: string) => `quick-access-chip ${code === activeCode ? "is-active" : ""}`;

  return (
    <div className="quick-access">
      {hasPopular && (
        <ChipRow icon="🔥" label={t("실시간 인기")}>
          {popular === null
            ? POPULAR_SKELETON.map((i) => (
                <span key={i} className="quick-access-chip quick-access-chip--skeleton" aria-hidden="true" />
              ))
            : popular.map((item, idx) => (
                <button
                  key={item.code}
                  type="button"
                  className={chipClass(item.code)}
                  onClick={() => onSelect({ code: item.code, name: item.name, market: item.market })}
                  title={`${item.name} (${item.code})`}
                >
                  <span className={`quick-access-rank ${idx < 3 ? "is-top" : ""}`}>{idx + 1}</span>
                  <StockIcon className="quick-access-chip-logo" code={item.code} />
                  <span className="quick-access-chip-name">{popularNames[idx] ?? item.name}</span>
                </button>
              ))}
        </ChipRow>
      )}

      {favorites.length > 0 && (
        <ChipRow icon="★" label={t("관심종목")}>
          {favorites.map((item, idx) => (
            <FavoriteChip
              key={item.code}
              item={item}
              displayName={favoriteNames[idx] ?? item.name}
              className={chipClass(item.code)}
              onSelect={onSelect}
              removeLabel={t("관심종목에서 제거")}
            />
          ))}
        </ChipRow>
      )}

      {recents.length > 0 && (
        <ChipRow
          icon="🕘"
          label={t("최근 본 종목")}
          trailing={
            <button type="button" className="quick-access-clear" onClick={clearRecents}>
              {t("기록 삭제")}
            </button>
          }
        >
          {recents.map((item, idx) => (
            <button
              key={item.code}
              type="button"
              className={chipClass(item.code)}
              onClick={() => onSelect(item)}
              title={`${item.name} (${item.code})`}
            >
              <StockIcon className="quick-access-chip-logo" code={item.code} />
              <span className="quick-access-chip-name">{recentNames[idx] ?? item.name}</span>
            </button>
          ))}
        </ChipRow>
      )}
    </div>
  );
}

/** Split out so the remove control can sit inside the chip without nesting a
 * button in a button (invalid, and a real click-target hazard on touch). */
function FavoriteChip({
  item,
  displayName,
  className,
  onSelect,
  removeLabel,
}: {
  item: StoredStock;
  displayName: string;
  className: string;
  onSelect: (stock: StockSearchResult) => void;
  removeLabel: string;
}) {
  return (
    <span className={`${className} quick-access-chip--removable`}>
      <button type="button" className="quick-access-chip-main" onClick={() => onSelect(item)}>
        <StockIcon className="quick-access-chip-logo" code={item.code} />
        <span className="quick-access-chip-name">{displayName}</span>
      </button>
      <button
        type="button"
        className="quick-access-chip-remove"
        onClick={() => removeFavorite(item.code)}
        aria-label={`${item.name} ${removeLabel}`}
        title={removeLabel}
      >
        ×
      </button>
    </span>
  );
}
