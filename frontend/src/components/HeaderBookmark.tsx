import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import BookmarkButton from "./BookmarkButton";

/** The 즐겨찾기 button on pages with the older header (.app-header-meta), placed the
 * way HeaderVisitorBadge places the reader count. Broadsheet pages carry it in their
 * Masthead; admin pages go without. */
export default function HeaderBookmark({ path }: { path: string }) {
  const isAdmin = path === "/admin" || path.startsWith("/admin/");
  const [target, setTarget] = useState<Element | null>(null);
  useEffect(() => {
    if (isAdmin) {
      setTarget(null);
      return;
    }
    const find = () => setTarget(document.querySelector(".d2-mast") ? null : document.querySelector(".app-header-meta"));
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [isAdmin, path]);
  return target ? createPortal(<BookmarkButton className="app-header-fav" />, target) : null;
}
