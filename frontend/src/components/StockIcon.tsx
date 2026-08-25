import { CSSProperties, ReactNode, useEffect, useState } from "react";
import { loadStockIconUrl, stockIconUrl } from "../stockIcon";

/** Stock logo <img>, backed by the shared Cache Storage-based icon cache (see
 * ../stockIcon.ts). Renders the direct Naver URL immediately so the icon appears
 * without delay, then swaps to the cached object URL once resolved — a no-op if the
 * code was already resolved earlier in this tab. */
export default function StockIcon({
  code,
  className,
  style,
  fallback = null,
}: {
  code: string;
  className: string;
  style?: CSSProperties;
  /** Rendered when Naver has no logo for this code — ETNs, REITs and newly listed names
   *  are simply not in that host. Same contract as UsStockIcon's, and for the same
   *  reason: rendering nothing leaves a hole in a grid whose other rows have a mark,
   *  which reads as broken rather than as unavailable. */
  fallback?: ReactNode;
}) {
  const [src, setSrc] = useState(() => stockIconUrl(code));
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setSrc(stockIconUrl(code));
    setHidden(false);
    let cancelled = false;
    loadStockIconUrl(code).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (hidden) return <>{fallback}</>;
  return <img className={className} style={style} src={src} alt="" onError={() => setHidden(true)} />;
}
