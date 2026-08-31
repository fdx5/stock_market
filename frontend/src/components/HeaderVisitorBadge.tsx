import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import VisitorBadge from "./VisitorBadge";

export default function HeaderVisitorBadge({ path }: { path: string }) {
  const [target, setTarget] = useState<Element | null>(null);
  useEffect(() => {
    if (path === "/admin" || path.startsWith("/admin/")) { setTarget(null); return; }
    const find = () => setTarget(document.querySelector(".app-header-meta"));
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [path]);
  return target ? createPortal(<VisitorBadge compact />, target) : null;
}
