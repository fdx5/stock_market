import { CSSProperties, ReactNode, useEffect, useState } from "react";
import { etfLogoUrl } from "../etfLogo";

export default function EtfStockLogo({
  code,
  name,
  className,
  style,
  fallback = null,
}: {
  code: string;
  name?: string;
  className?: string;
  style?: CSSProperties;
  fallback?: ReactNode;
}) {
  const src = etfLogoUrl(code, name);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [code, name, src]);

  if (!src || failed) return <>{fallback}</>;
  return (
    <img
      className={className}
      style={style}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
