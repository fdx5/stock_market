import { CSSProperties, ReactNode, useEffect, useState } from "react";
import { usCompanyLogoUrl } from "../usLogo";

/** Company logo for a US ticker — the counterpart to StockIcon, which only resolves the
 * 6-digit KR codes against Naver's icon host.
 *
 * `fallback` is what renders for a ticker the logo host doesn't carry (see usLogo.ts for
 * why that set is tiny but not empty). It's a prop rather than something baked in here
 * because the right fallback is the caller's existing one — the board's text mark keeps
 * its own size and color that way, instead of this component having to know about them.
 *
 * `alt=""`: every surface that mounts this prints the company's name in text right
 * beside it, so the logo is decorative and a screen reader announcing it again would
 * only be noise. */
export default function UsStockIcon({
  code,
  className,
  style,
  fallback = null,
}: {
  code: string;
  className?: string;
  style?: CSSProperties;
  fallback?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);

  // The board's rows re-sort constantly (rank, 상승률순, …), so React reuses a card's
  // DOM node for a different ticker — without this, one missing logo would leave every
  // stock that later landed in that slot showing the fallback.
  useEffect(() => setFailed(false), [code]);

  if (failed) return <>{fallback}</>;

  return (
    <img
      className={className}
      style={style}
      src={usCompanyLogoUrl(code)}
      alt=""
      // 100 cards' worth of logos, most of them below the fold on open.
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
