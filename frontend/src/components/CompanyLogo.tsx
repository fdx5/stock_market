import { useState } from "react";
import { GlobalTop20Item } from "../api/client";

/** companiesmarketcap serves the same logo at /64/, /128/ and /256/ — the roster API
 * hands us the 64px variant, so swap in the 256px one for crisp large tiles, keeping
 * the original as an onError fallback in case a particular logo lacks the big size.
 * Also matters beyond just resolution: at least one company (Samsung) serves a
 * completely different asset per size — the 64px variant is a bare "S" glyph, while
 * only the 256px one is the full wordmark — so skipping the upgrade doesn't just
 * look softer, it can show the wrong logo entirely. */
export default function CompanyLogo({ item, className }: { item: GlobalTop20Item; className?: string }) {
  const [failedHiRes, setFailedHiRes] = useState(false);
  if (!item.logo_url) return <span className="fight-logo-fallback">{item.name.slice(0, 2)}</span>;
  const src = failedHiRes ? item.logo_url : item.logo_url.replace("/company-logos/64/", "/company-logos/256/");
  return (
    <img
      src={src}
      alt={item.name}
      className={className}
      onError={() => {
        if (!failedHiRes) setFailedHiRes(true);
      }}
    />
  );
}
