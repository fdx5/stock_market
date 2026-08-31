import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { reportChessIngress } from "../useActivityTracking";

const CHESS_URL = "https://threedchess-mpjo.onrender.com";
const HEADER_TARGETS = [
  ".app-nav-row",
  ".bubble-header",
  ".neo-header",
  ".orbit-top",
  ".brief-site-head",
  ".discussion-hud",
].join(",");

function ChessKnightIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.2 18.2h10.6l1.1 2.2H5.8l1.4-2.2Zm1-1.5c.1-2.2.7-3.8 2-5.2L8.8 9.8 6.5 11l.7-4.2L13 3.2l-.2 2c3.1.8 5 3 5 6.2 0 2.1-.7 3.8-1.8 5.3H8.2Zm3.2-8.9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
    </svg>
  );
}

export default function ChessIngressLink({ path }: { path: string }) {
  const [target, setTarget] = useState<Element | null>(null);

  useEffect(() => {
    if (path === "/admin" || path.startsWith("/admin/") || path === "/discussion-explorer") {
      setTarget(null);
      return;
    }
    let portalSlot: HTMLSpanElement | null = null;
    const findTarget = () => {
      const candidates = Array.from(document.querySelectorAll(HEADER_TARGETS));
      const header = candidates.find((candidate) => !candidate.closest("[role='dialog']")) ?? null;
      if (!header) { setTarget(null); return; }
      if (header.matches(".app-nav-row")) {
        const newsLink = header.querySelector(".kospi-map-nav-link--news");
        if (newsLink) {
          if (!portalSlot?.isConnected) {
            portalSlot = document.createElement("span");
            portalSlot.className = "chess-ingress-slot";
            newsLink.insertAdjacentElement("afterend", portalSlot);
          }
          setTarget(portalSlot);
          return;
        }
      }
      setTarget(header);
    };
    findTarget();
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      portalSlot?.remove();
    };
  }, [path]);

  if (!target) return null;
  return createPortal(
    <a
      className="chess-ingress-link"
      href={CHESS_URL}
      target="_blank"
      rel="noopener noreferrer"
      data-track="self"
      onClick={() => reportChessIngress(path)}
      aria-label="체스게임으로 이동"
    >
      <ChessKnightIcon />
      <span>체스게임</span>
    </a>,
    target,
  );
}
