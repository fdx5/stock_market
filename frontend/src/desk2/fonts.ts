import { useEffect } from "react";

/* The broadsheet's type families, loaded once. Kept apart from shell.ts, which brings
   the desk's whole stylesheet with it, so a page outside the desk can use the type
   alone. */

const FONT_LINKS = [
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css",
  "https://fonts.googleapis.com/css2?family=Hahmlet:wght@500..900&family=Noto+Serif+KR:wght@400;500;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400..600&family=IBM+Plex+Sans+Condensed:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=UnifrakturMaguntia&display=swap",
];

/** Just the type families, for a page outside the broadsheet that sets its headings
 * in them (the admin monitor's masthead) without taking on the desk's scope. */
export function useBroadsheetFonts(): void {
  useEffect(() => {
    for (const href of FONT_LINKS) {
      if (document.querySelector(`link[href="${href}"]`)) continue;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
    }
  }, []);
}
