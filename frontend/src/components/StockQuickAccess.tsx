import { useState } from "react";
import type { StockSearchResult } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { MOBILE_QUERY, useMediaQuery } from "../useMediaQuery";
import { usePopularStocks } from "../usePopularStocks";
import { useWatchlist } from "../useWatchlist";
import { StoredStock, clearRecents, removeFavorite } from "../watchlist";
import StockIcon from "./StockIcon";

const POPULAR_LIMIT = 8;
// Enough chips to read as a populated row while the first response lands, without
// implying more content than the row will actually hold.
const POPULAR_SKELETON = [0, 1, 2, 3, 4];

type GroupKey = "popular" | "favorites" | "recents";

interface Props {
  onSelect: (stock: StockSearchResult) => void;
  /** Highlighted as the active chip — the stock the dashboard is currently showing. */
  activeCode?: string;
}

interface Group {
  key: GroupKey;
  icon: string;
  /** Row label on desktop, where there is room to spell it out. */
  label: string;
  /** Tab label on mobile — the same thing said in as few characters as a thumb-sized
   * tab can carry. */
  shortLabel: string;
  /** Shown on the mobile tab so a collapsed group still advertises what it holds.
   * Null for the popular group, whose count is always the same and says nothing. */
  count: number | null;
  chips: React.ReactNode;
  trailing?: React.ReactNode;
}

/** Live "what everyone is looking at" ranking, plus this device's own stars and
 * history — the three shortcuts that save a visitor from retyping a search on
 * every visit.
 *
 * Desktop stacks them as three labelled rows. A phone cannot afford that: with the
 * label forced above its chips for want of horizontal room, three rows cost six lines
 * of a screen whose whole job is to get the visitor to a chart. So on mobile the same
 * three groups become one tab strip over one row of chips — two lines, every shortcut
 * still one tap away, and the counts on the tabs so a collapsed group still says what
 * it is holding.
 */
export default function StockQuickAccess({ onSelect, activeCode }: Props) {
  const t = useT();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const { favorites, recents } = useWatchlist();
  const popular = usePopularStocks(POPULAR_LIMIT);
  const [activeTab, setActiveTab] = useState<GroupKey>("popular");

  const popularNames = useTranslatedTexts((popular ?? []).map((item) => item.name));
  const favoriteNames = useTranslatedTexts(favorites.map((item) => item.name));
  const recentNames = useTranslatedTexts(recents.map((item) => item.name));

  const hasPopular = popular === null || popular.length > 0;
  if (!hasPopular && favorites.length === 0 && recents.length === 0) return null;

  const chipClass = (code: string) => `quick-access-chip ${code === activeCode ? "is-active" : ""}`;

  const groups: Group[] = [];

  if (hasPopular) {
    groups.push({
      key: "popular",
      icon: "🔥",
      label: t("실시간 인기"),
      shortLabel: t("인기"),
      count: null,
      chips:
        popular === null
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
            )),
    });
  }

  if (favorites.length > 0) {
    groups.push({
      key: "favorites",
      icon: "★",
      label: t("관심종목"),
      shortLabel: t("관심"),
      count: favorites.length,
      chips: favorites.map((item, idx) => (
        <FavoriteChip
          key={item.code}
          item={item}
          displayName={favoriteNames[idx] ?? item.name}
          className={chipClass(item.code)}
          onSelect={onSelect}
          removeLabel={t("관심종목에서 제거")}
        />
      )),
    });
  }

  if (recents.length > 0) {
    groups.push({
      key: "recents",
      icon: "🕘",
      label: t("최근 본 종목"),
      shortLabel: t("최근"),
      count: recents.length,
      chips: recents.map((item, idx) => (
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
      )),
      trailing: (
        <button type="button" className="quick-access-clear" onClick={clearRecents}>
          {t("기록 삭제")}
        </button>
      ),
    });
  }

  if (!isMobile) {
    return (
      <div className="quick-access">
        {groups.map((group) => (
          <div className="quick-access-row" key={group.key}>
            <span className="quick-access-label">
              <span className="quick-access-label-icon" aria-hidden="true">
                {group.icon}
              </span>
              {group.label}
            </span>
            <div className="quick-access-chips">
              {group.chips}
              {group.trailing}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Falling back to the first group rather than tracking the selection in an effect:
  // a group can vanish under the tab that selects it (clearing history while on 최근,
  // unstarring the last favourite), and resolving that at render keeps the strip from
  // ever painting an empty row first.
  const active = groups.find((group) => group.key === activeTab) ?? groups[0];

  return (
    <div className="quick-access quick-access--mobile">
      {/* Only worth a tab strip when there is more than one group to switch between —
          a lone "인기" tab would be a control that does nothing. */}
      {groups.length > 1 && (
        <div className="quick-access-tabs" role="tablist">
          {groups.map((group) => (
            <button
              key={group.key}
              type="button"
              role="tab"
              aria-selected={group.key === active.key}
              className={`quick-access-tab ${group.key === active.key ? "is-active" : ""}`}
              onClick={() => setActiveTab(group.key)}
            >
              <span aria-hidden="true">{group.icon}</span>
              {group.shortLabel}
              {group.count !== null && <span className="quick-access-tab-count">{group.count}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="quick-access-chips">
        {active.chips}
        {active.trailing}
      </div>
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
