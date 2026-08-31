import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "../router";

const TARGETS = ".app-nav-row,.bubble-header,.neo-header,.orbit-top,.brief-site-head,.discussion-hud,.kospi-map-header,.si-site-header";

export default function StockIntelligenceShortcut({ path }: { path: string }) {
  const [target, setTarget] = useState<Element | null>(null);
  useEffect(() => {
    const find = () => setTarget(Array.from(document.querySelectorAll(TARGETS)).find(el => !el.closest("[role='dialog']")) ?? document.body);
    find(); const observer = new MutationObserver(find); observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [path]);
  const routeCode = path.match(/^\/stock\/(\d{6})/)?.[1];
  const queryCode = new URLSearchParams(window.location.search).get("code");
  const code = routeCode || (/^\d{6}$/.test(queryCode || "") ? queryCode : null) || "005930";
  if (!target || path.startsWith("/admin") || path.startsWith("/stock/")) return null;
  return createPortal(<Link className={`stock-intel-shortcut${target === document.body ? " is-floating" : ""}`} to={`/stock/${code}`} aria-label="종목 종합정보 페이지로 이동"><span aria-hidden="true">◫</span><b>종목 종합</b></Link>, target);
}
