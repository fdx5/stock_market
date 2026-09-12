import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { reportVoltarisIngress } from "../useActivityTracking";

const VOLTARIS_URL = "https://voltaris-nyyo.onrender.com/";
// `.orbit-top` is deliberately absent: the 증시궤도 pages drop the VOLTARIS link (see
// EXCLUDED_PATHS), and that header carries nothing else this component would hook.
const HEADER_TARGETS = [
  ".app-nav-row",
  ".bubble-header",
  ".neo-header",
  ".brief-site-head",
  ".discussion-hud",
].join(",");

/** Routes that never show the VOLTARIS link. */
const EXCLUDED_PATHS = new Set([
  "/discussion-explorer",
  "/market-bubbles",
  "/kospi-orbit",
  "/kosdaq-orbit",
  "/nasdaq100-orbit",
  "/sp500-orbit",
]);

function AirplaneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5Z" />
    </svg>
  );
}

export default function VoltarisIngressLink({ path }: { path: string }) {
  const [target, setTarget] = useState<Element | null>(null);

  useEffect(() => {
    if (path === "/admin" || path.startsWith("/admin/") || EXCLUDED_PATHS.has(path)) {
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
            portalSlot.className = "voltaris-ingress-slot";
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
      className="voltaris-ingress-link"
      href={VOLTARIS_URL}
      target="_blank"
      rel="noopener noreferrer"
      data-track="self"
      onClick={() => reportVoltarisIngress(path)}
      aria-label="VOLTARIS로 이동"
    >
      <AirplaneIcon />
      <span>VOLTARIS</span>
    </a>,
    target,
  );
}
