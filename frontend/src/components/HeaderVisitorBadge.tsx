import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import VisitorBadge from "./VisitorBadge";
import { useVisitorCount } from "../useVisitorCount";

export default function HeaderVisitorBadge({ path }: { path: string }) {
  const isAdmin = path === "/admin" || path.startsWith("/admin/");
  // Presence belongs to the route, not to whether that route happens to expose the
  // shared header slot. Immersive pages have custom headers but still count as live.
  const counts = useVisitorCount(!isAdmin);
  const [target, setTarget] = useState<Element | null>(null);
  useEffect(() => {
    if (isAdmin) { setTarget(null); return; }
    const find = () => setTarget(document.querySelector(".app-header-meta"));
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [isAdmin, path]);
  return target ? createPortal(<VisitorBadge compact counts={counts} />, target) : null;
}
