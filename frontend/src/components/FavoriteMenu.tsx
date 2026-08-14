import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { navigate } from "../router";

type FavoritePage = {
  path: string;
  title: string;
  customTitle?: boolean;
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
  const [adding, setAdding] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
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
        if (!saved || saved.customTitle || saved.title === title) return previous;
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

  const beginToggleCurrent = () => {
    if (isFavorite) {
      removeFavorite(path);
      return;
    }
    setAddTitle(document.title || "K-Stock Hub");
    setAdding(true);
  };

  const saveCurrent = () => {
    const title = addTitle.trim() || document.title || "K-Stock Hub";
    setFavorites((previous) => {
      const next = [...previous.filter((item) => item.path !== path), { path, title, customTitle: true }];
      writeFavorites(next);
      return next;
    });
    setAdding(false);
  };

  const removeFavorite = (favoritePath: string) => {
    setFavorites((previous) => {
      const next = previous.filter((item) => item.path !== favoritePath);
      writeFavorites(next);
      return next;
    });
    if (editingPath === favoritePath) setEditingPath(null);
  };

  const beginEdit = (favorite: FavoritePage) => {
    setEditingPath(favorite.path);
    setEditTitle(favorite.title);
  };

  const saveEdit = () => {
    if (!editingPath) return;
    const title = editTitle.trim();
    if (!title) return;
    setFavorites((previous) => {
      const next = previous.map((item) =>
        item.path === editingPath ? { ...item, title, customTitle: true } : item,
      );
      writeFavorites(next);
      return next;
    });
    setEditingPath(null);
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
          <button type="button" className="favorite-menu-current" role="menuitem" onClick={beginToggleCurrent}>
            <span aria-hidden="true">{isFavorite ? "★" : "☆"}</span>
            {lang === "ko"
              ? isFavorite
                ? "현재 페이지 삭제"
                : "현재 페이지 추가"
              : isFavorite
                ? "Remove current page"
                : "Add current page"}
          </button>

          {adding && (
            <span className="favorite-menu-editor">
              <input
                type="text"
                value={addTitle}
                maxLength={100}
                aria-label={lang === "ko" ? "즐겨찾기 이름" : "Favorite name"}
                autoFocus
                onChange={(event) => setAddTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveCurrent();
                  if (event.key === "Escape") setAdding(false);
                }}
              />
              <button type="button" onClick={saveCurrent}>{lang === "ko" ? "저장" : "Save"}</button>
              <button type="button" onClick={() => setAdding(false)}>{lang === "ko" ? "취소" : "Cancel"}</button>
            </span>
          )}

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
                  {editingPath === favorite.path ? (
                    <span className="favorite-menu-item-editor">
                      <input
                        type="text"
                        value={editTitle}
                        maxLength={100}
                        aria-label={lang === "ko" ? "즐겨찾기 이름 수정" : "Edit favorite name"}
                        autoFocus
                        onChange={(event) => setEditTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") saveEdit();
                          if (event.key === "Escape") setEditingPath(null);
                        }}
                      />
                      <button type="button" onClick={saveEdit} aria-label={lang === "ko" ? "수정 저장" : "Save edit"}>✓</button>
                      <button type="button" onClick={() => setEditingPath(null)} aria-label={lang === "ko" ? "수정 취소" : "Cancel edit"}>×</button>
                    </span>
                  ) : (
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
                  )}
                  <button
                    type="button"
                    className="favorite-menu-edit"
                    aria-label={lang === "ko" ? `${favorite.title} 이름 수정` : `Rename ${favorite.title}`}
                    title={lang === "ko" ? "이름 수정" : "Rename"}
                    onClick={() => beginEdit(favorite)}
                  >
                    ✎
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
