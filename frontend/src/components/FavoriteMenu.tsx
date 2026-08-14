import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { navigate } from "../router";

type FavoritePage = {
  path: string;
  title: string;
};

const STORAGE_KEY = "kstock_favorite_pages";

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function readFavorites(): FavoritePage[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is FavoritePage =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as FavoritePage).path === "string" &&
        typeof (item as FavoritePage).title === "string",
    );
  } catch {
    return [];
  }
}

function writeFavorites(favorites: FavoritePage[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
  } catch {
    // Storage can be unavailable in private or locked-down browsing contexts.
  }
}

export default function FavoriteMenu() {
  const { lang } = useLanguage();
  const rootRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [favorites, setFavorites] = useState<FavoritePage[]>(readFavorites);
  const path = currentPath();
  const isFavorite = useMemo(() => favorites.some((item) => item.path === path), [favorites, path]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    const syncSavedTitle = () => {
      const title = document.title || "K-Stock Hub";
      setFavorites((previous) => {
        const saved = previous.find((item) => item.path === path);
        if (!saved || saved.title === title) return previous;
        const next = previous.map((item) => (item.path === path ? { ...item, title } : item));
        writeFavorites(next);
        return next;
      });
    };

    syncSavedTitle();
    const observer = new MutationObserver(syncSavedTitle);
    observer.observe(document.querySelector("title") ?? document.head, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [path]);

  const toggleCurrent = () => {
    setFavorites((previous) => {
      const exists = previous.some((item) => item.path === path);
      const next = exists
        ? previous.filter((item) => item.path !== path)
        : [...previous, { path, title: document.title || "K-Stock Hub" }];
      writeFavorites(next);
      return next;
    });
  };

  const removeFavorite = (favoritePath: string) => {
    setFavorites((previous) => {
      const next = previous.filter((item) => item.path !== favoritePath);
      writeFavorites(next);
      return next;
    });
  };

  return (
    <span className="favorite-menu" ref={rootRef}>
      <button
        type="button"
        className={`favorite-menu-trigger${isFavorite ? " is-favorite" : ""}`}
        aria-label={lang === "ko" ? "즐겨찾기" : "Favorites"}
        aria-expanded={open}
        aria-haspopup="menu"
        title={lang === "ko" ? "즐겨찾기" : "Favorites"}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">★</span>
      </button>

      {open && (
        <span className="favorite-menu-popover" role="menu">
          <button type="button" className="favorite-menu-current" role="menuitem" onClick={toggleCurrent}>
            <span aria-hidden="true">{isFavorite ? "★" : "☆"}</span>
            {lang === "ko"
              ? isFavorite
                ? "현재 페이지 삭제"
                : "현재 페이지 추가"
              : isFavorite
                ? "Remove current page"
                : "Add current page"}
          </button>

          <span className="favorite-menu-heading">
            {lang === "ko" ? `즐겨찾기 ${favorites.length}` : `Favorites ${favorites.length}`}
          </span>
          {favorites.length === 0 ? (
            <span className="favorite-menu-empty">
              {lang === "ko" ? "저장된 페이지가 없습니다." : "No saved pages yet."}
            </span>
          ) : (
            <span className="favorite-menu-list">
              {favorites.map((favorite) => (
                <span className="favorite-menu-item" key={favorite.path}>
                  <button
                    type="button"
                    className="favorite-menu-link"
                    role="menuitem"
                    title={favorite.title}
                    onClick={() => {
                      setOpen(false);
                      navigate(favorite.path);
                    }}
                  >
                    <span>{favorite.title}</span>
                    <small>{favorite.path}</small>
                  </button>
                  <button
                    type="button"
                    className="favorite-menu-remove"
                    aria-label={lang === "ko" ? `${favorite.title} 삭제` : `Remove ${favorite.title}`}
                    title={lang === "ko" ? "삭제" : "Remove"}
                    onClick={() => removeFavorite(favorite.path)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
