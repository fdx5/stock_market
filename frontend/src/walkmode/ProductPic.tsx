import { useEffect, useState } from "react";
import type { Product } from "./interior/catalog";
import { productImage } from "./interior/productArt";

/* A product's picture (productArt.ts), painted a few a frame so a shop of hundreds opens at once. */
const queue: (() => void)[] = [];
let running = false;
function pump() {
  running = true;
  const t0 = performance.now();
  while (queue.length && performance.now() - t0 < 6) queue.shift()!();
  if (queue.length) requestAnimationFrame(pump); else running = false;
}
export default function ProductPic({ p, size = 160, className }: { p: Product; size?: number; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    queue.push(() => { if (live) setSrc(productImage(p, size)); });
    if (!running) requestAnimationFrame(pump);
    return () => { live = false; };
  }, [p, size]);
  return src ? <img className={className} src={src} alt={p.name} width={size} height={size} draggable={false} /> : <span className={`${className ?? ""} wk-pic-wait`} style={{ background: p.color }} aria-hidden="true" />;
}
